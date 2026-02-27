import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type { Result } from '../errors.js';
import type { CaptureMetadata, TaskMetadata } from '../types.js';
import { ok, fail } from '../errors.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { getPmNotes } from './queries.js';
import { createTask, type CreateTaskInput } from './task-ops.js';

export interface CaptureInput {
  content: string;
  source?: string;
  project?: string;
}

export interface CaptureRecord {
  noteId: string;
  content: string;
  source: string;
  project?: string;
  processed: boolean;
  createdAt: string;
}

function captureFilePath(config: BrainConfig, captureId: string): string {
  return join(config.notesDir, 'modules', 'pm', 'captures', `${captureId}.md`);
}

function buildCaptureMarkdown(captureId: string, input: CaptureInput): string {
  const now = new Date().toISOString().slice(0, 10);
  const source = input.source ?? 'cli';

  const lines = [
    '---',
    `id: ${captureId}`,
    `title: "Capture ${captureId.slice(0, 8)}"`,
    'type: capture',
    'tier: fast',
    'module: pm',
    'visibility: private',
    `source: ${source}`,
    'processed: false',
  ];

  if (input.project) {
    lines.push(`project: ${input.project}`);
  }

  lines.push(`created: ${now}`, `modified: ${now}`, '---', '', input.content, '');
  return lines.join('\n');
}

export async function createCapture(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  input: CaptureInput,
): Promise<Result<CaptureRecord>> {
  if (!input.content || input.content.trim().length === 0) {
    return fail('INVALID_INPUT', 'Capture content cannot be empty');
  }

  const captureId = `capture-${randomUUID().slice(0, 12)}`;
  const filePath = captureFilePath(config, captureId);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const markdown = buildCaptureMarkdown(captureId, input);
  writeFileSync(filePath, markdown, 'utf-8');

  const hash = createHash('sha256').update(markdown).digest('hex');
  const noteId = await indexSingleFile(db, embedder, filePath, markdown, hash, Date.now());

  const record: CaptureRecord = {
    noteId,
    content: input.content,
    source: input.source ?? 'cli',
    project: input.project,
    processed: false,
    createdAt: new Date().toISOString(),
  };

  return ok(record);
}

export function listCaptures(
  db: BrainDB,
  filters?: { project?: string; processed?: boolean },
): Result<CaptureRecord[]> {
  const filterObj: Record<string, unknown> = {};
  if (filters?.project) filterObj.project = filters.project;
  if (filters?.processed !== undefined) {
    filterObj.processed = filters.processed;
  }

  const notes = getPmNotes(db, 'capture', filterObj);
  const captures: CaptureRecord[] = notes.map((note) => {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    const firstChunk = db.getFirstChunkForNote(note.id);
    return {
      noteId: note.id,
      content: firstChunk?.content ?? '',
      source: (meta.source as string) ?? 'cli',
      project: meta.project as string | undefined,
      processed: meta.processed === true || meta.processed === 'true',
      createdAt: note.createdAt ?? '',
    };
  });

  return ok(captures);
}

export async function processCapture(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  captureNoteId: string,
  asTask: CreateTaskInput,
): Promise<Result<TaskMetadata>> {
  const note = db.getNoteById(captureNoteId);
  if (!note) {
    return fail('NOT_FOUND', `Capture "${captureNoteId}" not found`);
  }

  if (note.type !== 'capture' || note.module !== 'pm') {
    return fail('INVALID_INPUT', `Note "${captureNoteId}" is not a PM capture`);
  }

  const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
  if (meta.processed === true || meta.processed === 'true') {
    return fail('INVALID_INPUT', `Capture "${captureNoteId}" has already been processed`);
  }

  const taskResult = await createTask(db, config, embedder, asTask);
  if (!taskResult.ok) {
    return taskResult;
  }

  const updatedMeta = { ...meta, processed: true };
  const updatedNote = { ...note, metadata: JSON.stringify(updatedMeta) };
  db.upsertNote(updatedNote);

  return ok(taskResult.data);
}
