import type { BrainDB } from '../../../services/brain-db.js';
import { getPmNotes, resolveDisplayId } from '../data/queries.js';

export interface OrphanedDecision {
  id: string;
  title: string;
  status: string;
  sourceTask: string;
  content: string;
  reason: string;
}

export interface BrokenDep {
  task: string;
  taskTitle: string;
  dependsOn: string;
  reason: string;
}

export interface BlockedTask {
  id: string;
  title: string;
  status: string;
  dependencies: string[];
  allDepsStatus: string;
  reason: string;
}

export interface CancelledDep {
  task: string;
  taskTitle: string;
  dependsOn: string;
  dependsOnStatus: string;
  reason: string;
}

export function findOrphanedDecisions(db: BrainDB, prefix: string): OrphanedDecision[] {
  const notes = getPmNotes(db, 'decision', { project: prefix });
  const orphans: OrphanedDecision[] = [];

  for (const note of notes) {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    const impacts = meta.impacts as string[] | undefined;
    if (!impacts || impacts.length === 0) {
      orphans.push({
        id: meta.display_id as string,
        title: note.title ?? (meta.display_id as string),
        status: meta.status as string,
        sourceTask: meta.source_task as string,
        content: (note.title ?? '').slice(0, 200),
        reason: 'No tasks listed in impacts[]',
      });
    }
  }

  return orphans;
}

export function findBrokenDependencies(db: BrainDB, prefix: string): BrokenDep[] {
  const tasks = getPmNotes(db, 'task', { project: prefix });
  const broken: BrokenDep[] = [];

  for (const task of tasks) {
    const meta = JSON.parse(task.metadata!) as Record<string, unknown>;
    const deps = meta.depends_on as string[] | undefined;
    if (!deps) continue;

    for (const dep of deps) {
      const resolved = resolveDisplayId(db, dep);
      if (!resolved.ok) {
        broken.push({
          task: meta.display_id as string,
          taskTitle: task.title ?? (meta.display_id as string),
          dependsOn: dep,
          reason: 'Target task does not exist',
        });
      }
    }
  }

  return broken;
}

export function findBlockedWithoutCause(db: BrainDB, prefix: string): BlockedTask[] {
  const blockedTasks = getPmNotes(db, 'task', { project: prefix, status: 'blocked' });
  const allTasks = getPmNotes(db, 'task', { project: prefix });
  const results: BlockedTask[] = [];

  const statusMap = new Map<string, string>();
  for (const t of allTasks) {
    const m = JSON.parse(t.metadata!) as Record<string, unknown>;
    statusMap.set(m.display_id as string, m.status as string);
  }

  for (const task of blockedTasks) {
    const meta = JSON.parse(task.metadata!) as Record<string, unknown>;
    const deps = meta.depends_on as string[] | undefined;
    if (!deps || deps.length === 0) {
      results.push({
        id: meta.display_id as string,
        title: task.title ?? (meta.display_id as string),
        status: 'blocked',
        dependencies: [],
        allDepsStatus: 'no dependencies',
        reason: 'Task is blocked but has no dependencies',
      });
      continue;
    }

    const allDone = deps.every((d) => statusMap.get(d) === 'done');
    if (allDone) {
      results.push({
        id: meta.display_id as string,
        title: task.title ?? (meta.display_id as string),
        status: 'blocked',
        dependencies: deps,
        allDepsStatus: 'all dependencies are done',
        reason: 'Task is blocked but all dependencies are done',
      });
    }
  }

  return results;
}

export function findCancelledDependencies(db: BrainDB, prefix: string): CancelledDep[] {
  const tasks = getPmNotes(db, 'task', { project: prefix });
  const results: CancelledDep[] = [];

  const statusMap = new Map<string, string>();
  for (const t of tasks) {
    const m = JSON.parse(t.metadata!) as Record<string, unknown>;
    statusMap.set(m.display_id as string, m.status as string);
  }

  for (const task of tasks) {
    const meta = JSON.parse(task.metadata!) as Record<string, unknown>;
    const status = meta.status as string;
    if (status === 'done' || status === 'cancelled') continue;

    const deps = meta.depends_on as string[] | undefined;
    if (!deps) continue;

    for (const dep of deps) {
      if (statusMap.get(dep) === 'cancelled') {
        results.push({
          task: meta.display_id as string,
          taskTitle: task.title ?? (meta.display_id as string),
          dependsOn: dep,
          dependsOnStatus: 'cancelled',
          reason: `Depends on cancelled task ${dep}`,
        });
      }
    }
  }

  return results;
}
