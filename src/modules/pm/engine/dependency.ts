import type { BrainDB } from '../../../services/brain-db.js';
import type { Relation } from '../../../types.js';
import type { Result } from '../errors.js';
import type { TaskStatus } from '../types.js';
import { ok, fail } from '../errors.js';
import { getPmNotes } from '../data/queries.js';
import { listTasks } from '../data/task-ops.js';

interface TaskInfo {
  noteId: string;
  displayId: string;
  status: TaskStatus;
}

function getProjectTasks(db: BrainDB, prefix: string): TaskInfo[] {
  const notes = getPmNotes(db, 'task', { project: prefix });
  return notes.map((note) => {
    const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
    return {
      noteId: note.id,
      displayId: meta.display_id as string,
      status: meta.status as TaskStatus,
    };
  });
}

function buildNoteIdToDisplayId(tasks: TaskInfo[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of tasks) {
    map.set(t.noteId, t.displayId);
  }
  return map;
}

/** Build adjacency list: displayId -> [displayIds it depends on] */
export function buildDependencyGraph(db: BrainDB, prefix: string): Map<string, string[]> {
  const tasks = getProjectTasks(db, prefix);
  const noteToDisplay = buildNoteIdToDisplayId(tasks);
  const taskNoteIds = new Set(tasks.map((t) => t.noteId));
  const graph = new Map<string, string[]>();

  for (const t of tasks) {
    graph.set(t.displayId, []);
  }

  for (const t of tasks) {
    const relations = db.getRelationsFrom(t.noteId);
    for (const rel of relations) {
      if (rel.type === 'depends_on' && taskNoteIds.has(rel.targetId)) {
        const targetDisplay = noteToDisplay.get(rel.targetId);
        if (targetDisplay) {
          graph.get(t.displayId)!.push(targetDisplay);
        }
      }
    }
  }

  return graph;
}

/** Build reverse adjacency list: displayId -> [displayIds that depend on it] */
function buildReverseGraph(graph: Map<string, string[]>): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const key of graph.keys()) {
    reverse.set(key, []);
  }
  for (const [node, deps] of graph) {
    for (const dep of deps) {
      reverse.get(dep)?.push(node);
    }
  }
  return reverse;
}

/** Compute eligible tasks: pending with all deps done */
export function computeEligible(db: BrainDB, prefix: string): string[] {
  const tasks = getProjectTasks(db, prefix);
  const statusByDisplay = new Map<string, TaskStatus>();
  for (const t of tasks) {
    statusByDisplay.set(t.displayId, t.status);
  }

  const graph = buildDependencyGraph(db, prefix);
  const eligible: string[] = [];

  for (const t of tasks) {
    if (t.status !== 'pending') continue;

    const deps = graph.get(t.displayId) ?? [];
    const allDepsDone = deps.every((dep) => {
      const s = statusByDisplay.get(dep);
      return s === 'done' || s === 'pruned';
    });
    if (allDepsDone) {
      eligible.push(t.displayId);
    }
  }

  return eligible.sort();
}

/** Full-graph cycle detection using DFS with back-edge detection. */
export function detectCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): void {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      cycles.push(path.slice(cycleStart).concat(node));
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    inStack.add(node);
    path.push(node);
    for (const neighbor of graph.get(node) ?? []) {
      dfs(neighbor);
    }
    path.pop();
    inStack.delete(node);
  }

  for (const node of graph.keys()) {
    dfs(node);
  }
  return cycles;
}

/**
 * Incremental cycle detection: check if adding "fromId depends_on toId"
 * would create a cycle. DFS from toId following existing depends_on edges;
 * if we reach fromId, the proposed edge would close a cycle.
 */
