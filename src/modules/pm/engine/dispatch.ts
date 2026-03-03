import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { Embedder, BrainConfig } from '../../../types.js';
import type { Result } from '../errors.js';
import type { TaskMetadata, DecisionMetadata, PromptMetadata } from '../types.js';
import { ok, fail } from '../errors.js';
import { getPmNotes } from '../data/queries.js';
import { search } from '../../../services/search.js';
import { listTasks } from '../data/task-ops.js';
import { computeEligible } from './dependency.js';
import { computeGraphScores } from '../../../services/graph.js';
import type { GraphScore } from '../../../services/graph.js';

export interface DependencySummary {
  displayId: string;
  name: string;
  status: string;
  summary?: string;
  direction?: 'upstream' | 'downstream';
}

export interface ContextOptions {
  deps?: boolean;
}

export interface DecisionSummary {
  displayId: string;
  status: string;
  content: string;
}

export interface DispatchBundle extends ContextBundle {
  peerTasks: Array<{ displayId: string; title: string; status: string }>;
  workstreamDescription: string;
  downstreamDependents: Array<{ displayId: string; title: string }>;
}

export interface ContextBundle {
  task: TaskMetadata;
  body: string;
  workstream?: { displayId: string; title: string };
  relatedNotes: Array<{ title: string; excerpt: string; score: number; source: 'linked' | 'graph' | 'semantic'; relationType?: string; depth?: number }>;
  prompt?: string;
  dependencies: DependencySummary[];
  decisions: DecisionSummary[];
  constraints: string[];
  contextHash: string;
}

function readTaskSummary(note: { contentDir: string | null }): string | undefined {
  if (!note.contentDir) return undefined;
  const summaryPath = join(note.contentDir, 'summary.md');
  if (!existsSync(summaryPath)) return undefined;
  return readFileSync(summaryPath, 'utf-8').trim();
}

export function readTaskBody(note: { filePath: string }): string {
  if (!existsSync(note.filePath)) return '';
  const content = readFileSync(note.filePath, 'utf-8');
  const fmEnd = content.indexOf('\n---', 4);
  if (fmEnd === -1) return '';
  let body = content.slice(fmEnd + 4).trim();
  if (body.startsWith('#')) {
    const headingEnd = body.indexOf('\n');
    if (headingEnd === -1) return '';
    body = body.slice(headingEnd + 1).trim();
  }
  return body;
}

function findWorkstreamInfo(
  db: BrainDB,
  project: string,
  workstreamNum: number
): { displayId: string; title: string } | undefined {
  const wsDisplayId = `${project}-${String(workstreamNum).padStart(2, '0')}`;
  const wsNotes = getPmNotes(db, 'workstream', { display_id: wsDisplayId });
  if (wsNotes.length === 0) return undefined;
  const meta = JSON.parse(wsNotes[0].metadata!) as Record<string, unknown>;
  const rawTitle = (meta.title as string) ?? '';
  const title = rawTitle.replace(/^Workstream\s+/i, '') || `#${workstreamNum}`;
  return { displayId: wsDisplayId, title };
}

