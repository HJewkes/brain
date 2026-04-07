import type { HookHandler, HookInput, HookConfig, HookResult } from '../../../hooks/types.js';
import { hookAllow } from '../../../hooks/types.js';
import { withBrain } from '../../../services/brain-service.js';
import { runPostExecutionAnalysis } from '../analytics/post-execution-analyzer.js';

export const sessionAnalysisHandler: HookHandler = {
  name: 'sessions:analysis',
  event: 'agent-done',
  priority: 25,

  enabled(_config: HookConfig): boolean {
    return !!process.env.BRAIN_PM_SESSION;
  },

  run(input: HookInput, _config: HookConfig): HookResult {
    const sessionId = process.env.BRAIN_PM_SESSION;
    if (!sessionId) return hookAllow();

    const taskDescription = process.env.BRAIN_PM_TASK ?? undefined;

    setImmediate(() => {
      withBrain((svc) => runPostExecutionAnalysis(svc, sessionId, taskDescription), {
        cwd: input.cwd,
      }).catch((err) => console.warn('[sessions:analysis] analysis failed:', err));
    });

    return hookAllow();
  },
};