export function detectCycle(
  db: BrainDB,
  prefix: string,
  fromDisplayId: string,
  toDisplayId: string
): Result<void> {
  if (fromDisplayId === toDisplayId) {
    return fail('CYCLE_DETECTED', `Self-dependency: ${fromDisplayId}`, {
      cycle: [fromDisplayId, toDisplayId],
    });
  }

  const graph = buildDependencyGraph(db, prefix);

  // DFS from toId following depends_on edges to see if we can reach fromId
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(current: string): string[] | null {
    if (current === fromDisplayId) {
      return [...path, current];
    }
    if (visited.has(current)) return null;
    visited.add(current);
    path.push(current);

    const deps = graph.get(current) ?? [];
    for (const dep of deps) {
      const cyclePath = dfs(dep);
      if (cyclePath) return cyclePath;
    }

    path.pop();
    return null;
  }

  const cyclePath = dfs(toDisplayId);
  if (cyclePath) {
    // Full cycle: fromId -> toId -> ... -> fromId
    const fullCycle = [fromDisplayId, ...cyclePath];
    return fail('CYCLE_DETECTED', `Cycle detected: ${fullCycle.join(' → ')}`, {
      cycle: fullCycle,
    });
  }

  return ok(undefined);
}

export interface WaveAssignment {
  wave: number;
  taskIds: string[];
}

/** Topological wave grouping: assign each active task a wave number */
export function computeWaves(db: BrainDB, prefix: string): WaveAssignment[] {
  const tasks = getProjectTasks(db, prefix);
  const graph = buildDependencyGraph(db, prefix);

  // Exclude done, cancelled, and pruned tasks; pending-merge is in-flight and stays active
  const activeTasks = tasks.filter(
    (t) => t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'pruned'
  );
  const activeIds = new Set(activeTasks.map((t) => t.displayId));
  const statusByDisplay = new Map<string, TaskStatus>();
  for (const t of tasks) {
    statusByDisplay.set(t.displayId, t.status);
  }

  // Build in-degree map considering only active tasks with active dependencies
  const waveMap = new Map<string, number>();
  const remaining = new Set(activeIds);

  // Kahn's algorithm for topological waves
  let currentWave = 0;
  while (remaining.size > 0) {
    const waveMembers: string[] = [];

    for (const id of remaining) {
      const deps = (graph.get(id) ?? []).filter((dep) => {
        // A dependency is satisfied if it's done or not in active set
        const depStatus = statusByDisplay.get(dep);
        return depStatus !== 'done' && remaining.has(dep);
      });
      if (deps.length === 0) {
        waveMembers.push(id);
      }
    }

    if (waveMembers.length === 0) {
      // Remaining tasks form a cycle or have unresolvable deps — assign to current wave
      for (const id of remaining) {
        waveMap.set(id, currentWave);
      }
      break;
    }

    for (const id of waveMembers) {
      waveMap.set(id, currentWave);
      remaining.delete(id);
    }
    currentWave++;
  }

  // Group by wave
  const waveGroups = new Map<number, string[]>();
  for (const [id, wave] of waveMap) {
    if (!waveGroups.has(wave)) {
      waveGroups.set(wave, []);
    }
    waveGroups.get(wave)!.push(id);
  }

  const result: WaveAssignment[] = [];
  const sortedWaves = [...waveGroups.keys()].sort((a, b) => a - b);
  for (const wave of sortedWaves) {
    result.push({
      wave,
      taskIds: waveGroups.get(wave)!.sort(),
    });
  }

  return result;
}

/**
 * Impact analysis: what tasks become eligible if taskId is completed.
 * Returns display IDs of tasks that would become eligible.
 */
export function computeImpact(db: BrainDB, prefix: string, taskDisplayId: string): string[] {
  const tasks = getProjectTasks(db, prefix);
  const graph = buildDependencyGraph(db, prefix);
  const reverse = buildReverseGraph(graph);

  const statusByDisplay = new Map<string, TaskStatus>();
  for (const t of tasks) {
    statusByDisplay.set(t.displayId, t.status);
  }

  // Simulate completing taskDisplayId
  const simulatedDone = new Set<string>();
  for (const t of tasks) {
    if (t.status === 'done') simulatedDone.add(t.displayId);
  }
  simulatedDone.add(taskDisplayId);

  // Check dependents: tasks that depend on taskDisplayId
  const dependents = reverse.get(taskDisplayId) ?? [];
  const newlyEligible: string[] = [];

  for (const dep of dependents) {
    const depStatus = statusByDisplay.get(dep);
    if (depStatus !== 'pending') continue;

    const deps = graph.get(dep) ?? [];
    const allDone = deps.every((d) => simulatedDone.has(d));
    if (allDone) {
      newlyEligible.push(dep);
    }
  }

  return newlyEligible.sort();
}

