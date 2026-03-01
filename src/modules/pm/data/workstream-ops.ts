import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder, Relation } from '../../../types.js';
import type { Result } from '../errors.js';
import type { WorkstreamMetadata } from '../types.js';
import { ok, fail } from '../errors.js';
import { nextWorkstreamNumber, formatDisplayId, parseDisplayId } from '../ids.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { getPmNotes } from './queries.js';

export interface CreateWorkstreamInput {
  project: string;
  name: string;
  description?: string;
}

function workstreamFilePath(config: BrainConfig, prefix: string, displayId: string): string {
  return join(config.notesDir, 'modules', 'pm', prefix, `${displayId}.md`);
}

function buildWorkstreamMarkdown(
  input: CreateWorkstreamInput,
  displayId: string,
  number: number
): string {
  const now = new Date().toISOString().slice(0, 10);
  const lines = [
    '---',
    `id: ${displayId.toLowerCase()}-workstream`,
    `title: "Workstream ${input.name}"`,
    'type: workstream',
    'tier: slow',
    'module: pm',
    `project: ${input.project}`,
    `display_id: ${displayId}`,
    `number: ${number}`,
    'status: active',
    `created: ${now}`,
    `modified: ${now}`,
    '---',
    '',
    `# ${input.name}`,
    '',
  ];

  if (input.description) {
    lines.push(input.description, '');
  }

  return lines.join('\n');
}

function replaceFrontmatterField(content: string, field: string, value: string): string {
  const endOfFrontmatter = content.indexOf('\n---', 4);
  if (endOfFrontmatter === -1) return content;

  const frontmatter = content.slice(0, endOfFrontmatter);
  const rest = content.slice(endOfFrontmatter);
  const fieldRegex = new RegExp(`^${field}:.*$`, 'm');
  const quoted = value.includes(' ') ? `"${value}"` : value;

  if (fieldRegex.test(frontmatter)) {
    return frontmatter.replace(fieldRegex, `${field}: ${quoted}`) + rest;
  }
  return frontmatter + `\n${field}: ${quoted}` + rest;
}

function extractDescription(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;

  const content = readFileSync(filePath, 'utf-8');
  const fmEnd = content.indexOf('\n---', 4);
  if (fmEnd === -1) return undefined;

  const afterFm = content.slice(fmEnd + 4).trim();
  const lines = afterFm.split('\n');
  const headingIdx = lines.findIndex(l => l.startsWith('# '));
  if (headingIdx === -1) return undefined;

  const descLines: string[] = [];
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' && descLines.length > 0) break;
    if (line === '') continue;
    descLines.push(line);
  }

  return descLines.length > 0 ? descLines.join(' ') : undefined;
}

function workstreamMetaFromRecord(
  meta: Record<string, unknown>,
  description?: string,
): WorkstreamMetadata {
  return {
    title: (meta.title as string) ?? undefined,
    description,
    display_id: meta.display_id as string,
    project: meta.project as string,
    number: meta.number as number,
    status: meta.status as WorkstreamMetadata['status'],
  };
}

export async function createWorkstream(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  input: CreateWorkstreamInput
): Promise<Result<WorkstreamMetadata>> {
  const projectNotes = getPmNotes(db, 'project', { prefix: input.project });
  if (projectNotes.length === 0) {
    return fail('NOT_FOUND', `Project "${input.project}" not found`);
  }

  const number = nextWorkstreamNumber(db, input.project);
  const displayId = formatDisplayId(input.project, number);

  const filePath = workstreamFilePath(config, input.project, displayId);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const markdown = buildWorkstreamMarkdown(input, displayId, number);
  writeFileSync(filePath, markdown, 'utf-8');

  const hash = createHash('sha256').update(markdown).digest('hex');
  const noteId = await indexSingleFile(db, embedder, filePath, markdown, hash, Date.now());

  if (projectNotes.length > 0) {
    const parentRelation: Relation[] = [
      { sourceId: projectNotes[0].id, targetId: noteId, type: 'parent' },
    ];
    db.upsertRelations(noteId, parentRelation);
  }

  const metadata: WorkstreamMetadata = {
    display_id: displayId,
    project: input.project,
    number,
    status: 'active',
  };

  return ok(metadata);
}

