import type { BrainDB } from '../../services/brain-db.js';
import { listTasks } from '../pm/data/task-ops.js';
import { getActiveProject } from '../pm/data/queries.js';
import { countActiveAgents, listAgents } from './data.js';
import { detectStalledTasks } from './stall-detector.js';
import type { AgentRecord } from './types.js';

export interface DashboardData {
  project: string;
  tasks: {
    total: number;
    done: number;
    inProgress: number;
    pending: number;
    claimed: number;
  };
  agents: {
    active: number;
    activeList: Array<{
      name: string;
      taskId: string | null;
      duration: string;
    }>;
  };
  stalled: Array<{ taskId: string; idleMinutes: number }>;
  throughput: {
    completedPerHour: number;
    estimatedRemainingMinutes: number | null;
  };
}

function formatDuration(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function computeThroughput(
  doneTasks: number,
  allTasks: Array<{ status: string; modified?: string }>
): { completedPerHour: number; estimatedRemainingMinutes: number | null } {
  const doneWithTime = allTasks.filter((t) => t.status === 'done' && t.modified);

  if (doneWithTime.length < 2) {
    return { completedPerHour: 0, estimatedRemainingMinutes: null };
  }

  const timestamps = doneWithTime.map((t) => new Date(t.modified!).getTime()).sort((a, b) => a - b);

  const spanMs = timestamps[timestamps.length - 1] - timestamps[0];
  const spanHours = spanMs / (1000 * 60 * 60);

  if (spanHours < 0.01) {
    return { completedPerHour: 0, estimatedRemainingMinutes: null };
  }

  const rate = doneTasks / spanHours;
  const remaining = allTasks.length - doneTasks;
  const estMinutes = rate > 0 ? Math.round((remaining / rate) * 60) : null;

  return { completedPerHour: Math.round(rate * 10) / 10, estimatedRemainingMinutes: estMinutes };
}

export function buildDashboard(
  db: BrainDB,
  projectDir: string,
  project?: string
): DashboardData | null {
  const resolvedProject = project ?? getActiveProject(db);
  if (!resolvedProject) return null;

  const tasksResult = listTasks(db, resolvedProject);
  const allTasks = tasksResult.ok ? tasksResult.data : [];

  const done = allTasks.filter((t) => t.status === 'done');
  const inProgress = allTasks.filter((t) => t.status === 'in-progress');
  const pending = allTasks.filter((t) => t.status === 'pending');
  const claimed = allTasks.filter((t) => t.status === 'claimed');

  const activeCount = countActiveAgents(db);
  const activeAgents = listAgents(db, { status: 'active' });

  const agentList = activeAgents.map((a: AgentRecord) => ({
    name: a.name,
    taskId: a.brain_task,
    duration: a.started_at ? formatDuration(a.started_at) : 'unknown',
  }));

  const stalled = detectStalledTasks(db, projectDir).map((s) => ({
    taskId: s.displayId,
    idleMinutes: Math.round(s.lastCommitAge),
  }));

  const throughput = computeThroughput(
    done.length,
    allTasks.map((t) => ({ status: t.status, modified: t.modified ?? undefined }))
  );

  return {
    project: resolvedProject,
    tasks: {
      total: allTasks.length,
      done: done.length,
      inProgress: inProgress.length,
      pending: pending.length,
      claimed: claimed.length,
    },
    agents: { active: activeCount, activeList: agentList },
    stalled,
    throughput,
  };
}

export function formatDashboard(data: DashboardData): string {
  const pct = data.tasks.total > 0 ? Math.round((data.tasks.done / data.tasks.total) * 100) : 0;

  const bar = renderProgressBar(pct, 30);

  const lines = [
    `=== Burndown: ${data.project} ===`,
    '',
    `${bar} ${pct}%`,
    '',
    `Tasks: ${data.tasks.done}/${data.tasks.total} done, ` +
      `${data.tasks.inProgress} in-progress, ` +
      `${data.tasks.pending} pending, ` +
      `${data.tasks.claimed} claimed`,
    '',
    `Agents: ${data.agents.active} active`,
  ];

  for (const a of data.agents.activeList) {
    lines.push(`  ${a.name} — ${a.taskId ?? 'no task'} (${a.duration})`);
  }

  if (data.stalled.length > 0) {
    lines.push('');
    lines.push('Stalled:');
    for (const s of data.stalled) {
      lines.push(`  ${s.taskId}: ${s.idleMinutes}m idle`);
    }
  }

  lines.push('');
  if (data.throughput.completedPerHour > 0) {
    lines.push(`Throughput: ${data.throughput.completedPerHour} tasks/hr`);
    if (data.throughput.estimatedRemainingMinutes !== null) {
      lines.push(`Est. remaining: ${data.throughput.estimatedRemainingMinutes}m`);
    }
  } else {
    lines.push('Throughput: insufficient data');
  }

  return lines.join('\n');
}

function renderProgressBar(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return `[${'#'.repeat(filled)}${'-'.repeat(empty)}]`;
}
