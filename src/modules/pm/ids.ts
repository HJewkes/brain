import type { BrainDB } from '../../services/brain-db.js';

export interface ParsedDisplayId {
  prefix: string;
  workstream?: number;
  task?: number;
}

const PREFIX_RE = /^[A-Z0-9]{2,5}$/;
const DISPLAY_ID_RE = /^([A-Z0-9]{2,5})(?:-(\d{2})(?:\.(\d{2}))?)?$/;

export function parseDisplayId(id: string): ParsedDisplayId | null {
  const match = DISPLAY_ID_RE.exec(id);
  if (!match) return null;

  const result: ParsedDisplayId = { prefix: match[1] };
  if (match[2] !== undefined) {
    result.workstream = Number(match[2]);
  }
  if (match[3] !== undefined) {
    result.task = Number(match[3]);
  }
  return result;
}

export function formatDisplayId(prefix: string, workstream?: number, task?: number): string {
  let id = prefix;
  if (workstream !== undefined) {
    id += `-${String(workstream).padStart(2, '0')}`;
  }
  if (task !== undefined && workstream !== undefined) {
    id += `.${String(task).padStart(2, '0')}`;
  }
  return id;
}

export function validatePrefix(prefix: string): boolean {
  return PREFIX_RE.test(prefix);
}

export function nextWorkstreamNumber(db: BrainDB, prefix: string): number {
  const noteIds = db.getModuleNoteIds({ module: 'pm' });
  if (noteIds.length === 0) return 1;

  const notes = db.getNotesByIds(noteIds);
  let max = 0;

  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.project !== prefix || typeof meta.number !== 'number') continue;
    if (note.type !== 'workstream') continue;
    max = Math.max(max, meta.number as number);
  }

  return max + 1;
}

export function nextTaskNumber(db: BrainDB, prefix: string, workstream: number): number {
  const noteIds = db.getModuleNoteIds({ module: 'pm' });
  if (noteIds.length === 0) return 1;

  const notes = db.getNotesByIds(noteIds);
  let max = 0;

  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.project !== prefix || meta.workstream !== workstream) continue;
    if (note.type !== 'task' || typeof meta.number !== 'number') continue;
    max = Math.max(max, meta.number as number);
  }

  return max + 1;
}
