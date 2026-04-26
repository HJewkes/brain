import type { BrainServiceClass } from '../services/brain-service.js';
import type { TaskMetadata, TaskStatus } from '../modules/pm/types.js';
import type { AgentRecord } from '../modules/agents/types.js';
import type { DeliveryRecord } from '../modules/agents/delivery.js';
import { resolveProject } from '../modules/pm/data/queries.js';
import { listTasks } from '../modules/pm/data/task-ops.js';
import { listAgents, getWorktreeAllocations } from '../modules/agents/data.js';
import { computeEligible } from '../modules/pm/engine/dependency.js';

export type TriageClass = 'ready' | 'in_flight' | 'stuck' | 'blocked' | 'capacity_limited';
export type TriageStuckKind =
  | 'pr-conflict'
  | 'review-pending'
  | 'merge-blocked'
  | 'ci-flake'
  | 'orphan'
  | 'stale-claim';

export interface TriageTaskView {
  displayId: string;
  workstream: string;
  title: string;
  status: TaskStatus;
  priority: string;
  classification: TriageClass;
  stuckKind?: TriageStuckKind;
  reason?: string;
  incompleteDeps?: string[];
  agent?: {
    id: string;
    status: string;
    pid: number | null;
    alive: boolean;
    branch: string | null;
  };
  delivery?: {
    status: string;
    prNumber: number | null;
    prUrl: string | null;
    reviewTier: string | null;
    fixAttempts: number;
    stallReason: string | null;
  };
  worktree?: { path: string; branch: string };
}

export interface TriageWorkstreamView {
  workstream: string;
  title: string;
  counts: Record<TriageClass, number>;
  tasks: TriageTaskView[];
}

export interface TriageResult {
  generatedAt: string;
  scope: { prefix: string; workstream?: string };
  totals: Record<TriageClass, number>;
  wip: { activeAgents: number; limit: number | null; atCapacity: boolean };
  workstreams: TriageWorkstreamView[];
}

export interface TriageOptions {
  prefix?: string;
  workstream?: string;
  wipLimit?: number | null;
}

interface TriageContext {
  agentsByTask: Map<string, AgentRecord>;
  deliveryByTask: Map<string, DeliveryRecord>;
  worktreeByTask: Map<string, { path: string; branch: string }>;
  eligibleSet: Set<string>;
  taskStatus: Map<string, TaskStatus>;
  activeAgentCount: number;
  wipLimit: number | null;
}

