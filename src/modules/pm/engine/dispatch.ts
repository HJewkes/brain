import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { Result } from '../errors.js';
import type { TaskMetadata, DecisionMetadata, PromptMetadata } from '../types.js';
import { ok, fail } from '../errors.js';
import { getPmNotes } from '../data/queries.js';

export interface DependencySummary {
  displayId: string;
  name: string;
  status: string;
  summary?: string;
}

export interface DecisionSummary {
  displayId: string;
  status: string;
  content: string;
}

export interface ContextBundle {
  task: TaskMetadata;
  body: string;
  workstream?: { displayId: string; title: string };
  relatedNotes: Array<{ title: string; excerpt: string; score: number }>;
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

function buildDependencySummaries(db: BrainDB, dependsOn: string[]): DependencySummary[] {
  const summaries: DependencySummary[] = [];
  for (const depId of dependsOn) {
    const depNotes = getPmNotes(db, 'task', { display_id: depId });
    if (depNotes.length === 0) continue;

    const depNote = depNotes[0];
    const meta = JSON.parse(depNote.metadata!) as TaskMetadata;
    summaries.push({
      displayId: depId,
      name: depNote.title,
      status: meta.status,
      summary: readTaskSummary(depNote),
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

export function assembleContext(db: BrainDB, taskDisplayId: string): Result<ContextBundle> {
  const taskNotes = getPmNotes(db, 'task', { display_id: taskDisplayId });
  if (taskNotes.length === 0) {
    return fail('NOT_FOUND', `Task "${taskDisplayId}" not found`);
  }

  const taskNote = taskNotes[0];
  const task = JSON.parse(taskNote.metadata!) as TaskMetadata;
  const body = readTaskBody(taskNote);
  const workstream = findWorkstreamInfo(db, task.project, task.workstream);
  const dependencies = buildDependencySummaries(db, task.depends_on ?? []);
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

export function isContextStale(bundle: ContextBundle, db: BrainDB): boolean {
  const taskNotes = getPmNotes(db, 'task', { display_id: bundle.task.display_id });
  if (taskNotes.length === 0) return true;

  const task = JSON.parse(taskNotes[0].metadata!) as TaskMetadata;
  const dependencies = buildDependencySummaries(db, task.depends_on ?? []);
  const decisions = findImpactingDecisions(db, bundle.task.display_id, task.project);
  const prompt = findPromptContent(db, bundle.task.display_id, task.project);
  const currentHash = computeHash(task, dependencies, decisions, prompt);

  return currentHash !== bundle.contextHash;
}
