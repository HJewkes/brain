import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AutoloopBounds, AutoloopCounters } from '../types.js';
import { DEFAULT_BOUNDS } from '../types.js';

export type BoundCheckResult =
  | { exceeded: false }
  | { exceeded: true; reason: string };

export function checkBounds(
  bounds: AutoloopBounds,
  counters: AutoloopCounters
): BoundCheckResult {
  const elapsed = Date.now() - counters.startedAt;
  if (elapsed >= bounds.maxDurationMs) {
    return {
      exceeded: true,
      reason: `Time limit exceeded: ${Math.round(elapsed / 60000)}m >= ${Math.round(bounds.maxDurationMs / 60000)}m`,
    };
  }
  if (counters.notesCreated >= bounds.maxNotesCreated) {
    return {
      exceeded: true,
      reason: `Notes limit exceeded: ${counters.notesCreated} >= ${bounds.maxNotesCreated}`,
    };
  }
  if (counters.taskModifications >= bounds.maxTaskModifications) {
    return {
      exceeded: true,
      reason: `Task modification limit exceeded: ${counters.taskModifications} >= ${bounds.maxTaskModifications}`,
    };
  }
  if (counters.llmCalls >= bounds.maxLlmCalls) {
    return {
      exceeded: true,
      reason: `LLM call limit exceeded: ${counters.llmCalls} >= ${bounds.maxLlmCalls}`,
    };
  }
  return { exceeded: false };
}

export function createCounters(): AutoloopCounters {
  return {
    notesCreated: 0,
    taskModifications: 0,
    llmCalls: 0,
    startedAt: Date.now(),
  };
}

export function loadBounds(cwd?: string): AutoloopBounds {
  const configPath = join(cwd ?? process.cwd(), 'ao.config.json');
  if (!existsSync(configPath)) return { ...DEFAULT_BOUNDS };

  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const autoloop = raw.autoloop as Partial<AutoloopBounds> | undefined;
    if (!autoloop) return { ...DEFAULT_BOUNDS };

    return {
      maxDurationMs: autoloop.maxDurationMs ?? DEFAULT_BOUNDS.maxDurationMs,
      maxNotesCreated: autoloop.maxNotesCreated ?? DEFAULT_BOUNDS.maxNotesCreated,
      maxTaskModifications: autoloop.maxTaskModifications ?? DEFAULT_BOUNDS.maxTaskModifications,
      maxLlmCalls: autoloop.maxLlmCalls ?? DEFAULT_BOUNDS.maxLlmCalls,
      cooldownMs: autoloop.cooldownMs ?? DEFAULT_BOUNDS.cooldownMs,
    };
  } catch {
    return { ...DEFAULT_BOUNDS };
  }
}