function buildDependencySummaries(db: BrainDB, taskNoteId: string, dependsOn: string[]): DependencySummary[] {
  const summaries: DependencySummary[] = [];
  const seen = new Set<string>();

  // Upstream from relations table: tasks this task depends on
  const upstreamRelations = db.getRelationsFrom(taskNoteId)
    .filter((r) => r.type === 'depends_on');
  for (const rel of upstreamRelations) {
    const note = db.getNoteById(rel.targetId);
    if (!note?.metadata) continue;
    const meta = JSON.parse(note.metadata) as TaskMetadata;
    if (!meta.display_id) continue;
    seen.add(meta.display_id);
    summaries.push({
      displayId: meta.display_id,
      name: note.title,
      status: meta.status,
      summary: readTaskSummary(note),
      direction: 'upstream',
    });
  }

  // Upstream from frontmatter depends_on (fallback for legacy data)
  for (const depId of dependsOn) {
    if (seen.has(depId)) continue;
    const depNotes = getPmNotes(db, 'task', { display_id: depId });
    if (depNotes.length === 0) continue;
    const depNote = depNotes[0];
    const meta = JSON.parse(depNote.metadata!) as TaskMetadata;
    seen.add(depId);
    summaries.push({
      displayId: depId,
      name: depNote.title,
      status: meta.status,
      summary: readTaskSummary(depNote),
      direction: 'upstream',
    });
  }

  // Downstream from relations table: tasks that depend on this task
  const downstreamRelations = db.getRelationsTo(taskNoteId)
    .filter((r) => r.type === 'depends_on');
  for (const rel of downstreamRelations) {
    const note = db.getNoteById(rel.sourceId);
    if (!note?.metadata) continue;
    const meta = JSON.parse(note.metadata) as TaskMetadata;
    if (!meta.display_id) continue;
    summaries.push({
      displayId: meta.display_id,
      name: note.title,
      status: meta.status,
      summary: readTaskSummary(note),
      direction: 'downstream',
    });
  }

  return summaries;
}

function findImpactingDecisions(
  db: BrainDB,
  taskDisplayId: string,
  project: string
): DecisionSummary[] {
  const decisionNotes = getPmNotes(db, 'decision', { project });
  const results: DecisionSummary[] = [];

  for (const note of decisionNotes) {
    const meta = JSON.parse(note.metadata!) as DecisionMetadata;
    if (meta.impacts && meta.impacts.includes(taskDisplayId)) {
      results.push({
        displayId: meta.display_id,
        status: meta.status,
        content: note.title,
      });
    }
  }

  return results;
}

function findPromptContent(
  db: BrainDB,
  taskDisplayId: string,
  project: string
): string | undefined {
  const promptNotes = getPmNotes(db, 'prompt', { task: taskDisplayId, project });
  if (promptNotes.length === 0) return undefined;

  const note = promptNotes[0];
  const meta = JSON.parse(note.metadata!) as PromptMetadata;
  if (meta.prompt_status === 'superseded') return undefined;

  return note.title;
}

function computeHash(
  task: TaskMetadata,
  deps: DependencySummary[],
  decisions: DecisionSummary[],
  prompt: string | undefined
): string {
  const payload = JSON.stringify({ task, deps, decisions, prompt });
  return createHash('sha256').update(payload).digest('hex');
}

export function assembleContext(
  db: BrainDB,
  taskDisplayId: string,
  options?: ContextOptions
): Result<ContextBundle> {
  const taskNotes = getPmNotes(db, 'task', { display_id: taskDisplayId });
  if (taskNotes.length === 0) {
    return fail('NOT_FOUND', `Task "${taskDisplayId}" not found`);
  }

  const taskNote = taskNotes[0];
  const task = JSON.parse(taskNote.metadata!) as TaskMetadata;
  const body = readTaskBody(taskNote);
  const workstream = findWorkstreamInfo(db, task.project, task.workstream);
  const includeDeps = options?.deps !== false;
  const dependencies = includeDeps
    ? buildDependencySummaries(db, taskNote.id, task.depends_on ?? [])
    : [];
  const decisions = findImpactingDecisions(db, taskDisplayId, task.project);
  const prompt = findPromptContent(db, taskDisplayId, task.project);
  const contextHash = computeHash(task, dependencies, decisions, prompt);

  return ok({
    task,
    body,
    workstream,
    relatedNotes: [],
    prompt,
    dependencies,
    decisions,
    constraints: [],
    contextHash,
  });
}

