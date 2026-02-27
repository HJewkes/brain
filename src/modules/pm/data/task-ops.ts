import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder, Relation } from '../../../types.js';
import type { Result } from '../errors.js';
import type { TaskMetadata, TaskMode, TaskCategory, TaskPriority, TaskStatus, VirtualState } from '../types.js';
import { ok, fail } from '../errors.js';
import { nextTaskNumber, formatDisplayId, parseDisplayId } from '../ids.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { getPmNotes } from './queries.js';
import { resolveDisplayId } from './queries.js';
import { validateTransition, computeVirtualState } from '../engine/state-machine.js';

export interface CreateTaskInput {
  project: string;
  workstream: number;
  name: string;
  mode?: TaskMode;
  category?: TaskCategory;
  priority?: TaskPriority;
  dependsOn?: string[];
}

function taskFilePath(config: BrainConfig, prefix: string, displayId: string): string {
  return join(config.notesDir, 'modules', 'pm', prefix, `${displayId}.md`);
}

function taskContentDirPath(config: BrainConfig, prefix: string, displayId: string): string {
  return join(config.notesDir, 'modules', 'pm', prefix, displayId);
}

function buildTaskMarkdown(input: CreateTaskInput, displayId: string, number: number): string {
  const now = new Date().toISOString().slice(0, 10);
  const mode = input.mode ?? 'auto';
  const category = input.category ?? 'implementation';
  const priority = input.priority ?? 'medium';

  const lines = [
    '---',
    `id: ${displayId.toLowerCase()}-task`,
    `title: "${input.name}"`,
    'type: task',
    'tier: slow',
    'module: pm',
    `project: ${input.project}`,
    `workstream: ${input.workstream}`,
    `display_id: ${displayId}`,
    `number: ${number}`,
    'status: pending',
    `mode: ${mode}`,
    `category: ${category}`,
    `priority: ${priority}`,
  ];

  if (input.dependsOn && input.dependsOn.length > 0) {
    lines.push(`depends_on: [${input.dependsOn.join(', ')}]`);
  }

  lines.push(`created: ${now}`, `modified: ${now}`, '---', '', `# ${input.name}`, '');
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

function taskMetaFromRecord(meta: Record<string, unknown>): TaskMetadata {
  return {
    display_id: meta.display_id as string,
    project: meta.project as string,
    workstream: meta.workstream as number,
    number: meta.number as number,
    status: meta.status as TaskStatus,
    mode: meta.mode as TaskMode,
    category: meta.category as TaskCategory,
    priority: meta.priority as TaskPriority,
    depends_on: meta.depends_on as string[] | undefined,
    claim_token: meta.claim_token as string | undefined,
    claimed_at: meta.claimed_at as string | undefined,
  };
}

function areDependenciesComplete(db: BrainDB, dependsOn: string[] | undefined): boolean {
  if (!dependsOn || dependsOn.length === 0) return true;

  for (const depDisplayId of dependsOn) {
    const depNotes = getPmNotes(db, 'task', { display_id: depDisplayId });
    if (depNotes.length === 0) return false;
    const depMeta = JSON.parse(depNotes[0].metadata!) as Record<string, unknown>;
    if (depMeta.status !== 'done') return false;
  }
  return true;
}

export async function createTask(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  input: CreateTaskInput,
): Promise<Result<TaskMetadata>> {
  const projectNotes = getPmNotes(db, 'project', { prefix: input.project });
  if (projectNotes.length === 0) {
    return fail('NOT_FOUND', `Project "${input.project}" not found`);
  }

  const wsDisplayId = formatDisplayId(input.project, input.workstream);
  const wsNotes = getPmNotes(db, 'workstream', { display_id: wsDisplayId });
  if (wsNotes.length === 0) {
    return fail('NOT_FOUND', `Workstream "${wsDisplayId}" not found`);
  }

  const resolvedDepIds: Array<{ displayId: string; noteId: string }> = [];
  if (input.dependsOn && input.dependsOn.length > 0) {
    for (const depDisplayId of input.dependsOn) {
      const resolved = resolveDisplayId(db, depDisplayId);
      if (!resolved.ok) {
        return fail('NOT_FOUND', `Dependency "${depDisplayId}" not found`);
      }
      resolvedDepIds.push({ displayId: depDisplayId, noteId: resolved.data });
    }
  }

  const number = nextTaskNumber(db, input.project, input.workstream);
  const displayId = formatDisplayId(input.project, input.workstream, number);

  const filePath = taskFilePath(config, input.project, displayId);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const contentDir = taskContentDirPath(config, input.project, displayId);
  if (!existsSync(contentDir)) {
    mkdirSync(contentDir, { recursive: true });
  }

  const markdown = buildTaskMarkdown(input, displayId, number);
  writeFileSync(filePath, markdown, 'utf-8');

  const hash = createHash('sha256').update(markdown).digest('hex');
  const noteId = await indexSingleFile(db, embedder, filePath, markdown, hash, Date.now());

  if (resolvedDepIds.length > 0) {
    const relations: Relation[] = resolvedDepIds.map((dep) => ({
      sourceId: noteId,
      targetId: dep.noteId,
      type: 'depends_on',
    }));
    db.upsertRelations(noteId, relations);
  }

  const metadata: TaskMetadata = {
    display_id: displayId,
    project: input.project,
    workstream: input.workstream,
    number,
    status: 'pending',
    mode: input.mode ?? 'auto',
    category: input.category ?? 'implementation',
    priority: input.priority ?? 'medium',
    depends_on: input.dependsOn,
  };

  return ok(metadata);
}

export function listTasks(
  db: BrainDB,
  prefix: string,
  filters?: { workstream?: number; status?: string; mode?: string },
): Result<TaskMetadata[]> {
  const filterObj: Record<string, unknown> = { project: prefix };
  if (filters?.workstream !== undefined) filterObj.workstream = filters.workstream;
  if (filters?.status !== undefined) filterObj.status = filters.status;
  if (filters?.mode !== undefined) filterObj.mode = filters.mode;

  const notes = getPmNotes(db, 'task', filterObj);
  const tasks: TaskMetadata[] = notes.map((note) => {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    return taskMetaFromRecord(meta);
  });

  return ok(tasks);
}

export function getTask(
  db: BrainDB,
  displayId: string,
): Result<TaskMetadata & { virtualStates: VirtualState[] }> {
  const notes = getPmNotes(db, 'task', { display_id: displayId });
  if (notes.length === 0) {
    return fail('NOT_FOUND', `Task "${displayId}" not found`);
  }

  const meta = JSON.parse(notes[0].metadata!) as Record<string, unknown>;
  const taskMeta = taskMetaFromRecord(meta);

  const hasDependencies = !!(taskMeta.depends_on && taskMeta.depends_on.length > 0);
  const dependenciesComplete = areDependenciesComplete(db, taskMeta.depends_on);

  const virtualStates = computeVirtualState({
    status: taskMeta.status,
    hasDependencies,
    dependenciesComplete,
    claimedAt: taskMeta.claimed_at,
  });

  return ok({ ...taskMeta, virtualStates });
}

export async function updateTaskStatus(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  displayId: string,
  newStatus: TaskStatus,
): Promise<Result<TaskMetadata>> {
  const notes = getPmNotes(db, 'task', { display_id: displayId });
  if (notes.length === 0) {
    return fail('NOT_FOUND', `Task "${displayId}" not found`);
  }

  const note = notes[0];
  const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
  const currentStatus = meta.status as TaskStatus;

  const transitionResult = validateTransition(currentStatus, newStatus);
  if (!transitionResult.ok) {
    return fail('INVALID_TRANSITION', transitionResult.error.message, transitionResult.error.details);
  }

  const filePath = note.filePath;
  if (!existsSync(filePath)) {
    return fail('NOT_FOUND', `Task file not found at "${filePath}"`);
  }

  let content = readFileSync(filePath, 'utf-8');
  content = replaceFrontmatterField(content, 'status', newStatus);
  const now = new Date().toISOString().slice(0, 10);
  content = replaceFrontmatterField(content, 'modified', now);

  writeFileSync(filePath, content, 'utf-8');

  const hash = createHash('sha256').update(content).digest('hex');
  const noteId = await indexSingleFile(db, embedder, filePath, content, hash, Date.now());

  const refreshedNote = db.getNoteById(noteId);
  const refreshedMeta = JSON.parse(refreshedNote!.metadata!) as Record<string, unknown>;

  return ok(taskMetaFromRecord(refreshedMeta));
}

export async function updateTask(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  displayId: string,
  updates: Partial<Pick<TaskMetadata, 'mode' | 'category' | 'priority'>>,
): Promise<Result<TaskMetadata>> {
  const notes = getPmNotes(db, 'task', { display_id: displayId });
  if (notes.length === 0) {
    return fail('NOT_FOUND', `Task "${displayId}" not found`);
  }

  const note = notes[0];
  const filePath = note.filePath;

  if (!existsSync(filePath)) {
    return fail('NOT_FOUND', `Task file not found at "${filePath}"`);
  }

  let content = readFileSync(filePath, 'utf-8');

  if (updates.mode !== undefined) {
    content = replaceFrontmatterField(content, 'mode', updates.mode);
  }
  if (updates.category !== undefined) {
    content = replaceFrontmatterField(content, 'category', updates.category);
  }
  if (updates.priority !== undefined) {
    content = replaceFrontmatterField(content, 'priority', updates.priority);
  }

  const now = new Date().toISOString().slice(0, 10);
  content = replaceFrontmatterField(content, 'modified', now);

  writeFileSync(filePath, content, 'utf-8');

  const hash = createHash('sha256').update(content).digest('hex');
  const noteId = await indexSingleFile(db, embedder, filePath, content, hash, Date.now());

  const refreshedNote = db.getNoteById(noteId);
  const refreshedMeta = JSON.parse(refreshedNote!.metadata!) as Record<string, unknown>;

  return ok(taskMetaFromRecord(refreshedMeta));
}

export async function deleteTask(
  db: BrainDB,
  config: BrainConfig,
  displayId: string,
  force?: boolean,
): Promise<Result<void>> {
  const notes = getPmNotes(db, 'task', { display_id: displayId });
  if (notes.length === 0) {
    return fail('NOT_FOUND', `Task "${displayId}" not found`);
  }

  const taskNote = notes[0];

  if (!force) {
    const incomingRelations = db.getRelationsTo(taskNote.id);
    const dependents = incomingRelations.filter((r) => r.type === 'depends_on');
    if (dependents.length > 0) {
      return fail(
        'HAS_DEPENDENTS',
        `Task "${displayId}" has ${dependents.length} dependent task(s). Use force to delete.`,
        { count: dependents.length },
      );
    }
  }

  const parsed = parseDisplayId(displayId);
  const contentDir = parsed
    ? taskContentDirPath(config, parsed.prefix, displayId)
    : null;

  db.deleteNote(taskNote.id);
  if (existsSync(taskNote.filePath)) {
    unlinkSync(taskNote.filePath);
  }

  if (contentDir && existsSync(contentDir)) {
    rmSync(contentDir, { recursive: true, force: true });
  }

  return ok(undefined);
}
