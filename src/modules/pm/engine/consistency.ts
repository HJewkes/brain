import type { BrainDB } from '../../../services/brain-db.js';
import { getPmNotes, resolveDisplayId } from '../data/queries.js';
import { getDecision } from '../data/decision-ops.js';
import { getPrompt } from '../data/prompt-ops.js';

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

export interface StalePrompt {
  id: string;
  task: string;
  taskTitle: string;
  promptIndexedAt: string;
  newerDecisions: {
    id: string;
    title: string;
    indexedAt: string;
  }[];
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

function getIndexedAt(db: BrainDB, filePath: string): number {
  const file = db.getFile(filePath);
  return file?.indexedAt ?? 0;
}

export interface DecisionPair {
  decision1: { id: string; title: string; content: string; status: string; impacts: string[] };
  decision2: { id: string; title: string; content: string; status: string; impacts: string[] };
  sharedImpacts: string[];
  reason: string;
}

export interface TaskDecisionPair {
  task: { id: string; title: string; category: string; status: string };
  decisions: { id: string; title: string; content: string; status: string }[];
  prompt?: string;
  reason: string;
}

export interface SourceDocCluster {
  topic: string;
  documents: {
    noteId: string;
    title: string;
    source?: string;
    sourceUrl?: string;
    indexedAt: string;
    excerpt: string;
  }[];
  reason: string;
}

export interface SupersessionGap {
  older: { id: string; title: string; content: string; createdAt: string };
  newer: { id: string; title: string; content: string; createdAt: string };
  sharedContext: string;
  reason: string;
}

export function findStalePrompts(db: BrainDB, prefix: string): StalePrompt[] {
  const currentPrompts = getPmNotes(db, 'prompt', { project: prefix, prompt_status: 'current' });
  if (currentPrompts.length === 0) return [];

  const decisionNotes = getPmNotes(db, 'decision', { project: prefix });
  const results: StalePrompt[] = [];

  for (const promptNote of currentPrompts) {
    const promptMeta = JSON.parse(promptNote.metadata!) as Record<string, unknown>;
    const taskDisplayId = promptMeta.task as string;
    const promptIndexedAt = getIndexedAt(db, promptNote.filePath);
    const newerDecisions: StalePrompt['newerDecisions'] = [];

    for (const decNote of decisionNotes) {
      const decMeta = JSON.parse(decNote.metadata!) as Record<string, unknown>;
      const impacts = decMeta.impacts as string[] | undefined;
      if (!impacts || !impacts.includes(taskDisplayId)) continue;

      const decIndexedAt = getIndexedAt(db, decNote.filePath);
      if (decIndexedAt > promptIndexedAt) {
        newerDecisions.push({
          id: decMeta.display_id as string,
          title: decNote.title ?? (decMeta.display_id as string),
          indexedAt: new Date(decIndexedAt).toISOString(),
        });
      }
    }

    if (newerDecisions.length > 0) {
      const taskNotes = getPmNotes(db, 'task', { display_id: taskDisplayId });
      const taskTitle = taskNotes.length > 0 ? (taskNotes[0].title ?? taskDisplayId) : taskDisplayId;

      results.push({
        id: promptMeta.display_id as string,
        task: taskDisplayId,
        taskTitle,
        promptIndexedAt: new Date(promptIndexedAt).toISOString(),
        newerDecisions,
        reason: `Prompt is older than ${newerDecisions.length} impacting decision(s)`,
      });
    }
  }

  return results;
}

export function computeDecisionPairs(db: BrainDB, prefix: string): DecisionPair[] {
  const decNotes = getPmNotes(db, 'decision', { project: prefix });
  const decisions = decNotes.map((note) => {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    const result = getDecision(db, meta.display_id as string);
    const content = result.ok ? result.data.content : '';
    return {
      id: meta.display_id as string,
      title: note.title ?? (meta.display_id as string),
      content,
      status: meta.status as string,
      impacts: (meta.impacts as string[] | undefined) ?? [],
    };
  });

  const pairs: DecisionPair[] = [];
  for (let i = 0; i < decisions.length; i++) {
    for (let j = i + 1; j < decisions.length; j++) {
      const shared = decisions[i].impacts.filter((id) => decisions[j].impacts.includes(id));
      if (shared.length > 0) {
        pairs.push({
          decision1: decisions[i],
          decision2: decisions[j],
          sharedImpacts: shared,
          reason: `Both affect ${shared.join(', ')} — check for contradictions`,
        });
      }
    }
  }

  return pairs;
}

export function computeTaskDecisionAlignment(db: BrainDB, prefix: string): TaskDecisionPair[] {
  const taskNotes = getPmNotes(db, 'task', { project: prefix });
  const decNotes = getPmNotes(db, 'decision', { project: prefix });
  const results: TaskDecisionPair[] = [];

  for (const taskNote of taskNotes) {
    const taskMeta = JSON.parse(taskNote.metadata!) as Record<string, unknown>;
    const taskDisplayId = taskMeta.display_id as string;

    const impactingDecisions: TaskDecisionPair['decisions'] = [];
    for (const decNote of decNotes) {
      const decMeta = JSON.parse(decNote.metadata!) as Record<string, unknown>;
      const impacts = (decMeta.impacts as string[] | undefined) ?? [];
      if (impacts.includes(taskDisplayId)) {
        const result = getDecision(db, decMeta.display_id as string);
        impactingDecisions.push({
          id: decMeta.display_id as string,
          title: decNote.title ?? (decMeta.display_id as string),
          content: result.ok ? result.data.content : '',
          status: decMeta.status as string,
        });
      }
    }

    if (impactingDecisions.length === 0) continue;

    const promptResult = getPrompt(db, taskDisplayId);
    const prompt = promptResult.ok ? promptResult.data.content : undefined;

    results.push({
      task: {
        id: taskDisplayId,
        title: taskNote.title ?? taskDisplayId,
        category: (taskMeta.category as string) ?? 'unknown',
        status: taskMeta.status as string,
      },
      decisions: impactingDecisions,
      prompt,
      reason: `Task has ${impactingDecisions.length} impacting decision(s) — check alignment`,
    });
  }

  return results;
}

export function computeSupersessionGaps(db: BrainDB, prefix: string): SupersessionGap[] {
  const decNotes = getPmNotes(db, 'decision', { project: prefix });
  const gaps: SupersessionGap[] = [];

  const bySourceTask = new Map<string, typeof decNotes>();
  for (const note of decNotes) {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    const sourceTask = meta.source_task as string;
    if (!bySourceTask.has(sourceTask)) {
      bySourceTask.set(sourceTask, []);
    }
    bySourceTask.get(sourceTask)!.push(note);
  }

  const supersededIds = new Set<string>();
  for (const note of decNotes) {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    if (meta.status === 'superseded') {
      supersededIds.add(meta.display_id as string);
    }
  }

  for (const [sourceTask, notes] of bySourceTask) {
    if (notes.length < 2) continue;

    const sorted = notes
      .map((n) => ({
        note: n,
        meta: JSON.parse(n.metadata!) as Record<string, unknown>,
        indexedAt: getIndexedAt(db, n.filePath),
      }))
      .sort((a, b) => a.indexedAt - b.indexedAt);

    for (let i = 0; i < sorted.length - 1; i++) {
      const older = sorted[i];
      const newer = sorted[i + 1];
      const olderId = older.meta.display_id as string;

      if (supersededIds.has(olderId)) continue;

      const olderResult = getDecision(db, olderId);
      const newerId = newer.meta.display_id as string;
      const newerResult = getDecision(db, newerId);

      gaps.push({
        older: {
          id: olderId,
          title: older.note.title ?? olderId,
          content: olderResult.ok ? olderResult.data.content : '',
          createdAt: new Date(older.indexedAt).toISOString(),
        },
        newer: {
          id: newerId,
          title: newer.note.title ?? newerId,
          content: newerResult.ok ? newerResult.data.content : '',
          createdAt: new Date(newer.indexedAt).toISOString(),
        },
        sharedContext: `Both created for task ${sourceTask}`,
        reason: `Both created for task ${sourceTask}, no supersession relation`,
      });
    }
  }

  return gaps;
}

function extractTopicKey(title: string): string {
  return title
    .replace(/\s*[vV]\d+\s*$/g, '')
    .replace(/\s*\d{4}-\d{2}-\d{2}\s*$/g, '')
    .replace(/\s*#\d+\s*$/g, '')
    .replace(/\s*\(\d+\)\s*$/g, '')
    .trim()
    .toLowerCase();
}

export function clusterSourceDocuments(db: BrainDB): SourceDocCluster[] {
  const allNotes = db.getAllNotes();
  const sourceDocs = allNotes.filter(
    (note): note is typeof note & { title: string } => !note.module && note.title != null,
  );

  if (sourceDocs.length === 0) return [];

  const groups = new Map<string, typeof sourceDocs>();
  for (const note of sourceDocs) {
    const key = extractTopicKey(note.title);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(note);
  }

  const clusters: SourceDocCluster[] = [];
  for (const [, notes] of groups) {
    if (notes.length < 2) continue;

    const docs = notes.map((note) => {
      const meta = note.metadata ? JSON.parse(note.metadata) as Record<string, unknown> : {};
      const indexedAt = getIndexedAt(db, note.filePath);
      return {
        noteId: note.id,
        title: note.title,
        source: meta.source as string | undefined,
        sourceUrl: meta.sourceUrl as string | undefined,
        indexedAt: new Date(indexedAt).toISOString(),
        excerpt: note.title.slice(0, 300),
        _indexedAtNum: indexedAt,
      };
    });

    docs.sort((a, b) => b._indexedAtNum - a._indexedAtNum || b.title.localeCompare(a.title));

    const span = docs.length > 1
      ? Math.round((docs[0]._indexedAtNum - docs[docs.length - 1]._indexedAtNum) / (1000 * 60 * 60 * 24))
      : 0;

    clusters.push({
      topic: notes[0].title.replace(/\s*[vV]\d+\s*$/, ''),
      documents: docs.map((d) => ({
        noteId: d.noteId,
        title: d.title,
        source: d.source,
        sourceUrl: d.sourceUrl,
        indexedAt: d.indexedAt,
        excerpt: d.excerpt,
      })),
      reason: `${notes.length} docs on same topic${span > 0 ? ` spanning ${span} days` : ''} — check for supersession`,
    });
  }

  return clusters;
}

export interface ConsistencyReport {
  project: string;
  timestamp: string;
  summary: {
    totalTasks: number;
    totalDecisions: number;
    totalPrompts: number;
    sourceDocuments: number;
    issuesFound: number;
  };
  structural: {
    orphanedDecisions: OrphanedDecision[];
    stalePrompts: StalePrompt[];
    brokenDependencies: BrokenDep[];
    blockedWithoutCause: BlockedTask[];
    cancelledDependencies: CancelledDep[];
  };
  semantic?: {
    decisionPairs: DecisionPair[];
    taskDecisionAlignment: TaskDecisionPair[];
    supersessionGaps: SupersessionGap[];
  };
  sourceDocuments?: SourceDocCluster[];
}

export function runConsistencyCheck(db: BrainDB, prefix: string, deep: boolean): ConsistencyReport {
  const orphanedDecisions = findOrphanedDecisions(db, prefix);
  const stalePrompts = findStalePrompts(db, prefix);
  const brokenDependencies = findBrokenDependencies(db, prefix);
  const blockedWithoutCause = findBlockedWithoutCause(db, prefix);
  const cancelledDependencies = findCancelledDependencies(db, prefix);

  const structural = {
    orphanedDecisions,
    stalePrompts,
    brokenDependencies,
    blockedWithoutCause,
    cancelledDependencies,
  };

  const totalTasks = getPmNotes(db, 'task', { project: prefix }).length;
  const totalDecisions = getPmNotes(db, 'decision', { project: prefix }).length;
  const totalPrompts = getPmNotes(db, 'prompt', { project: prefix }).length;

  let semantic: ConsistencyReport['semantic'];
  let sourceDocuments: SourceDocCluster[] | undefined;

  if (deep) {
    semantic = {
      decisionPairs: computeDecisionPairs(db, prefix),
      taskDecisionAlignment: computeTaskDecisionAlignment(db, prefix),
      supersessionGaps: computeSupersessionGaps(db, prefix),
    };
    sourceDocuments = clusterSourceDocuments(db);
  }

  const structuralCount =
    orphanedDecisions.length +
    stalePrompts.length +
    brokenDependencies.length +
    blockedWithoutCause.length +
    cancelledDependencies.length;

  const semanticCount = semantic
    ? semantic.decisionPairs.length + semantic.supersessionGaps.length
    : 0;

  return {
    project: prefix,
    timestamp: new Date().toISOString(),
    summary: {
      totalTasks,
      totalDecisions,
      totalPrompts,
      sourceDocuments: sourceDocuments?.reduce((sum, c) => sum + c.documents.length, 0) ?? 0,
      issuesFound: structuralCount + semanticCount,
    },
    structural,
    ...(semantic ? { semantic } : {}),
    ...(sourceDocuments ? { sourceDocuments } : {}),
  };
}