export async function assembleDispatch(
  db: BrainDB,
  embedder: Embedder,
  config: BrainConfig,
  taskDisplayId: string,
  options?: ContextOptions
): Promise<Result<DispatchBundle>> {
  const ctxResult = assembleContext(db, taskDisplayId, options);
  if (!ctxResult.ok) return ctxResult as Result<DispatchBundle>;
  const ctx = ctxResult.data;

  // Hybrid related notes: graph + semantic fusion
  const GRAPH_WEIGHT = 0.6;
  const SEMANTIC_WEIGHT = 0.4;

  // Find the task note for graph traversal
  const taskNotes = getPmNotes(db, 'task', { display_id: taskDisplayId });
  const taskNote = taskNotes.length > 0 ? taskNotes[0] : undefined;

  // Graph pass: BFS traversal with distance-decayed scoring
  const graphScores = taskNote
    ? computeGraphScores(db, taskNote.id, 3)
    : new Map<string, GraphScore>();

  // Semantic pass: search with includePm for cross-module relevance
  const semanticScores = new Map<string, { score: number; title: string; excerpt: string }>();
  const searchQuery = [ctx.task.title, ctx.body].filter(Boolean).join(' ').trim();
  if (searchQuery) {
    try {
      const results = await search(
        db,
        embedder,
        searchQuery,
        { limit: 15, includePm: true },
        config.fusionWeights ?? { bm25: 0.4, vector: 0.6 }
      );
      const maxScore = results.length > 0 ? Math.max(...results.map((r) => r.score)) : 1;
      for (const r of results) {
        if (r.noteId === taskNote?.id) continue;
        const normalized = maxScore > 0 ? r.score / maxScore : 0;
        semanticScores.set(r.noteId, {
          score: normalized,
          title: r.heading ?? r.filePath,
          excerpt: r.excerpt ?? '',
        });
      }
    } catch {
      // Search failure is non-fatal
    }
  }

  // Fusion: combine graph and semantic scores
  const allNoteIds = new Set([...graphScores.keys(), ...semanticScores.keys()]);
  const fused: Array<{
    noteId: string;
    title: string;
    excerpt: string;
    score: number;
    source: 'linked' | 'graph' | 'semantic';
    relationType?: string;
    depth?: number;
  }> = [];

  for (const noteId of allNoteIds) {
    const gs = graphScores.get(noteId);
    const ss = semanticScores.get(noteId);
    const graphScore = gs?.score ?? 0;
    const semanticScore = ss?.score ?? 0;
    const finalScore = (GRAPH_WEIGHT * graphScore) + (SEMANTIC_WEIGHT * semanticScore);

    const source = gs && ss ? 'linked' : gs ? 'graph' : 'semantic';
    const title = ss?.title ?? db.getNoteById(noteId)?.title ?? noteId;
    const excerpt = ss?.excerpt ?? '';

    fused.push({
      noteId, title, excerpt, score: finalScore, source,
      relationType: gs?.relationType,
      depth: gs?.depth,
    });
  }

  fused.sort((a, b) => b.score - a.score);
  ctx.relatedNotes = fused.slice(0, 10).map((f) => ({
    title: f.title,
    excerpt: f.excerpt,
    score: f.score,
    source: f.source,
    relationType: f.relationType,
    depth: f.depth,
  }));

  // Peer tasks in same workstream
  const peersResult = listTasks(db, ctx.task.project, {
    workstream: ctx.task.workstream,
  });
  const peerTasks = peersResult.ok
    ? peersResult.data
        .filter((t) => t.display_id !== taskDisplayId)
        .map((t) => ({
          displayId: t.display_id,
          title: t.title ?? t.display_id,
          status: t.status as string,
        }))
    : [];

  // Workstream description
  const wsDescription = ctx.workstream
    ? findWorkstreamDescription(db, ctx.task.project, ctx.task.workstream)
    : '';

  // Downstream dependents (who depends on this task)
  const allTasksResult = listTasks(db, ctx.task.project);
  const downstreamDependents = allTasksResult.ok
    ? allTasksResult.data
        .filter((t) => t.depends_on?.includes(taskDisplayId))
        .map((t) => ({ displayId: t.display_id, title: t.title ?? t.display_id }))
    : [];

  return ok({
    ...ctx,
    peerTasks,
    workstreamDescription: wsDescription,
    downstreamDependents,
  });
}

