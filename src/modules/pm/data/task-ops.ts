import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder, Relation } from '../../../types.js';
import type { Result } from '../errors.js';
import type {
  TaskMetadata,
  TaskMode,
  TaskCategory,
  TaskPriority,
  TaskStatus,
  VirtualState,
} from '../types.js';
import { ok, fail } from '../errors.js';
import { nextTaskNumber, formatDisplayId, parseDisplayId } from '../ids.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { getPmNotes, resolveDisplayId } from './queries.js';
import { validateTransition, computeVirtualState } from '../engine/state-machine.js';
import { readTaskBody } from '../engine/dispatch.js';
import { listWorkstreams } from './workstream-ops.js';
import { buildDependencyGraph } from '../engine/dependency.js';

export type ListMode = 'default' | 'full' | 'short';

export interface EnrichedTaskFields {
  description?: string;
  acceptance_criteria?: string[];
  blocked_by?: string[];
  blocks?: string[];
  created?: string | null;
  modified?: string | null;
  workstream_name?: string;
  workstream_display_id?: string;
}

export interface CreateTaskInput {
  project: string;
  workstream: number;
  name: string;
  mode?: TaskMode;
  category?: TaskCategory;
  priority?: TaskPriority;
  dependsOn?: string[];
  dueDate?: string;
  milestone?: string;
  description?: string;
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

  if (input.dueDate) {
    lines.push(`due_date: "${input.dueDate}"`);
  }
  if (input.milestone) {
    lines.push(`milestone: ${input.milestone}`);
  }

  lines.push(`created: ${now}`, `modified: ${now}`, '---', '', `# ${input.name}`, '');

  let content = lines.join('\n');
  if (input.description) {
    content += '\n' + input.description.replace(/\\n/g, '\n') + '\n';
  }
  return content;
}

