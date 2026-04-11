import { readFileSync } from 'node:fs';
import type { BrainDB } from '../../../services/brain-db.js';
import type { RunRecord } from './run-tracker.js';

export interface FormatOptions {
  detail: boolean;
  db: BrainDB;
}

export function formatRunHistory(runs: RunRecord[], opts: FormatOptions): string {
  if (runs.length === 0) {
    return 'No autoloop runs recorded yet.\n';
  }

  const lines: string[] = [];

  if (opts.detail) {
    for (const run of runs) {
      lines.push(formatDetailedRun(run, opts.db));
    }
  } else {
    lines.push('Autoloop Run History', '');
    for (const run of runs) {
      lines.push(formatSummaryLine(run));
    }
    lines.push('');
    lines.push(`${runs.length} run(s) shown. Use --detail for full reports.`);
  }

  return lines.join('\n') + '\n';
}

function formatSummaryLine(run: RunRecord): string {
  const date = run.startedAt.slice(0, 16).replace('T', ' ');
  const type = run.loopType === 'session-review' ? 'review' : 'consolidate';
  const duration = run.durationMs ? formatDuration(run.durationMs) : '?';
  const status = run.status;

  return `  ${date}  ${padRight(type, 13)}  ${padRight(status, 10)}  ${duration}`;
}

function formatDetailedRun(run: RunRecord, db: BrainDB): string {
  const lines: string[] = [];
  const type = run.loopType === 'session-review' ? 'Session Review' : 'Task Consolidation';

  lines.push(`── ${type} ──`);
  lines.push(`  Started:  ${run.startedAt}`);
  if (run.completedAt) lines.push(`  Finished: ${run.completedAt}`);
  lines.push(`  Status:   ${run.status}`);
  if (run.durationMs) lines.push(`  Duration: ${formatDuration(run.durationMs)}`);

  if (run.reportNoteId) {
    const reportContent = readReportNoteContent(db, run.reportNoteId);
    if (reportContent) {
      lines.push('');
      lines.push(reportContent);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function readReportNoteContent(db: BrainDB, noteId: string): string | null {
  try {
    const note = db.getNoteById(noteId);
    if (!note?.filePath) return null;

    const content = readFileSync(note.filePath, 'utf-8');
    const bodyStart = content.indexOf('---', 4);
    if (bodyStart === -1) return null;

    const body = content.slice(bodyStart + 3).trim();
    return body;
  } catch {
    return null;
  }
}

function formatDuration(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

function padRight(str: string, width: number): string {
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}
