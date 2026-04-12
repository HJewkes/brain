import type { BrainDB } from '../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../types.js';
import type { PullResult } from './task-pull.js';
import type { StalledTaskInfo } from './stall-detector.js';
import type { RoutingResult } from '../pm/engine/routing.js';
import { pullNextTask } from './task-pull.js';
import { buildSpawnPrompt } from './prompt-builder.js';
import { detectStalledTasks } from './stall-detector.js';
import { countActiveAgents } from './data.js';

export interface BurndownConfig {
  maxWip: number;
  stallThresholdMinutes: number;
  projectDir: string;
}

export interface ActiveAgent {
  taskId: string;
  claimToken: string;
  routing: RoutingResult;
  prompt: string;
  startedAt: string;
}

export interface TickResult {
  spawned: ActiveAgent[];
  stalled: StalledTaskInfo[];
  activeCount: number;
  availableSlots: number;
  effectiveWip: number;
  backpressureReason: string;
}

export type AgentSpawner = (agent: ActiveAgent) => Promise<void>;
export type StallHandler = (stalled: StalledTaskInfo[]) => Promise<void>;

export interface BurndownEventHooks {
  onTaskComplete?: (taskId: string, result: TickResult) => void;
  onWaveComplete?: (waveNumber: number, totalWaves: number, completedTasks: string[]) => void;
  onStallDetected?: (stalled: StalledTaskInfo[]) => void;
  onProgress?: (done: number, total: number, activeCount: number) => void;
}

const DEFAULT_CONFIG: BurndownConfig = {
  maxWip: 4,
  stallThresholdMinutes: 30,
  projectDir: process.cwd(),
};

export class BurndownOrchestrator {
  private running = false;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private readonly config: BurndownConfig;
  private readonly db: BrainDB;
  private readonly brainConfig: BrainConfig;
  private readonly embedder: Embedder;
  private readonly wipLimit: number;
  private onSpawn: AgentSpawner = async () => {};
  private onStall: StallHandler = async () => {};
  private eventHooks: BurndownEventHooks = {};

  constructor(
    db: BrainDB,
    brainConfig: BrainConfig,
    embedder: Embedder,
    config?: Partial<BurndownConfig>,
    wipLimit?: number
  ) {
    this.db = db;
    this.brainConfig = brainConfig;
    this.embedder = embedder;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.wipLimit = wipLimit ?? this.config.maxWip;
  }

  setSpawner(spawner: AgentSpawner): void {
    this.onSpawn = spawner;
  }

  setStallHandler(handler: StallHandler): void {
    this.onStall = handler;
  }

  setEventHooks(hooks: BurndownEventHooks): void {
    this.eventHooks = hooks;
  }

  start(intervalMs = 60_000): void {
    if (this.running) return;
    this.running = true;
    this.tickInterval = setInterval(() => void this.tick(), intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  async tick(): Promise<TickResult> {
    const stalledTasks = this.detectStalled();
    if (stalledTasks.length > 0) {
      await this.onStall(stalledTasks);
      this.eventHooks.onStallDetected?.(stalledTasks);
    }

    const spawned = await this.fillSlots();
    const activeCount = countActiveAgents(this.db);

    const result: TickResult = {
      spawned,
      stalled: stalledTasks,
      activeCount,
      availableSlots: Math.max(0, this.wipLimit - activeCount),
      effectiveWip: this.wipLimit,
      backpressureReason: 'nominal',
    };

    this.eventHooks.onProgress?.(
      spawned.length,
      spawned.length + result.availableSlots + activeCount,
      activeCount
    );
    return result;
  }

  private detectStalled(): StalledTaskInfo[] {
    return detectStalledTasks(this.db, this.config.projectDir, this.config.stallThresholdMinutes);
  }

  private async fillSlots(): Promise<ActiveAgent[]> {
    const spawned: ActiveAgent[] = [];
    let activeCount = countActiveAgents(this.db);

    while (activeCount < this.wipLimit) {
      const pulled = await this.pullAndRoute();
      if (!pulled) break;

      spawned.push(pulled);
      await this.onSpawn(pulled);
      activeCount = countActiveAgents(this.db);
    }

    return spawned;
  }

  private async pullAndRoute(): Promise<ActiveAgent | null> {
    const pullResult = await pullNextTask(this.db, this.brainConfig, this.embedder, {
      projectDir: this.config.projectDir,
    });
    if (!pullResult) return null;

    const routing = pullResult.dispatchContext.routing;
    const prompt = this.buildPrompt(pullResult);

    return {
      taskId: pullResult.taskId,
      claimToken: pullResult.claimToken,
      routing,
      prompt,
      startedAt: new Date().toISOString(),
    };
  }

  private buildPrompt(pullResult: PullResult): string {
    const prompt = buildSpawnPrompt(this.db, pullResult.taskId, {
      projectDir: this.config.projectDir,
    });
    return prompt ?? pullResult.brief;
  }
}
