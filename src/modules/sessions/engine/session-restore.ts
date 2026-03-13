import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig } from '../../../types.js';
import { getSessionBySessionId } from '../data/session-ops.js';
import { assembleSessionContext, applyTokenBudget } from './context-bundle.js';
import { renderSessionContext } from './render.js';
import type { RenderFormat } from './render.js';

const MAX_AGE_DAYS = 7;
const DEFAULT_TOKEN_BUDGET = 4000;

function snapshotDir(): string {
  return join(homedir(), '.claude', 'session-snapshots');
}

interface SnapshotFile {
  session_id: string;
  project_dir: string;
  git_branch: string | null;
  snapshot_at: string;
  message_count: number;
  open_items: string[];
  active_files: string[];
}

export interface ResumableSession {
  sessionId: string;
  snapshotPath: string;
}

export function detectResumableSession(projectDir: string): ResumableSession | null {
  let files: string[];
  try {
    files = readdirSync(snapshotDir()).filter((f) => f.endsWith('.json'));
  } catch {
    return null;
  }

  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let best: { sessionId: string; snapshotPath: string; snapshotAt: number } | null = null;

  for (const file of files) {
    const fullPath = join(snapshotDir(), file);
    let snapshot: SnapshotFile;
    try {
      snapshot = JSON.parse(readFileSync(fullPath, 'utf-8')) as SnapshotFile;
    } catch {
      continue;
    }

    if (snapshot.project_dir !== projectDir) continue;

    const snapshotAt = new Date(snapshot.snapshot_at).getTime();
    if (isNaN(snapshotAt) || snapshotAt < cutoff) continue;

    if (!best || snapshotAt > best.snapshotAt) {
      best = { sessionId: snapshot.session_id, snapshotPath: fullPath, snapshotAt };
    }
  }

  return best ? { sessionId: best.sessionId, snapshotPath: best.snapshotPath } : null;
}

export function generateRestoreContext(
  db: BrainDB,
  config: BrainConfig,
  sessionId: string,
  tokenBudget: number = DEFAULT_TOKEN_BUDGET,
  format: RenderFormat = 'xml'
): string | null {
  const session = getSessionBySessionId(db, sessionId);

  if (session) {
    const bundle = assembleSessionContext(db, config, session);
    const budgeted = applyTokenBudget(bundle, tokenBudget);
    return renderSessionContext(budgeted, format);
  }

  // Fall back to snapshot file if session not in DB
  const snapshotPath = join(snapshotDir(), `${sessionId}.json`);
  let snapshot: SnapshotFile;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8')) as SnapshotFile;
  } catch {
    return null;
  }

  return renderMinimalContext(snapshot, format);
}

function renderMinimalContext(snapshot: SnapshotFile, format: RenderFormat): string {
  if (format === 'json') {
    return JSON.stringify(
      {
        session_id: snapshot.session_id,
        project_dir: snapshot.project_dir,
        git_branch: snapshot.git_branch,
        snapshot_at: snapshot.snapshot_at,
        open_items: snapshot.open_items,
        active_files: snapshot.active_files,
        source: 'snapshot',
      },
      null,
      2
    );
  }

  if (format === 'xml') {
    const lines: string[] = [];
    lines.push('<session_context source="snapshot">');
    lines.push(`  <session uuid="${snapshot.session_id}" status="unknown">`);
    lines.push(`    <project_dir>${snapshot.project_dir}</project_dir>`);
    if (snapshot.git_branch) lines.push(`    <branch>${snapshot.git_branch}</branch>`);
    lines.push(`    <snapshot_at>${snapshot.snapshot_at}</snapshot_at>`);
    lines.push('  </session>');
    if (snapshot.open_items.length > 0) {
      lines.push('  <open_items>');
      for (const item of snapshot.open_items) {
        lines.push(`    <item>${item}</item>`);
      }
      lines.push('  </open_items>');
    }
    if (snapshot.active_files.length > 0) {
      lines.push('  <active_files>');
      for (const f of snapshot.active_files) {
        lines.push(`    <file>${f}</file>`);
      }
      lines.push('  </active_files>');
    }
    lines.push('</session_context>');
    return lines.join('\n');
  }

  // Markdown fallback
  const lines: string[] = [];
  lines.push('# Session Restore (from snapshot)');
  lines.push('');
  lines.push(`- **Session**: ${snapshot.session_id}`);
  lines.push(`- **Project**: ${snapshot.project_dir}`);
  if (snapshot.git_branch) lines.push(`- **Branch**: ${snapshot.git_branch}`);
  lines.push(`- **Snapshot**: ${snapshot.snapshot_at}`);
  if (snapshot.open_items.length > 0) {
    lines.push('');
    lines.push('## Open Items');
    for (const item of snapshot.open_items) {
      lines.push(`- [ ] ${item}`);
    }
  }
  if (snapshot.active_files.length > 0) {
    lines.push('');
    lines.push('## Active Files');
    for (const f of snapshot.active_files) {
      lines.push(`- ${f}`);
    }
  }
  return lines.join('\n');
}