function needsQuoting(value: string): boolean {
  return value.includes(' ') || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function replaceFrontmatterField(content: string, field: string, value: string): string {
  const endOfFrontmatter = content.indexOf('\n---', 4);
  if (endOfFrontmatter === -1) return content;

  const frontmatter = content.slice(0, endOfFrontmatter);
  const rest = content.slice(endOfFrontmatter);
  const fieldRegex = new RegExp(`^${field}:.*$`, 'm');
  const quoted = needsQuoting(value) ? `"${value}"` : value;

  if (fieldRegex.test(frontmatter)) {
    return frontmatter.replace(fieldRegex, `${field}: ${quoted}`) + rest;
  }
  return frontmatter + `\n${field}: ${quoted}` + rest;
}

function coerceDateField(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value;
  return String(value);
}

function taskMetaFromRecord(meta: Record<string, unknown>): TaskMetadata {
  return {
    id: meta.display_id as string,
    title: (meta.title as string) ?? undefined,
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
    due_date: coerceDateField(meta.due_date),
    milestone: meta.milestone as string | undefined,
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

export function getDependencyDisplayIds(db: BrainDB, taskNoteId: string): string[] {
  const relations = db.getRelationsFrom(taskNoteId);
  const depNoteIds = relations
    .filter((r) => r.type === 'depends_on')
    .map((r) => r.targetId);

  const displayIds: string[] = [];
  for (const noteId of depNoteIds) {
    const note = db.getNoteById(noteId);
    if (note?.metadata) {
      const meta = JSON.parse(note.metadata) as Record<string, unknown>;
      if (meta.display_id) displayIds.push(meta.display_id as string);
    }
  }
  return displayIds;
}

function mergeDependsOn(db: BrainDB, noteId: string, frontmatterDeps: string[] | undefined): string[] | undefined {
  const relationDeps = getDependencyDisplayIds(db, noteId);
  const fmDeps = frontmatterDeps ?? [];
  const allDeps = [...new Set([...fmDeps, ...relationDeps])];
  return allDeps.length > 0 ? allDeps : undefined;
}

export async function createTask(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  input: CreateTaskInput
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

  const relations: Relation[] = resolvedDepIds.map((dep) => ({
    sourceId: noteId,
    targetId: dep.noteId,
    type: 'depends_on',
  }));

  if (wsNotes.length > 0) {
    relations.push({ sourceId: wsNotes[0].id, targetId: noteId, type: 'parent' });
  }

  if (relations.length > 0) {
    db.upsertRelations(noteId, relations);
  }

  const metadata: TaskMetadata = {
    id: displayId,
    title: input.name,
    display_id: displayId,
    project: input.project,
    workstream: input.workstream,
    number,
    status: 'pending',
    mode: input.mode ?? 'auto',
    category: input.category ?? 'implementation',
    priority: input.priority ?? 'medium',
    depends_on: input.dependsOn,
    due_date: input.dueDate,
    milestone: input.milestone,
  };

  return ok(metadata);
}

function buildWorkstreamMap(
  db: BrainDB,
  project: string
): Map<number, { title: string; description?: string }> {
  const wsNotes = getPmNotes(db, 'workstream', { project });
  const map = new Map<number, { title: string; description?: string }>();
  for (const note of wsNotes) {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    const num = meta.number as number;
    const title = (meta.title as string) ?? '';
    const description = (meta.description as string) ?? undefined;
    map.set(num, { title, description });
  }
  return map;
}

export function listTasks(
  db: BrainDB,
  prefix: string,
  filters?: {
    workstream?: number;
    status?: string;
    mode?: string;
    priority?: string;
    category?: string;
    search?: string;
    dueBefore?: string;
    milestone?: string;
  },
  listMode: ListMode = 'default'
): Result<(TaskMetadata & EnrichedTaskFields & { virtualStates: VirtualState[] })[]> {
  const VIRTUAL_STATE_FILTERS: Record<string, VirtualState> = {
    blocked: '+BLOCKED',
    ready: '+READY',
    eligible: '+ELIGIBLE',
  };

  const virtualStateFilter = filters?.status
    ? VIRTUAL_STATE_FILTERS[filters.status.toLowerCase()]
    : undefined;

  const isSearch = !!filters?.search;

  const isStatusAll = filters?.status?.toLowerCase() === 'all';

  const filterObj: Record<string, unknown> = { project: prefix };
  if (filters?.workstream !== undefined) filterObj.workstream = filters.workstream;
  // When searching, query all statuses by default (unless explicit --status)
  // 'all' means no status filter; virtual state filters are handled post-hoc
  if (filters?.status !== undefined && !virtualStateFilter && !isStatusAll) filterObj.status = filters.status;
  if (filters?.mode !== undefined) filterObj.mode = filters.mode;
  if (filters?.priority !== undefined) filterObj.priority = filters.priority;
  if (filters?.category !== undefined) filterObj.category = filters.category;

  const notes = getPmNotes(db, 'task', filterObj);

  // Build reverse dependency graph once (cache per list call)
  const depGraph = listMode !== 'short' ? buildDependencyGraph(db, prefix) : null;

  // Build workstream lookup for name/display_id enrichment
  const wsMap = new Map<number, { name: string; display_id: string }>();
  if (listMode !== 'short') {
    const wsResult = listWorkstreams(db, prefix);
    if (wsResult.ok) {
      for (const ws of wsResult.data) {
        wsMap.set(ws.number, { name: ws.title ?? '', display_id: ws.display_id });
      }
    }
  }

  let tasks = notes.map((note) => {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    const taskMeta = taskMetaFromRecord(meta);

    // Merge depends_on from relations table (single source of truth)
    taskMeta.depends_on = mergeDependsOn(db, note.id, taskMeta.depends_on);

    const hasDependencies = !!(taskMeta.depends_on && taskMeta.depends_on.length > 0);
    const dependenciesComplete = areDependenciesComplete(db, taskMeta.depends_on);

    const virtualStates = computeVirtualState({
      status: taskMeta.status,
      hasDependencies,
      dependenciesComplete,
      claimedAt: taskMeta.claimed_at,
      dueDate: taskMeta.due_date,
    });

    const enriched: EnrichedTaskFields = {};

    // Read body when enriching or when searching (need body for search matching)
    const needsBody = listMode !== 'short' || isSearch;
    const body = needsBody ? readTaskBody(note) : '';

    if (listMode !== 'short') {
      enriched.description = listMode === 'full' ? body : body.slice(0, 500);

      const acMatch = body.match(/acceptance criteria[:\s]*\n((?:[-*]\s+.+\n?)+)/i);
      enriched.acceptance_criteria = acMatch
        ? acMatch[1]
            .split('\n')
            .filter((l) => l.trim().startsWith('-') || l.trim().startsWith('*'))
            .map((l) => l.replace(/^[\s]*[-*]\s+/, '').trim())
        : [];

      // blocked_by = upstream prerequisites (tasks I wait on)
      const blockedBy = getDependencyDisplayIds(db, note.id);
      enriched.blocked_by = blockedBy.length > 0 ? blockedBy : undefined;

      // blocks = downstream dependents (tasks waiting on me)
      const blocksMe: string[] = [];
      const reverseRelations = db.getRelationsTo(note.id);
      for (const rel of reverseRelations) {
        if (rel.type === 'depends_on') {
          const sourceNote = db.getNoteById(rel.sourceId);
          if (sourceNote?.metadata) {
            const meta2 = JSON.parse(sourceNote.metadata) as Record<string, unknown>;
            if (meta2.display_id) blocksMe.push(meta2.display_id as string);
          }
        }
      }
      enriched.blocks = blocksMe.length > 0 ? blocksMe : undefined;

      enriched.created = note.createdAt ?? (meta.created as string) ?? null;
      enriched.modified = note.modifiedAt ?? (meta.modified as string) ?? null;

      const wsInfo = taskMeta.workstream !== undefined ? wsMap.get(taskMeta.workstream) : undefined;
      if (wsInfo) {
        enriched.workstream_name = wsInfo.name;
        enriched.workstream_display_id = wsInfo.display_id;
      }
    }

    return { ...taskMeta, ...enriched, virtualStates, _body: body };
  });

  if (filters?.dueBefore) {
    const cutoff = filters.dueBefore;
    tasks = tasks.filter((t) => t.due_date && t.due_date <= cutoff);
  }

  if (filters?.milestone) {
    const ms = filters.milestone;
    tasks = tasks.filter((t) => t.milestone === ms);
  }

  if (filters?.search) {
    const searchLower = filters.search.toLowerCase();
    tasks = tasks.filter((t) => {
      const titleMatch = !!t.title?.toLowerCase().includes(searchLower);
      const bodyMatch = !!t._body?.toLowerCase().includes(searchLower);
      const displayIdMatch = !!t.display_id?.toLowerCase().includes(searchLower);
      return titleMatch || bodyMatch || displayIdMatch;
    });
  }

  if (virtualStateFilter) {
    const filterName = filters!.status!.toLowerCase();
    tasks = tasks.filter((t) =>
      t.virtualStates.includes(virtualStateFilter) || t.status === filterName
    );
  }

  // Strip internal _body field before returning
  const cleaned = tasks.map(({ _body, ...rest }) => rest);
  return ok(cleaned);
}

function didYouMeanTask(db: BrainDB, displayId: string): string | undefined {
  const parsed = parseDisplayId(displayId);
  if (!parsed || parsed.workstream === undefined || parsed.task === undefined) return undefined;

  const allTasks = getPmNotes(db, 'task');
  for (const note of allTasks) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.workstream === parsed.workstream && meta.number === parsed.task) {
      return meta.display_id as string;
    }
  }
  return undefined;
}

export function getTask(
  db: BrainDB,
  displayId: string
): Result<TaskMetadata & { virtualStates: VirtualState[] }> {
  const notes = getPmNotes(db, 'task', { display_id: displayId });
  if (notes.length === 0) {
    const suggestion = didYouMeanTask(db, displayId);
    const hint = suggestion ? ` Did you mean "${suggestion}"?` : '';
    return fail('NOT_FOUND', `Task "${displayId}" not found.${hint}`);
  }

  const taskNote = notes[0];
  const meta = JSON.parse(taskNote.metadata!) as Record<string, unknown>;
  const taskMeta = taskMetaFromRecord(meta);

  // Merge depends_on from relations table (single source of truth)
  taskMeta.depends_on = mergeDependsOn(db, taskNote.id, taskMeta.depends_on);

  const hasDependencies = !!(taskMeta.depends_on && taskMeta.depends_on.length > 0);
  const dependenciesComplete = areDependenciesComplete(db, taskMeta.depends_on);

  const virtualStates = computeVirtualState({
    status: taskMeta.status,
    hasDependencies,
    dependenciesComplete,
    claimedAt: taskMeta.claimed_at,
    dueDate: taskMeta.due_date,
  });

  return ok({ ...taskMeta, virtualStates });
}

export async function updateTaskStatus(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  displayId: string,
  newStatus: TaskStatus
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
    return fail(
      'INVALID_TRANSITION',
      transitionResult.error.message,
      transitionResult.error.details
    );
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
  updates: Partial<Pick<TaskMetadata, 'mode' | 'category' | 'priority' | 'due_date' | 'milestone'>>
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
  if (updates.due_date !== undefined) {
    content = replaceFrontmatterField(content, 'due_date', updates.due_date);
  }
  if (updates.milestone !== undefined) {
    content = replaceFrontmatterField(content, 'milestone', updates.milestone);
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
  force?: boolean
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
        { count: dependents.length }
      );
    }
  }

  const parsed = parseDisplayId(displayId);
  const contentDir = parsed ? taskContentDirPath(config, parsed.prefix, displayId) : null;

  db.deleteNote(taskNote.id);
  if (existsSync(taskNote.filePath)) {
    unlinkSync(taskNote.filePath);
  }

  if (contentDir && existsSync(contentDir)) {
    rmSync(contentDir, { recursive: true, force: true });
  }

  return ok(undefined);
}