function findWorkstreamDescription(
  db: BrainDB,
  project: string,
  workstreamNum: number
): string {
  const wsDisplayId = `${project}-${String(workstreamNum).padStart(2, '0')}`;
  const wsNotes = getPmNotes(db, 'workstream', { display_id: wsDisplayId });
  if (wsNotes.length === 0) return '';
  return readNoteBody(wsNotes[0]);
}

export interface ProjectContext {
  project: { prefix: string; name: string; status: string; phase?: string; description: string };
  workstreams: Array<{
    displayId: string;
    title: string;
    status: string;
    taskCount: number;
    doneCount: number;
  }>;
  criticalTasks: TaskMetadata[];
  statusDistribution: Record<string, number>;
  recentDecisions: DecisionSummary[];
}

export interface WorkstreamContext {
  workstream: { displayId: string; title: string; status: string; description: string };
  project: string;
  tasks: Array<{ displayId: string; title: string; status: string; priority: string }>;
  statusDistribution: Record<string, number>;
  eligibleTasks: string[];
  recentDecisions: DecisionSummary[];
  relatedNotes: Array<{ title: string; excerpt: string; score: number }>;
}

export function assembleProjectContext(
  db: BrainDB,
  prefix: string
): Result<ProjectContext> {
  const projectNotes = getPmNotes(db, 'project', { prefix });
  if (projectNotes.length === 0) {
    return fail('NOT_FOUND', `Project "${prefix}" not found`);
  }

  const projectNote = projectNotes[0];
  const meta = JSON.parse(projectNote.metadata!) as Record<string, unknown>;
  const body = readNoteBody(projectNote);

  const wsNotes = getPmNotes(db, 'workstream', { project: prefix });
  const workstreams: ProjectContext['workstreams'] = [];
  for (const ws of wsNotes) {
    const wsMeta = JSON.parse(ws.metadata!) as Record<string, unknown>;
    const wsNum = wsMeta.number as number;
    const wsDisplayId =
      (wsMeta.display_id as string) ?? `${prefix}-${String(wsNum).padStart(2, '0')}`;
    const tasks = listTasks(db, prefix, { workstream: wsNum });
    const taskList = tasks.ok ? tasks.data : [];
    workstreams.push({
      displayId: wsDisplayId,
      title: (wsMeta.title as string) ?? ws.title,
      status: (wsMeta.status as string) ?? 'active',
      taskCount: taskList.length,
      doneCount: taskList.filter((t) => t.status === 'done').length,
    });
  }

  const allTasks = listTasks(db, prefix, { priority: 'critical' });
  const criticalTasks: TaskMetadata[] = (allTasks.ok ? allTasks.data : [])
    .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
    .map((t) => { const { virtualStates, ...rest } = t; void virtualStates; return rest; });

  const allProjectTasks = listTasks(db, prefix);
  const dist: Record<string, number> = {};
  for (const t of allProjectTasks.ok ? allProjectTasks.data : []) {
    dist[t.status] = (dist[t.status] ?? 0) + 1;
  }

  const decisions = findProjectDecisions(db, prefix);

  return ok({
    project: {
      prefix,
      name: (meta.title as string) ?? (meta.name as string) ?? prefix,
      status: (meta.status as string) ?? 'active',
      phase: meta.phase as string | undefined,
      description: body,
    },
    workstreams,
    criticalTasks,
    statusDistribution: dist,
    recentDecisions: decisions,
  });
}

