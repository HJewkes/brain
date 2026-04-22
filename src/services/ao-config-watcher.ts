import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';

/**
 * Settings from ao.config.json that can change without an MCP restart.
 *
 * Why: VNM-56 found that tweaking a budget default forced a full
 * kill/rebuild/reconnect cycle. These are the values the watcher re-reads
 * from disk so running tools pick up the new numbers on the next call.
 */
export interface AoRuntimeDefaults {
  maxBudgetUsd: number | undefined;
  wipLimit: number | undefined;
  reviewThreshold: number | undefined;
}

interface AoConfigShape {
  enforcement?: { wipLimit?: number };
  defaults?: {
    maxBudgetUsd?: number;
    wipLimit?: number;
    reviewThreshold?: number;
  };
}

const RELOAD_DEBOUNCE_MS = 100;

function emptyDefaults(): AoRuntimeDefaults {
  return { maxBudgetUsd: undefined, wipLimit: undefined, reviewThreshold: undefined };
}

function parseDefaults(raw: AoConfigShape): AoRuntimeDefaults {
  const d = raw.defaults ?? {};
  return {
    maxBudgetUsd: d.maxBudgetUsd,
    wipLimit: d.wipLimit ?? raw.enforcement?.wipLimit,
    reviewThreshold: d.reviewThreshold,
  };
}

function readAoConfig(path: string): AoRuntimeDefaults {
  if (!existsSync(path)) return emptyDefaults();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as AoConfigShape;
    return parseDefaults(raw);
  } catch {
    return emptyDefaults();
  }
}

export class AoConfigWatcher {
  private defaults: AoRuntimeDefaults = emptyDefaults();
  private watcher: FSWatcher | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private reloadCount = 0;

  constructor(
    private readonly configPath: string,
    private readonly onReload?: (next: AoRuntimeDefaults) => void
  ) {
    this.defaults = readAoConfig(this.configPath);
  }

  start(): void {
    if (this.watcher) return;
    if (!existsSync(this.configPath)) return;
    try {
      this.watcher = watch(this.configPath, () => this.scheduleReload());
    } catch {
      // fs.watch is unreliable on some platforms; consumers can poll via reload()
    }
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
  }

  /** Force re-read from disk. Used by tests and poll-based callers. */
  reload(): AoRuntimeDefaults {
    const next = readAoConfig(this.configPath);
    this.defaults = next;
    this.reloadCount += 1;
    this.onReload?.(next);
    return next;
  }

  get snapshot(): AoRuntimeDefaults {
    return this.defaults;
  }

  get reloads(): number {
    return this.reloadCount;
  }

  private scheduleReload(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.reload();
    }, RELOAD_DEBOUNCE_MS);
  }
}

let sharedWatcher: AoConfigWatcher | undefined;

/**
 * Resolve the process-wide watcher, constructing it on first call. Started
 * lazily so CLI commands that never touch runtime defaults don't open an
 * unused fs.watch handle.
 */
export function getAoConfigWatcher(projectDir: string): AoConfigWatcher {
  if (sharedWatcher) return sharedWatcher;
  sharedWatcher = new AoConfigWatcher(join(projectDir, 'ao.config.json'));
  sharedWatcher.start();
  return sharedWatcher;
}

/** Reset the shared watcher. Exclusively for tests. */
export function resetAoConfigWatcherForTests(): void {
  if (sharedWatcher) sharedWatcher.stop();
  sharedWatcher = undefined;
}
