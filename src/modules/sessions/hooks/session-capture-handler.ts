import type { HookHandler, HookInput, HookConfig, HookResult } from '../../../hooks/types.js';
import { hookAllow } from '../../../hooks/types.js';
import { loadConfig } from '../../../services/config.js';
import { BrainDB } from '../../../services/brain-db.js';
import { captureSessionEvent } from './capture-event.js';

export const sessionCaptureHandler: HookHandler = {
  name: 'sessions:capture',
  event: 'pre-tool-use',
  priority: 90, // low priority — observational, should not delay other hooks

  enabled(_config: HookConfig): boolean {
    return !!process.env.BRAIN_PM_SESSION;
  },

  run(input: HookInput, _config: HookConfig): HookResult {
    const sessionId = process.env.BRAIN_PM_SESSION;
    if (!sessionId) return hookAllow();

    let db: BrainDB | null = null;
    try {
      const config = loadConfig();
      db = new BrainDB(config.dbPath);

      const toolName = (input.parsed.tool ?? input.parsed.name ?? 'unknown') as string;
      const category = categorizeToolCall(toolName);

      captureSessionEvent(db, {
        session_id: sessionId,
        event_type: `tool:${toolName}`,
        category,
        data: {
          tool: toolName,
          input: sanitizeToolInput(input.parsed),
        },
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Capture is observational — never block the pipeline
    } finally {
      db?.close();
    }

    return hookAllow();
  },
};

function categorizeToolCall(tool: string): string {
  if (/read|grep|glob|search/i.test(tool)) return 'read';
  if (/write|edit|create/i.test(tool)) return 'write';
  if (/bash|execute|run/i.test(tool)) return 'execute';
  if (/git|commit|push|pull/i.test(tool)) return 'vcs';
  return 'other';
}

function sanitizeToolInput(parsed: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && value.length > 500) {
      sanitized[key] = value.slice(0, 500) + '…';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