function isPidAlive(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function loadDeliveryByTask(svc: BrainServiceClass): Map<string, DeliveryRecord> {
  const out = new Map<string, DeliveryRecord>();
  try {
    const rows = svc.db.rawDb
      .prepare('SELECT * FROM delivery_states WHERE task_id IS NOT NULL ORDER BY created_at DESC')
      .all() as DeliveryRecord[];
    for (const row of rows) {
      if (row.task_id && !out.has(row.task_id)) out.set(row.task_id, row);
    }
  } catch {
    /* delivery_states table may not exist in older schemas */
  }
  return out;
}

function loadAgentsByTask(svc: BrainServiceClass): {
  byTask: Map<string, AgentRecord>;
  active: number;
} {
  const byTask = new Map<string, AgentRecord>();
  let active = 0;
  const all = listAgents(svc.db, { limit: 500 });
  for (const a of all) {
    if (a.status === 'active') active++;
    if (!a.brain_task) continue;
    const existing = byTask.get(a.brain_task);
    if (!existing || a.created_at > existing.created_at) byTask.set(a.brain_task, a);
  }
  return { byTask, active };
}

function loadWorktreeByTask(svc: BrainServiceClass): Map<string, { path: string; branch: string }> {
  const out = new Map<string, { path: string; branch: string }>();
  for (const wt of getWorktreeAllocations(svc.db)) {
    out.set(wt.task_id, { path: wt.worktree_path, branch: wt.branch });
  }
  return out;
}

function classifyStuck(delivery: DeliveryRecord): {
  kind: TriageStuckKind;
  reason: string;
} | null {
  switch (delivery.status) {
    case 'conflicted':
      return { kind: 'pr-conflict', reason: 'PR has merge conflicts' };
    case 'review-paused':
      return { kind: 'review-pending', reason: 'Awaiting human review signal' };
    case 'pr-failed':
      return { kind: 'merge-blocked', reason: 'PR creation failed' };
    case 'push-failed':
      return { kind: 'merge-blocked', reason: 'Branch push failed' };
    case 'stalled':
      return {
        kind: 'merge-blocked',
        reason: delivery.stall_reason ?? 'Delivery stalled',
      };
    default:
      return null;
  }
}

function classifyPending(
  task: TaskMetadata,
  ctx: TriageContext
): Pick<TriageTaskView, 'classification' | 'incompleteDeps'> {
  const deps = task.depends_on ?? [];
  const incomplete = deps.filter((d) => {
    const s = ctx.taskStatus.get(d);
    return s !== 'done' && s !== 'pruned';
  });
  if (incomplete.length > 0) {
    return { classification: 'blocked', incompleteDeps: incomplete };
  }
  if (ctx.wipLimit !== null && ctx.activeAgentCount >= ctx.wipLimit) {
    return { classification: 'capacity_limited' };
  }
  return { classification: 'ready' };
}

function classifyInFlight(
  task: TaskMetadata,
  ctx: TriageContext
): Pick<TriageTaskView, 'classification' | 'stuckKind' | 'reason'> {
  const delivery = ctx.deliveryByTask.get(task.display_id);
  if (delivery) {
    const stuck = classifyStuck(delivery);
    if (stuck) return { classification: 'stuck', stuckKind: stuck.kind, reason: stuck.reason };
  }
  const agent = ctx.agentsByTask.get(task.display_id);
  if (agent && agent.status === 'active' && isPidAlive(agent.pid)) {
    return { classification: 'in_flight' };
  }
  if (agent && (agent.status === 'failed' || agent.status === 'abandoned')) {
    return {
      classification: 'stuck',
      stuckKind: 'orphan',
      reason: agent.exit_reason ?? `Agent ${agent.status}`,
    };
  }
  if (delivery && (delivery.status === 'pr-open' || delivery.status === 'pushed')) {
    return { classification: 'in_flight' };
  }
  return { classification: 'stuck', stuckKind: 'orphan', reason: 'No live agent or open PR' };
}

function classifyTask(task: TaskMetadata, ctx: TriageContext): TriageTaskView | null {
  if (task.status === 'done' || task.status === 'cancelled' || task.status === 'pruned') {
    return null;
  }

  const base: TriageTaskView = {
    displayId: task.display_id,
    workstream: `${task.project}-${String(task.workstream).padStart(2, '0')}`,
    title: task.title ?? task.display_id,
    status: task.status,
    priority: task.priority,
    classification: 'ready',
  };

  if (task.status === 'blocked') {
    const deps = task.depends_on ?? [];
    const incomplete = deps.filter((d) => ctx.taskStatus.get(d) !== 'done');
    base.classification = 'blocked';
    base.incompleteDeps = incomplete.length > 0 ? incomplete : undefined;
    base.reason = (task as TaskMetadata & { block_reason?: string }).block_reason;
  } else if (task.status === 'pending') {
    Object.assign(base, classifyPending(task, ctx));
  } else if (
    task.status === 'claimed' ||
    task.status === 'in-progress' ||
    task.status === 'pending-merge'
  ) {
    Object.assign(base, classifyInFlight(task, ctx));
  }

  attachJoinedRecords(base, task.display_id, ctx);
  return base;
}

function attachJoinedRecords(view: TriageTaskView, taskId: string, ctx: TriageContext): void {
  const agent = ctx.agentsByTask.get(taskId);
  if (agent) {
    view.agent = {
      id: agent.id,
      status: agent.status,
      pid: agent.pid,
      alive: isPidAlive(agent.pid),
      branch: agent.branch,
    };
  }
  const delivery = ctx.deliveryByTask.get(taskId);
  if (delivery) {
    view.delivery = {
      status: delivery.status,
      prNumber: delivery.pr_number,
      prUrl: delivery.pr_url,
      reviewTier: delivery.review_tier,
      fixAttempts: delivery.fix_attempts,
      stallReason: delivery.stall_reason,
    };
  }
  const worktree = ctx.worktreeByTask.get(taskId);
  if (worktree) view.worktree = worktree;
}

function emptyCounts(): Record<TriageClass, number> {
  return { ready: 0, in_flight: 0, stuck: 0, blocked: 0, capacity_limited: 0 };
}

function groupByWorkstream(
  views: TriageTaskView[],
  workstreamTitles: Map<string, string>
): TriageWorkstreamView[] {
  const groups = new Map<string, TriageTaskView[]>();
  for (const v of views) {
    if (!groups.has(v.workstream)) groups.set(v.workstream, []);
    groups.get(v.workstream)!.push(v);
  }
  return [...groups.entries()]
    .map(([workstream, tasks]) => {
      const counts = emptyCounts();
      for (const t of tasks) counts[t.classification]++;
      tasks.sort((a, b) => a.displayId.localeCompare(b.displayId));
      return {
        workstream,
        title: workstreamTitles.get(workstream) ?? workstream,
        counts,
        tasks,
      };
    })
    .sort((a, b) => a.workstream.localeCompare(b.workstream));
}

function loadWorkstreamTitles(svc: BrainServiceClass, prefix: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const wsResult = svc.db.rawDb
      .prepare("SELECT metadata FROM notes WHERE module = 'pm' AND type = 'workstream'")
      .all() as Array<{ metadata: string | null }>;
    for (const row of wsResult) {
      if (!row.metadata) continue;
      const meta = JSON.parse(row.metadata) as Record<string, unknown>;
      if (meta.project !== prefix) continue;
      const id = meta.display_id as string | undefined;
      if (id) out.set(id, (meta.title as string) ?? id);
    }
  } catch {
    /* ignore */
  }
  return out;
}

