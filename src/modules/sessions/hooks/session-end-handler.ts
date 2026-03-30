import type { HookHandler, HookInput, HookConfig, HookResult } from '../../../hooks/types.js';
import { hookAllow } from '../../../hooks/types.js';
import { loadConfig, resolveInstance } from '../../../services/config.js';
import { BrainDB } from '../../../services/brain-db.js';
import { updateSessionNoteMeta } from '../data/session-ops.js';
import { aggregateSessionEvents } from '../engine/aggregate.js';

type Outcome = 'success' | 'partial' | 'abandoned' | 'unknown';

export function classifyOutcome(analytics: {
  toolCalls: { length: number };
  errorRate: number;
  taskRefs: string[];
}): Outcome {
  const toolCount = analytics.toolCalls.length;
  const hasCompletedTasks = analytics.taskRefs.length > 0;

  if (toolCount < 5 && !hasCompletedTasks) return 'abandoned';
  if (hasCompletedTasks || analytics.errorRate < 0.1) return 'success';
  return 'partial';
}

export const sessionEndHandler: HookHandler = {
  name: 'sessions:end',
  event: 'agent-done',
  priority: 15, // after agents:agent-done (10), before sessions:commit (20)

  enabled(_config: HookConfig): boolean {
    return !!process.env.BRAIN_PM_SESSION;
  },

  run(input: HookInput, _config: HookConfig): HookResult {
    const sessionId = process.env.BRAIN_PM_SESSION;
    if (!sessionId) return hookAllow();

    let db: BrainDB | null = null;
    try {
      const instance = resolveInstance({ cwd: input.cwd });
      const config = loadConfig(instance);
      db = new BrainDB(config.dbPath);

      const analytics = aggregateSessionEvents(db, sessionId);
      if (!analytics || (analytics.userTurns < 2 && analytics.toolCalls.length === 0)) {
        return hookAllow();
      }

      const outcome = classifyOutcome(analytics);
      const endedAt = new Date().toISOString();

      updateSessionNoteMeta(db, sessionId, (meta) => {
        meta.ended_at = endedAt;
        meta.outcome = outcome;
        meta.status = outcome === 'abandoned' ? 'abandoned' : 'completed';
      });

      return hookAllow();
    } catch {
      return hookAllow();
    } finally {
      db?.close();
    }
  },
};
