import { spawn } from 'node:child_process';
import type { HookHandler, HookInput, HookConfig, HookResult } from '../../../hooks/types.js';
import { hookAllow } from '../../../hooks/types.js';
import { loadConfig, resolveInstance } from '../../../services/config.js';
import { BrainDB } from '../../../services/brain-db.js';
import { getSessionBySessionId } from '../data/session-ops.js';
import { aggregateSessionEvents } from '../engine/aggregate.js';
import { findBrainBinary } from '../../../hooks/utils.js';

export const sessionCommitHandler: HookHandler = {
  name: 'sessions:commit',
  event: 'agent-done',
  priority: 20, // after agents:agent-done (10)

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

      // Skip if already committed
      const existing = getSessionBySessionId(db, sessionId);
      if (existing) return hookAllow();

      // Check we have enough events to warrant a commit
      const analytics = aggregateSessionEvents(db, sessionId);
      if (!analytics || (analytics.userTurns < 2 && analytics.toolCalls.length === 0)) {
        return hookAllow();
      }

      // Spawn commit in background — async work (git log, embedding, LLM) shouldn't block the hook
      const brainPath = findBrainBinary();
      if (brainPath) {
        const child = spawn(brainPath, ['session', 'commit', sessionId], {
          cwd: input.cwd,
          stdio: 'ignore',
          detached: true,
        });
        child.unref();
      }

      return hookAllow();
    } catch {
      return hookAllow();
    } finally {
      db?.close();
    }
  },
};