export function triageDispatch(svc: BrainServiceClass, opts: TriageOptions = {}): TriageResult {
  const resolved = resolveProject(svc.db, opts.prefix?.toUpperCase());
  if (!resolved.ok) throw new Error(resolved.error.message);
  const prefix = resolved.data;

  const taskResult = listTasks(svc.db, prefix, undefined, 'short');
  const allTasks = taskResult.ok ? taskResult.data : [];

  const taskStatus = new Map<string, TaskStatus>();
  for (const t of allTasks) taskStatus.set(t.display_id, t.status);

  const eligible = computeEligible(svc.db, prefix);
  const { byTask: agentsByTask, active: activeAgentCount } = loadAgentsByTask(svc);

  const ctx: TriageContext = {
    agentsByTask,
    deliveryByTask: loadDeliveryByTask(svc),
    worktreeByTask: loadWorktreeByTask(svc),
    eligibleSet: new Set(eligible),
    taskStatus,
    activeAgentCount,
    wipLimit: opts.wipLimit ?? null,
  };

  const wsFilter = opts.workstream?.toUpperCase();
  const filtered = wsFilter
    ? allTasks.filter((t) => `${t.project}-${String(t.workstream).padStart(2, '0')}` === wsFilter)
    : allTasks;

  const views: TriageTaskView[] = [];
  for (const task of filtered) {
    const view = classifyTask(task as TaskMetadata, ctx);
    if (view) views.push(view);
  }

  const totals = emptyCounts();
  for (const v of views) totals[v.classification]++;

  const workstreamTitles = loadWorkstreamTitles(svc, prefix);

  return {
    generatedAt: new Date().toISOString(),
    scope: { prefix, workstream: wsFilter },
    totals,
    wip: {
      activeAgents: activeAgentCount,
      limit: ctx.wipLimit,
      atCapacity: ctx.wipLimit !== null && activeAgentCount >= ctx.wipLimit,
    },
    workstreams: groupByWorkstream(views, workstreamTitles),
  };
}