/**
 * Impact analysis by noteId: what tasks become newly eligible when
 * the given task (identified by its DB note ID) is completed.
 * Returns display IDs of tasks that would become eligible.
 */
export function computeNewlyEligible(db: BrainDB, completedTaskNoteId: string): string[] {
  const completedNote = db.getNoteById(completedTaskNoteId);
  if (!completedNote?.metadata) return [];

  const completedMeta = JSON.parse(completedNote.metadata) as Record<string, unknown>;
  const prefix = completedMeta.project as string;
  const displayId = completedMeta.display_id as string;
  if (!prefix || !displayId) return [];

  return computeImpact(db, prefix, displayId);
}

/**
 * Infer intra-workstream dependencies from task categories.
 * Rules:
 *   - testing -> implementation (same workstream)
 *   - docs -> implementation (same workstream)
 *   - review -> implementation + testing (same workstream)
 *   - research is never auto-depended-upon
 *
 * Only creates edges within the same workstream. Skips if edge already exists.
 * Returns count of new edges created.
 */
export function inferDependencies(db: BrainDB, prefix: string): number {
  const CATEGORY_DEPS: Record<string, string[]> = {
    testing: ['implementation'],
    documentation: ['implementation'],
    review: ['implementation', 'testing'],
  };

  const result = listTasks(db, prefix);
  if (!result.ok) return 0;

  const tasks = result.data;

  const byWorkstream = new Map<number, typeof tasks>();
  for (const t of tasks) {
    const ws = t.workstream;
    if (!byWorkstream.has(ws)) byWorkstream.set(ws, []);
    byWorkstream.get(ws)!.push(t);
  }

  const existingEdges = new Set<string>();
  const graph = buildDependencyGraph(db, prefix);
  for (const [from, tos] of graph) {
    for (const to of tos) {
      existingEdges.add(`${from}->${to}`);
    }
  }

  // Build noteId lookup: display_id -> noteId
  const displayToNoteId = new Map<string, string>();
  for (const t of tasks) {
    const notes = getPmNotes(db, 'task', { display_id: t.display_id });
    if (notes.length > 0) displayToNoteId.set(t.display_id, notes[0].id);
  }

  // Collect new edges per source task, preserving existing relations
  const newEdgesBySource = new Map<string, Relation[]>();
  let created = 0;

  for (const [, wsTasks] of byWorkstream) {
    for (const task of wsTasks) {
      const depCategories = CATEGORY_DEPS[task.category];
      if (!depCategories) continue;

      const sourceNoteId = displayToNoteId.get(task.display_id);
      if (!sourceNoteId) continue;

      for (const depCat of depCategories) {
        const targets = wsTasks.filter(
          (t) => t.category === depCat && t.display_id !== task.display_id
        );

        for (const target of targets) {
          const edgeKey = `${task.display_id}->${target.display_id}`;
          if (existingEdges.has(edgeKey)) continue;

          const targetNoteId = displayToNoteId.get(target.display_id);
          if (!targetNoteId) continue;

          if (!newEdgesBySource.has(task.display_id)) {
            newEdgesBySource.set(task.display_id, []);
          }
          newEdgesBySource.get(task.display_id)!.push({
            sourceId: sourceNoteId,
            targetId: targetNoteId,
            type: 'depends_on',
          });
          existingEdges.add(edgeKey);
          created++;
        }
      }
    }
  }

  // Upsert once per source task, merging existing + new relations
  for (const [displayId, newRelations] of newEdgesBySource) {
    const sourceNoteId = displayToNoteId.get(displayId)!;
    const existing = db.getRelationsFrom(sourceNoteId);
    const merged = [...existing, ...newRelations];
    db.upsertRelations(sourceNoteId, merged);
  }

  return created;
}
