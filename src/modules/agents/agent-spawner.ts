import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { ActiveAgent } from './burndown.js';
import type { RoutingResult } from '../pm/engine/routing.js';

export interface SpawnedAgent {
  taskId: string;
  process: ChildProcess;
  startedAt: string;
  model: string;
  isolation: string;
}

export interface SpawnResult {
  taskId: string;
  exitCode: number | null;
  output: string;
  error: string;
}

export interface AgentSpawnerConfig {
  claudePath: string;
  projectDir: string;
  permissionMode: string;
}

const DEFAULT_CONFIG: AgentSpawnerConfig = {
  claudePath: 'claude',
  projectDir: process.cwd(),
  permissionMode: 'auto',
};

function mapModel(routing: RoutingResult): string {
  const modelMap: Record<string, string> = {
    opus: 'opus',
    sonnet: 'sonnet',
    haiku: 'haiku',
  };
  return modelMap[routing.model] ?? 'sonnet';
}

function buildArgs(agent: ActiveAgent, config: AgentSpawnerConfig): string[] {
  const args = [
    '--print',
    '--model', mapModel(agent.routing),
    '--permission-mode', config.permissionMode,
  ];

  if (agent.routing.isolation === 'worktree') {
    args.push('--worktree', agent.taskId.toLowerCase());
  }

  args.push(agent.prompt);
  return args;
}

export class ClaudeAgentSpawner {
  private readonly config: AgentSpawnerConfig;
  private readonly active = new Map<string, SpawnedAgent>();
  private readonly results = new Map<string, SpawnResult>();

  constructor(config?: Partial<AgentSpawnerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  spawn(agent: ActiveAgent): SpawnedAgent {
    const args = buildArgs(agent, this.config);

    const child = spawn(this.config.claudePath, args, {
      cwd: this.config.projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const spawned: SpawnedAgent = {
      taskId: agent.taskId,
      process: child,
      startedAt: agent.startedAt,
      model: agent.routing.model,
      isolation: agent.routing.isolation,
    };

    this.active.set(agent.taskId, spawned);
    this.trackCompletion(spawned);
    return spawned;
  }

  getActive(): ReadonlyMap<string, SpawnedAgent> {
    return this.active;
  }

  getResult(taskId: string): SpawnResult | undefined {
    return this.results.get(taskId);
  }

  get activeCount(): number {
    return this.active.size;
  }

  async waitFor(taskId: string): Promise<SpawnResult> {
    const existing = this.results.get(taskId);
    if (existing) return existing;

    const spawned = this.active.get(taskId);
    if (!spawned) {
      return { taskId, exitCode: 1, output: '', error: 'No agent found' };
    }

    return waitForAgent(spawned);
  }

  private trackCompletion(spawned: SpawnedAgent): void {
    waitForAgent(spawned).then((result) => {
      this.active.delete(spawned.taskId);
      this.results.set(spawned.taskId, result);
    });
  }

  toSpawnerCallback(): (agent: ActiveAgent) => Promise<void> {
    return async (agent) => {
      this.spawn(agent);
    };
  }
}

export function waitForAgent(spawned: SpawnedAgent): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    spawned.process.stdout?.on('data', (data: Buffer) => chunks.push(data));
    spawned.process.stderr?.on('data', (data: Buffer) => errChunks.push(data));

    spawned.process.on('close', (code) => {
      resolve({
        taskId: spawned.taskId,
        exitCode: code,
        output: Buffer.concat(chunks).toString('utf-8'),
        error: Buffer.concat(errChunks).toString('utf-8'),
      });
    });

    spawned.process.on('error', (err) => {
      resolve({
        taskId: spawned.taskId,
        exitCode: 1,
        output: '',
        error: err.message,
      });
    });
  });
}
