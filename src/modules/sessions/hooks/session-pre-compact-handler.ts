import type { HookHandler, HookInput, HookConfig, HookResult } from '../../../hooks/types.js';
import { hookAllow } from '../../../hooks/types.js';
import { loadConfig, resolveInstance } from '../../../services/config.js';
import { BrainDB } from '../../../services/brain-db.js';
import { captureSessionChunk } from './capture-event.js';

export const sessionPreCompactHandler: HookHandler = {
  name: 'sessions:pre-compact',
  event: 'pre-compact',
  priority: 5,

  enabled(_config: HookConfig): boolean {
    return !!process.env.BRAIN_PM_SESSION;
  },

  run(input: HookInput, _config: HookConfig): HookResult {
    const sessionId = process.env.BRAIN_PM_SESSION;
    if (!sessionId) return hookAllow();

    const summary = extractSummary(input.parsed);
    if (!summary) return hookAllow();

    let db: BrainDB | null = null;
    try {
      const instance = resolveInstance({ cwd: input.cwd });
      const config = loadConfig(instance);
      db = new BrainDB(config.dbPath);

      captureSessionChunk(db, sessionId, summary, 'compaction');
      incrementMicroSummaryCount(db, sessionId);

      return hookAllow();
    } catch {
      return hookAllow();
    } finally {
      db?.close();
    }
  },
};

function extractSummary(parsed: Record<string, unknown>): string | null {
  // Claude Code PreCompact sends { summary: "..." }
  const summary = (parsed.summary ?? parsed.content ?? '') as string;
  return summary.trim() || null;
}

function incrementMicroSummaryCount(db: BrainDB, sessionId: string): void {
  const rawDb = (
    db as unknown as {
      db: {
        prepare: (sql: string) => {
          get: (...args: unknown[]) => unknown;
          run: (...args: unknown[]) => void;
        };
      };
    }
  ).db;

  try {
    const row = rawDb
      .prepare(
        `SELECT id, metadata FROM notes
         WHERE module = 'sessions'
           AND json_extract(metadata, '$.session_id') = ?
         LIMIT 1`
      )
      .get(sessionId) as { id: string; metadata: string } | undefined;

    if (!row?.metadata) return;

    const meta = JSON.parse(row.metadata) as Record<string, unknown>;
    meta.micro_summary_count = ((meta.micro_summary_count as number) ?? 0) + 1;
    meta.last_captured_at = new Date().toISOString();

    rawDb.prepare('UPDATE notes SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), row.id);
  } catch {
    // Best-effort — never block compaction
  }
}
