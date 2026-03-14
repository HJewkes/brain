import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig } from '../../../types.js';
import type { SessionMetadata } from '../types.js';
import { estimateTokens, trimToTokens } from '../utils.js';

export interface SessionContextBundle {
  session: SessionMetadata;
  overview: string | null;
  openItems: string[];
  activeFiles: string[];
  taskStatus: Array<{ taskId: string; status: string }>;
  gitState: { branch: string | null; uncommittedFiles?: string[] };
  microSummaries: string[];
  truncated: boolean;
}

export function assembleSessionContext(
  db: BrainDB,
  config: BrainConfig,
  session: SessionMetadata
): SessionContextBundle {
  const l1 = readContentFile(config.notesDir, session.display_id, 'l1-overview.md');
  const openItems = l1 ? extractOpenItems(l1) : [];
  const l2 = readContentFile(config.notesDir, session.display_id, 'l2-timeline.md');
  const activeFiles = l2 ? extractActiveFiles(l2) : [];

  // Get task status for linked tasks
  const taskStatus: Array<{ taskId: string; status: string }> = [];
  const allTasks = [...(session.tasks_worked ?? []), ...(session.tasks_completed ?? [])];
  const uniqueTasks = [...new Set(allTasks)];

  if (uniqueTasks.length > 0) {
    const taskNoteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
    if (taskNoteIds.length > 0) {
      const taskNotes = db.getNotesByIds(taskNoteIds);
      for (const [, note] of taskNotes) {
        if (!note.metadata) continue;
        const meta = JSON.parse(note.metadata) as Record<string, unknown>;
        const displayId = meta.display_id as string;
        if (uniqueTasks.includes(displayId)) {
          taskStatus.push({ taskId: displayId, status: meta.status as string });
        }
      }
    }
  }

  // Read micro-summaries from session_chunks if L1 unavailable
  const microSummaries: string[] = [];
  if (!l1) {
    try {
      const rawDb = (
        db as unknown as {
          db: {
            prepare: (sql: string) => { all: (...args: unknown[]) => Array<{ content: string }> };
          };
        }
      ).db;
      const rows = rawDb
        .prepare('SELECT content FROM session_chunks WHERE session_id = ? ORDER BY chunk_index')
        .all(session.session_id) as Array<{ content: string }>;
      for (const row of rows) {
        microSummaries.push(row.content);
      }
    } catch {
      // session_chunks table may not exist yet
    }
  }

  return {
    session,
    overview: l1,
    openItems,
    activeFiles,
    taskStatus,
    gitState: { branch: session.branch ?? null },
    microSummaries,
    truncated: false,
  };
}

export function applyTokenBudget(
  bundle: SessionContextBundle,
  budget: number
): SessionContextBundle {
  let used = 0;

  // Tier 1: summary + open items + tasks (never dropped)
  const summaryTokens = estimateTokens(bundle.session.summary ?? '');
  const openItemsTokens = estimateTokens(bundle.openItems.join('\n'));
  const taskTokens = estimateTokens(
    bundle.taskStatus.map((t) => `${t.taskId}: ${t.status}`).join('\n')
  );
  used += summaryTokens + openItemsTokens + taskTokens;

  if (used >= budget) {
    return { ...bundle, overview: null, activeFiles: [], microSummaries: [], truncated: true };
  }

  // Tier 2-5: overview, active files, micro summaries
  const remaining = budget - used;
  let overview = bundle.overview;

  if (overview && estimateTokens(overview) > remaining * 0.6) {
    overview = trimToTokens(overview, Math.floor(remaining * 0.6));
    return { ...bundle, overview, truncated: true };
  }

  return bundle;
}

function extractOpenItems(l1Content: string): string[] {
  const items: string[] = [];
  const section = extractSection(l1Content, 'Open Items');
  if (!section) return items;

  for (const line of section.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- [ ]')) {
      items.push(trimmed.slice(5).trim());
    } else if (trimmed.startsWith('- ') && !trimmed.startsWith('- [x]')) {
      items.push(trimmed.slice(2).trim());
    }
  }
  return items;
}

function extractActiveFiles(l2Content: string): string[] {
  const files: string[] = [];
  const section = extractSection(l2Content, 'Active Files');
  if (!section) return files;

  for (const line of section.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      const path = trimmed
        .slice(2)
        .split(/\s{2,}/)[0]
        .trim();
      if (path) files.push(path);
    }
  }
  return files;
}

function extractSection(content: string, heading: string): string | null {
  const pattern = new RegExp(`^##\\s+${heading}\\s*$`, 'm');
  const match = pattern.exec(content);
  if (!match) return null;

  const start = match.index + match[0].length;
  const nextHeading = content.indexOf('\n## ', start);
  return nextHeading > 0 ? content.slice(start, nextHeading).trim() : content.slice(start).trim();
}

function readContentFile(notesDir: string, displayId: string, filename: string): string | null {
  const path = join(notesDir, 'modules', 'sessions', displayId, filename);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}
