import type { HookHandler, HookInput, HookConfig, HookResult } from '../../../hooks/types.js';
import { hookAllow } from '../../../hooks/types.js';
import { loadConfig, resolveInstance } from '../../../services/config.js';
import { BrainDB } from '../../../services/brain-db.js';
import { updateSessionNoteMeta, listSessions } from '../data/session-ops.js';
import { aggregateSessionEvents } from '../engine/aggregate.js';
import { exportSessionSpans } from '../integrations/span-exporter.js';
import {
  scoreSessionQuality,
  computeReferenceDistribution,
  compareToReference,
} from '../analytics/scorer.js';

type Outcome = 'success' | 'partial' | 'abandoned' | 'unknown';

/**
 * Lightweight outcome classification for the synchronous end hook.
 * Note: taskRefs is always [] for hook-captured sessions (aggregate.ts
 * only populates it from JSONL accumulation, not live events). So the
 * primary signal is error rate. The full commitSession flow (priority 20)
 * later overwrites with a richer classification that has task link data.
 * This provides a fast interim value during the commit window.
 */
export function classifyOutcome(analytics: {
  toolCalls: { length: number };
  errorRate: number;
  userTurns: number;
}): Outcome {
  const total = analytics.toolCalls.length;

  if (total === 0 && analytics.userTurns < 2) return 'unknown';
  if (total < 5 || analytics.errorRate > 0.3) return 'abandoned';
  if (analytics.errorRate < 0.1) return 'success';
  if (total > 10) return 'partial';

  return 'unknown';
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

      // Export spans to Phoenix if endpoint is configured — fire-and-forget
      exportSessionSpans(analytics);

      // Score current session and run regression check against reference sessions
      const score = scoreSessionQuality(analytics);
      if (score.overall != null) {
        const refSessions = listSessions(db, { reference: true });
        if (refSessions.length < 3) {
          console.info(
            `[sessions:end] Regression check skipped: ${refSessions.length} reference session(s) available (need 3+)`
          );
        } else {
          const refScores = refSessions
            .map((s) => {
              // db is non-null here: assigned before this block in the try branch
              const a = aggregateSessionEvents(db!, s.session_id);
              return a ? scoreSessionQuality(a) : null;
            })
            .filter((s): s is ReturnType<typeof scoreSessionQuality> => s !== null);
          const distribution = computeReferenceDistribution(refScores);
          if (distribution) {
            const report = compareToReference(score, distribution);
            if (report.regressed) {
              console.warn(`[sessions:end] ${report.message}`);
            }
          }
        }
      }

      // Write interim values — commitSession (priority 20) may overwrite
      // with richer data from full JSONL analysis and task link resolution
      updateSessionNoteMeta(db, sessionId, (meta) => {
        meta.ended_at = meta.ended_at ?? endedAt;
        meta.outcome = meta.outcome ?? outcome;
        meta.status =
          meta.status === 'active'
            ? outcome === 'abandoned'
              ? 'abandoned'
              : 'completed'
            : meta.status;
      });

      return hookAllow();
    } catch {
      return hookAllow();
    } finally {
      db?.close();
    }
  },
};
