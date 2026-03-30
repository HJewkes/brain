import type { HookHandler, HookInput, HookConfig, HookResult } from '../../../hooks/types.js';
import { hookAllow, hookAllowJson } from '../../../hooks/types.js';
import { loadConfig, resolveInstance } from '../../../services/config.js';
import { BrainDB } from '../../../services/brain-db.js';
import {
  generateResumeContext,
  renderResumeXml,
  renderResumePlain,
} from '../engine/session-resume.js';
import { updateSessionNoteMeta } from '../data/session-ops.js';

// Compaction notification markers from Claude Code
const COMPACTION_PHRASES = [
  'context was compacted',
  'context has been compacted',
  'compacting context',
  'context compaction',
];

export const sessionCompactHandler: HookHandler = {
  name: 'sessions:compact',
  event: 'notification',
  priority: 5,

  enabled(_config: HookConfig): boolean {
    return !!process.env.BRAIN_PM_SESSION;
  },

  run(input: HookInput, _config: HookConfig): HookResult {
    const sessionId = process.env.BRAIN_PM_SESSION;
    if (!sessionId) return hookAllow();

    if (!isCompactionNotification(input.parsed)) return hookAllow();

    let db: BrainDB | null = null;
    try {
      const instance = resolveInstance({ cwd: input.cwd });
      const config = loadConfig(instance);
      db = new BrainDB(config.dbPath);

      updateSessionNoteMeta(db, sessionId, (meta) => {
        meta.compact_count = ((meta.compact_count as number) ?? 0) + 1;
      });

      const ctx = generateResumeContext(db, sessionId);
      if (!ctx) return hookAllow();

      // Bump local count to reflect this compaction (not yet persisted)
      ctx.compactCount += 1;

      const xml = renderResumeXml(ctx);
      const plain = renderResumePlain(ctx);
      return hookAllowJson(`${plain}\n\n${xml}`);
    } catch {
      return hookAllow();
    } finally {
      db?.close();
    }
  },
};

function isCompactionNotification(parsed: Record<string, unknown>): boolean {
  // Check message/content fields for compaction language
  const message = ((parsed.message ?? parsed.content ?? '') as string).toLowerCase();
  if (COMPACTION_PHRASES.some((p) => message.includes(p))) return true;

  // Check title field (some notifications use this)
  const title = ((parsed.title ?? '') as string).toLowerCase();
  if (COMPACTION_PHRASES.some((p) => title.includes(p))) return true;

  // Check for explicit subtype
  const subtype = (parsed.subtype ?? parsed.type ?? '') as string;
  if (subtype === 'compact_boundary' || subtype === 'compaction') return true;

  return false;
}
