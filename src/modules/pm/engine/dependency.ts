import type { BrainDB } from '../../../services/brain-db.js';
import type { Result } from '../errors.js';
import type { TaskStatus } from '../types.js';
import { ok, fail } from '../errors.js';
import { getPmNotes } from '../data/queries.js';

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
export function buildDependencyGraph(
  db: BrainDB,
  prefix: string,
): Map<string, string[]> {
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
    const allDepsDone = deps.every((dep) => statusByDisplay.get(dep) === 'done');
    if (allDepsDone) {
      eligible.push(t.displayId);
    }
  }

  return eligible.sort();
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
  toDisplayId: string,
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

  // Exclude done and cancelled tasks
  const activeTasks = tasks.filter(
    (t) => t.status !== 'done' && t.status !== 'cancelled',
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
export function computeImpact(
  db: BrainDB,
  prefix: string,
  taskDisplayId: string,
): string[] {
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
