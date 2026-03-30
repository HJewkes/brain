import type { BrainDB } from '../../../services/brain-db.js';
import { getSessionBySessionId } from '../data/session-ops.js';
import { getSessionChunkContents } from './aggregate.js';

export interface SessionResumeContext {
  sessionId: string;
  displayId: string;
  project: string | null;
  startedAt: string;
  compactCount: number;
  filesWritten: string[];
  tasksWorked: string[];
  tasksCompleted: string[];
  commits: string[];
  microSummaries: string[];
  activeConstraints: {
    worktreePath?: string;
    gitBranch?: string;
  };
}

export function generateResumeContext(db: BrainDB, sessionId: string): SessionResumeContext | null {
  const meta = getSessionBySessionId(db, sessionId);
  if (!meta) return null;

  const filesWritten = queryFilesWritten(db, sessionId);
  const microSummaries = getSessionChunkContents(db, sessionId);

  return {
    sessionId: meta.session_id,
    displayId: meta.display_id,
    project: meta.project ?? null,
    startedAt: meta.started_at,
    compactCount: meta.compact_count ?? 0,
    filesWritten,
    tasksWorked: meta.tasks_worked ?? [],
    tasksCompleted: meta.tasks_completed ?? [],
    commits: meta.commits ?? [],
    microSummaries,
    activeConstraints: {
      worktreePath: meta.worktree_path,
      gitBranch: meta.branch,
    },
  };
}

export function renderResumeXml(ctx: SessionResumeContext): string {
  const lines: string[] = [];
  lines.push(`<session-resume id="${ctx.displayId}" compact="${ctx.compactCount}">`);
  lines.push(`  Context was compacted. You are continuing session ${ctx.displayId}.`);
  if (ctx.project) lines.push(`  <project>${ctx.project}</project>`);
  if (ctx.activeConstraints.worktreePath) {
    lines.push(`  <worktree>${ctx.activeConstraints.worktreePath}</worktree>`);
  }
  if (ctx.activeConstraints.gitBranch) {
    lines.push(`  <branch>${ctx.activeConstraints.gitBranch}</branch>`);
  }
  if (ctx.filesWritten.length > 0) {
    lines.push('  <files_written>');
    for (const f of ctx.filesWritten.slice(0, 20)) lines.push(`    <f>${f}</f>`);
    lines.push('  </files_written>');
  }
  if (ctx.tasksWorked.length > 0) {
    lines.push(`  <tasks_worked>${ctx.tasksWorked.join(', ')}</tasks_worked>`);
  }
  if (ctx.tasksCompleted.length > 0) {
    lines.push(`  <tasks_completed>${ctx.tasksCompleted.join(', ')}</tasks_completed>`);
  }
  if (ctx.commits.length > 0) {
    lines.push(`  <commits>${ctx.commits.slice(0, 5).join(', ')}</commits>`);
  }
  if (ctx.microSummaries?.length > 0) {
    lines.push('  <prior_context>');
    for (const s of ctx.microSummaries.slice(-3)) lines.push(`    <summary>${s}</summary>`);
    lines.push('  </prior_context>');
  }
  lines.push('</session-resume>');
  return lines.join('\n');
}

export function renderResumePlain(ctx: SessionResumeContext): string {
  const lines: string[] = [];
  lines.push(
    `[Resume] Context compacted (x${ctx.compactCount}). Continuing session ${ctx.displayId}.`
  );
  if (ctx.project) lines.push(`Project: ${ctx.project}`);
  if (ctx.activeConstraints.worktreePath) {
    lines.push(`Worktree: ${ctx.activeConstraints.worktreePath}`);
  }
  if (ctx.activeConstraints.gitBranch) lines.push(`Branch: ${ctx.activeConstraints.gitBranch}`);
  if (ctx.tasksWorked.length > 0) lines.push(`Tasks worked: ${ctx.tasksWorked.join(', ')}`);
  if (ctx.tasksCompleted.length > 0)
    lines.push(`Tasks completed: ${ctx.tasksCompleted.join(', ')}`);
  if (ctx.filesWritten.length > 0) {
    lines.push(`Files written: ${ctx.filesWritten.slice(0, 10).join(', ')}`);
  }
  if (ctx.commits.length > 0) lines.push(`Commits: ${ctx.commits.slice(0, 3).join(', ')}`);
  if (ctx.microSummaries?.length > 0) {
    lines.push(`Prior context: ${ctx.microSummaries.slice(-3).join(' | ')}`);
  }
  return lines.join('\n');
}

// Pull file paths from structural_events for Write/Edit tool calls
function queryFilesWritten(db: BrainDB, sessionId: string): string[] {
  const rawDb = (
    db as unknown as {
      db: { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } };
    }
  ).db;

  try {
    const rows = rawDb
      .prepare(
        `SELECT DISTINCT file_path FROM structural_events
         WHERE session_id = ? AND event_type IN ('file:write', 'file:edit') AND file_path IS NOT NULL
         ORDER BY timestamp ASC`
      )
      .all(sessionId) as { file_path: string }[];
    return rows.map((r) => r.file_path);
  } catch {
    return [];
  }
}
