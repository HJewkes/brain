import type { WorkflowDefinition, WorkflowStep, WorkflowEdge } from '../types.js';

export type WorkflowErrorCode = 'CYCLE_DETECTED' | 'INVALID_DEFINITION' | 'EMPTY_WORKFLOW';

export interface WorkflowError {
  error: true;
  code: WorkflowErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: WorkflowError };

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

function fail(
  code: WorkflowErrorCode,
  message: string,
  details?: Record<string, unknown>
): Result<never> {
  const err: WorkflowError = { error: true, code, message };
  if (details !== undefined) {
    err.details = details;
  }
  return { ok: false, error: err };
}

export function getSuccessors(stepId: string, edges: WorkflowEdge[]): string[] {
  return edges.filter((e) => e.from === stepId).map((e) => e.to);
}

export function getPredecessors(stepId: string, edges: WorkflowEdge[]): string[] {
  return edges.filter((e) => e.to === stepId).map((e) => e.from);
}

export function validateDag(definition: WorkflowDefinition): Result<void> {
  const { steps, edges } = definition;

  if (steps.length === 0) {
    return fail('INVALID_DEFINITION', 'Workflow must have at least one step');
  }

  const stepIds = new Set(steps.map((s) => s.id));

  for (const edge of edges) {
    if (!stepIds.has(edge.from)) {
      return fail(
        'INVALID_DEFINITION',
        `Edge references non-existent source step: ${edge.from}`
      );
    }
    if (!stepIds.has(edge.to)) {
      return fail(
        'INVALID_DEFINITION',
        `Edge references non-existent target step: ${edge.to}`
      );
    }
  }

  // Cycle detection before structural checks — cycles cause
  // all nodes to have both incoming and outgoing edges
  const cycleResult = detectCycle(steps, edges);
  if (cycleResult) {
    return fail('CYCLE_DETECTED', `Cycle detected: ${cycleResult.join(' -> ')}`, {
      cycle: cycleResult,
    });
  }

  const hasIncoming = new Set(edges.map((e) => e.to));
  const entryNodes = steps.filter((s) => !hasIncoming.has(s.id));
  if (entryNodes.length === 0) {
    return fail('INVALID_DEFINITION', 'DAG must have at least one entry node');
  }

  const hasOutgoing = new Set(edges.map((e) => e.from));
  const terminalNodes = steps.filter((s) => !hasOutgoing.has(s.id));
  if (terminalNodes.length === 0) {
    return fail('INVALID_DEFINITION', 'DAG must have at least one terminal node');
  }

  return ok(undefined);
}

function detectCycle(
  steps: WorkflowStep[],
  edges: WorkflowEdge[]
): string[] | null {
  const adj = new Map<string, string[]>();
  for (const s of steps) {
    adj.set(s.id, []);
  }
  // Only unconditional edges participate in cycle detection;
  // conditional edges represent optional feedback loops
  for (const e of edges) {
    if (!e.condition) {
      adj.get(e.from)?.push(e.to);
    }
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  for (const s of steps) {
    const cycle = dfs(s.id, adj, visited, inStack, path);
    if (cycle) return cycle;
  }
  return null;
}

function dfs(
  node: string,
  adj: Map<string, string[]>,
  visited: Set<string>,
  inStack: Set<string>,
  path: string[]
): string[] | null {
  if (inStack.has(node)) {
    const cycleStart = path.indexOf(node);
    return path.slice(cycleStart).concat(node);
  }
  if (visited.has(node)) return null;

  visited.add(node);
  inStack.add(node);
  path.push(node);

  for (const neighbor of adj.get(node) ?? []) {
    const cycle = dfs(neighbor, adj, visited, inStack, path);
    if (cycle) return cycle;
  }

  path.pop();
  inStack.delete(node);
  return null;
}

export function topologicalSort(
  steps: WorkflowStep[],
  edges: WorkflowEdge[]
): Result<string[]> {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const s of steps) {
    inDegree.set(s.id, 0);
    adj.set(s.id, []);
  }

  // Only unconditional edges define topological order;
  // conditional edges represent optional feedback loops
  for (const e of edges) {
    if (!e.condition) {
      adj.get(e.from)?.push(e.to);
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const neighbor of adj.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== steps.length) {
    return fail('CYCLE_DETECTED', 'Graph contains a cycle');
  }

  return ok(sorted);
}

/**
 * Find steps not reachable from completed steps via the DAG.
 *
 * A step is reachable if:
 * - It is a completed step, OR
 * - At least one of its predecessors is a completed step, OR
 * - It has multiple predecessors and at least one is reachable
 *
 * This models pruning cascades: if a non-completed step is the sole
 * path to a downstream step, the downstream step becomes unreachable.
 * If multiple independent paths exist, the step remains reachable.
 */
export function getUnreachableSteps(
  completedSteps: string[],
  edges: WorkflowEdge[],
  allSteps: string[]
): string[] {
  const completed = new Set(completedSteps);
  const reachable = new Set(completedSteps);

  // Process in topological order to ensure predecessors are resolved first
  const stepObjs = allSteps.map((id) => ({ id, name: id }));
  const sortResult = topologicalSort(stepObjs, edges);
  const order = sortResult.ok ? sortResult.data : allSteps;

  for (const stepId of order) {
    if (reachable.has(stepId)) continue;

    const preds = getPredecessors(stepId, edges);
    if (preds.length === 0) continue;

    const hasCompletedPred = preds.some((p) => completed.has(p));
    if (hasCompletedPred) {
      reachable.add(stepId);
      continue;
    }

    // Multiple predecessors: reachable if at least one pred is reachable
    // (models alternate paths surviving single-point pruning)
    const reachablePreds = preds.filter((p) => reachable.has(p));
    if (reachablePreds.length >= 2) {
      reachable.add(stepId);
    }
  }

  return allSteps.filter((s) => !reachable.has(s));
}
