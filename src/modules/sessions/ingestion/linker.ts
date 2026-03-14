import { execFile } from 'node:child_process';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig } from '../../../types.js';
import type { SessionAnalytics } from '../types.js';

const TASK_ID_PATTERN = /\b([A-Z]{2,6}-\d{2}\.\d{2,3})\b/g;

export interface LinkResult {
  tasksWorked: string[];
  tasksCompleted: string[];
  notesCreated: string[];
  commits: string[];
}

export async function detectLinks(
  db: BrainDB,
  analytics: SessionAnalytics,
  config: BrainConfig
): Promise<LinkResult> {
  const tasksWorked = detectTasksWorked(db, analytics);
  const tasksCompleted = detectTasksCompleted(db, analytics);
  const notesCreated = detectNotesCreated(analytics, config);
  const commits = await detectGitCommits(analytics);

  return { tasksWorked, tasksCompleted, notesCreated, commits };
}

function detectTasksWorked(db: BrainDB, analytics: SessionAnalytics): string[] {
  const candidates = new Set<string>();

  for (const tc of analytics.toolCalls) {
    const inputStr = JSON.stringify(tc.input);
    let match: RegExpExecArray | null;
    TASK_ID_PATTERN.lastIndex = 0;
    while ((match = TASK_ID_PATTERN.exec(inputStr)) !== null) {
      candidates.add(match[1]);
    }
  }

  // Validate against PM notes
  return validateTaskIds(db, [...candidates]);
}

function detectTasksCompleted(db: BrainDB, analytics: SessionAnalytics): string[] {
  const completed = new Set<string>();
  const donePattern = /brain\s+pm\s+task\s+(?:complete|done)\s+(\S+)/;

  for (const tc of analytics.toolCalls) {
    if (tc.toolName !== 'Bash') continue;
    const cmd = (tc.input as { command?: string }).command ?? '';
    const match = donePattern.exec(cmd);
    if (match) {
      completed.add(match[1]);
    }
  }

  // Also check PM task status directly — tasks modified within session window that are now 'done'
  const taskNoteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
  if (taskNoteIds.length > 0) {
    const notes = db.getNotesByIds(taskNoteIds);
    for (const [, note] of notes) {
      if (!note.metadata) continue;
      const meta = JSON.parse(note.metadata) as Record<string, unknown>;
      if (
        meta.status === 'done' &&
        meta.modified &&
        (meta.modified as string) >= analytics.startTime.slice(0, 10) &&
        (meta.modified as string) <= (analytics.endTime?.slice(0, 10) ?? '9999')
      ) {
        completed.add(meta.display_id as string);
      }
    }
  }

  return validateTaskIds(db, [...completed]);
}

function validateTaskIds(db: BrainDB, candidates: string[]): string[] {
  if (candidates.length === 0) return [];

  const taskNoteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
  if (taskNoteIds.length === 0) return [];

  const notes = db.getNotesByIds(taskNoteIds);
  const validIds = new Set<string>();
  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.display_id) validIds.add(meta.display_id as string);
  }

  return candidates.filter((id) => validIds.has(id));
}

function detectNotesCreated(analytics: SessionAnalytics, config: BrainConfig): string[] {
  const noteFiles = new Set<string>();

  for (const tc of analytics.toolCalls) {
    if (tc.toolName !== 'Write' && tc.toolName !== 'Edit') continue;
    const filePath = (tc.input as { file_path?: string }).file_path;
    if (!filePath) continue;
    if (filePath.startsWith(config.notesDir) && filePath.endsWith('.md')) {
      noteFiles.add(filePath);
    }
  }

  return [...noteFiles];
}

async function detectGitCommits(analytics: SessionAnalytics): Promise<string[]> {
  if (!analytics.projectDir) return [];

  try {
    const commits = await new Promise<string[]>((resolve) => {
      const timeout = setTimeout(() => resolve([]), 5000);

      execFile(
        'git',
        [
          '-C',
          analytics.projectDir,
          'log',
          '--format=%H',
          `--after=${analytics.startTime}`,
          `--before=${analytics.endTime}`,
        ],
        { timeout: 5000 },
        (err, stdout) => {
          clearTimeout(timeout);
          if (err) {
            resolve([]);
            return;
          }
          resolve(
            stdout
              .trim()
              .split('\n')
              .filter((l) => l.length > 0)
          );
        }
      );
    });
    return commits;
  } catch {
    return [];
  }
}