export async function assembleWorkstreamContext(
  db: BrainDB,
  wsDisplayId: string,
  embedder?: Embedder,
  config?: BrainConfig
): Promise<Result<WorkstreamContext>> {
  const wsNotes = getPmNotes(db, 'workstream', { display_id: wsDisplayId });
  if (wsNotes.length === 0) {
    return fail('NOT_FOUND', `Workstream "${wsDisplayId}" not found`);
  }

  const wsNote = wsNotes[0];
  const wsMeta = JSON.parse(wsNote.metadata!) as Record<string, unknown>;
  const wsNum = wsMeta.number as number;
  const prefix = wsMeta.project as string;
  const body = readNoteBody(wsNote);

  const tasks = listTasks(db, prefix, { workstream: wsNum });
  const taskList = tasks.ok ? tasks.data : [];
  const taskSummaries = taskList.map((t) => ({
    displayId: t.display_id,
    title: t.title ?? t.display_id,
    status: t.status as string,
    priority: t.priority as string,
  }));

  const dist: Record<string, number> = {};
  for (const t of taskList) {
    dist[t.status] = (dist[t.status] ?? 0) + 1;
  }

  const eligible = computeEligible(db, prefix).filter((id) =>
    taskList.some((t) => t.display_id === id)
  );

  const decisions = findProjectDecisions(db, prefix);

  // Semantic search for related knowledge base notes
  let relatedNotes: WorkstreamContext['relatedNotes'] = [];
  if (embedder && config) {
    const wsTitle = (wsMeta.title as string) ?? '';
    const taskTitles = taskList.slice(0, 3).map((t) => t.title ?? '').join(' ');
    const searchQuery = `${wsTitle} ${taskTitles}`.trim();

    if (searchQuery) {
      try {
        const results = await search(
          db,
          embedder,
          searchQuery,
          { limit: 5 },
          config.fusionWeights ?? { bm25: 0.4, vector: 0.6 }
        );
        relatedNotes = results.map((r) => ({
          title: r.heading ?? r.filePath,
          excerpt: r.excerpt ?? '',
          score: r.score,
        }));
      } catch {
        // Search failure is non-fatal
      }
    }
  }

  return ok({
    workstream: {
      displayId: wsDisplayId,
      title: (wsMeta.title as string) ?? wsNote.title,
      status: (wsMeta.status as string) ?? 'active',
      description: body,
    },
    project: prefix,
    tasks: taskSummaries,
    statusDistribution: dist,
    eligibleTasks: eligible,
    recentDecisions: decisions,
    relatedNotes,
  });
}

function readNoteBody(note: { filePath: string }): string {
  if (!existsSync(note.filePath)) return '';
  const content = readFileSync(note.filePath, 'utf-8');
  const fmEnd = content.indexOf('\n---', 4);
  if (fmEnd === -1) return '';
  let body = content.slice(fmEnd + 4).trim();
  if (body.startsWith('#')) {
    const headingEnd = body.indexOf('\n');
    if (headingEnd === -1) return '';
    body = body.slice(headingEnd + 1).trim();
  }
  return body;
}

function findProjectDecisions(db: BrainDB, project: string): DecisionSummary[] {
  const decisionNotes = getPmNotes(db, 'decision', { project });
  return decisionNotes.map((note) => {
    const meta = JSON.parse(note.metadata!) as DecisionMetadata;
    return {
      displayId: meta.display_id,
      status: meta.status,
      content: note.title,
    };
  });
}

export function isContextStale(bundle: ContextBundle, db: BrainDB): boolean {
  const taskNotes = getPmNotes(db, 'task', { display_id: bundle.task.display_id });
  if (taskNotes.length === 0) return true;

  const task = JSON.parse(taskNotes[0].metadata!) as TaskMetadata;
  const dependencies = buildDependencySummaries(db, taskNotes[0].id, task.depends_on ?? []);
  const decisions = findImpactingDecisions(db, bundle.task.display_id, task.project);
  const prompt = findPromptContent(db, bundle.task.display_id, task.project);
  const currentHash = computeHash(task, dependencies, decisions, prompt);

  return currentHash !== bundle.contextHash;
}