export function listWorkstreams(db: BrainDB, prefix: string): Result<WorkstreamMetadata[]> {
  const notes = getPmNotes(db, 'workstream', { project: prefix });
  const workstreams: WorkstreamMetadata[] = notes.map((note) => {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    const description = extractDescription(note.filePath);
    return workstreamMetaFromRecord(meta, description);
  });

  return ok(workstreams);
}

export function getWorkstream(db: BrainDB, displayId: string): Result<WorkstreamMetadata> {
  const notes = getPmNotes(db, 'workstream', { display_id: displayId });
  if (notes.length === 0) {
    return fail('NOT_FOUND', `Workstream "${displayId}" not found`);
  }

  const meta = JSON.parse(notes[0].metadata!) as Record<string, unknown>;
  const description = extractDescription(notes[0].filePath);
  return ok(workstreamMetaFromRecord(meta, description));
}

export async function updateWorkstream(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  displayId: string,
  updates: Partial<Pick<WorkstreamMetadata, 'status'>>
): Promise<Result<WorkstreamMetadata>> {
  const notes = getPmNotes(db, 'workstream', { display_id: displayId });
  if (notes.length === 0) {
    return fail('NOT_FOUND', `Workstream "${displayId}" not found`);
  }

  const note = notes[0];
  const filePath = note.filePath;

  if (!existsSync(filePath)) {
    return fail('NOT_FOUND', `Workstream file not found at "${filePath}"`);
  }

  const content = readFileSync(filePath, 'utf-8');
  let updated = content;

  if (updates.status !== undefined) {
    updated = replaceFrontmatterField(updated, 'status', updates.status);
  }

  const now = new Date().toISOString().slice(0, 10);
  updated = replaceFrontmatterField(updated, 'modified', now);

  writeFileSync(filePath, updated, 'utf-8');

  const hash = createHash('sha256').update(updated).digest('hex');
  const noteId = await indexSingleFile(db, embedder, filePath, updated, hash, Date.now());

  const refreshedNote = db.getNoteById(noteId);
  const meta = JSON.parse(refreshedNote!.metadata!) as Record<string, unknown>;

  return ok(workstreamMetaFromRecord(meta));
}

export async function deleteWorkstream(
  db: BrainDB,
  config: BrainConfig,
  displayId: string,
  force?: boolean
): Promise<Result<void>> {
  const notes = getPmNotes(db, 'workstream', { display_id: displayId });
  if (notes.length === 0) {
    return fail('NOT_FOUND', `Workstream "${displayId}" not found`);
  }

  const parsed = parseDisplayId(displayId);
  if (!parsed || parsed.workstream === undefined) {
    return fail('INVALID_INPUT', `Invalid workstream display ID "${displayId}"`);
  }

  const taskNotes = getPmNotes(db, 'task', {
    project: parsed.prefix,
    workstream: parsed.workstream,
  });
  if (taskNotes.length > 0 && !force) {
    return fail(
      'HAS_DEPENDENTS',
      `Workstream "${displayId}" has ${taskNotes.length} task(s). Use force to delete.`,
      { count: taskNotes.length }
    );
  }

  if (force && taskNotes.length > 0) {
    for (const task of taskNotes) {
      db.deleteNote(task.id);
      if (existsSync(task.filePath)) {
        unlinkSync(task.filePath);
      }
    }
  }

  const wsNote = notes[0];
  db.deleteNote(wsNote.id);
  if (existsSync(wsNote.filePath)) {
    unlinkSync(wsNote.filePath);
  }

  return ok(undefined);
}
