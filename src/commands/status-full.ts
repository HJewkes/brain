import type { BrainDB } from '../services/brain-db.js';
import { listProjects } from '../modules/pm/data/project-ops.js';
import { listTasks } from '../modules/pm/data/task-ops.js';
import { getActiveProject } from '../modules/pm/data/queries.js';
import type { IndexSummary } from './status.js';

export interface SectionUnavailable {
  initialised: false;
  reason: string;
}

type Section<T> = T | SectionUnavailable;

export interface FullStatus {
  index: Section<IndexSummary>;
  memory: Section<{ activeMemories: number }>;
  inbox: Section<{ total: number; pending: number; failed: number }>;
  pm: Section<{ projects: number; activeProject: string | null; tasks: Record<string, number> }>;
}

const SECTION_TITLES: Record<keyof FullStatus, string> = {
  index: 'Index',
  memory: 'Memory',
  inbox: 'Inbox',
  pm: 'PM',
};

function notInitialised(reason: string): SectionUnavailable {
  return { initialised: false, reason };
}

function isUnavailable<T>(section: Section<T>): section is SectionUnavailable {
  return (section as SectionUnavailable).initialised === false;
}

function safeSection<T>(collect: () => Section<T>): Section<T> {
  try {
    return collect();
  } catch (err) {
    return notInitialised(`unavailable (${err instanceof Error ? err.message : String(err)})`);
  }
}

function collectInbox(db: BrainDB): FullStatus['inbox'] {
  const items = db.getInboxItems();
  const count = (status: string) => items.filter((i) => i.status === status).length;
  return { total: items.length, pending: count('pending'), failed: count('failed') };
}

function collectPm(db: BrainDB): FullStatus['pm'] {
  const projects = listProjects(db);
  if (!projects.ok) return notInitialised(`unavailable (${projects.error.message})`);
  if (projects.data.length === 0) return notInitialised('not initialised (run brain pm init)');

  const tasks: Record<string, number> = {};
  for (const project of projects.data) {
    const result = listTasks(db, project.prefix, undefined, 'short');
    if (!result.ok) continue;
    for (const task of result.data) tasks[task.status] = (tasks[task.status] ?? 0) + 1;
  }
  return { projects: projects.data.length, activeProject: getActiveProject(db) || null, tasks };
}

export function collectFullStatus(db: BrainDB, index: () => IndexSummary): FullStatus {
  return {
    index: safeSection(() => {
      const summary = index();
      return summary.lastIndexed ? summary : notInitialised('not initialised (run brain index)');
    }),
    memory: safeSection(() => ({ activeMemories: db.getMemoryCount() })),
    inbox: safeSection(() => collectInbox(db)),
    pm: safeSection(() => collectPm(db)),
  };
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

function renderSection(key: keyof FullStatus, status: FullStatus): string[] {
  if (key === 'index') {
    const s = status.index as IndexSummary;
    return [
      `Notes: ${s.totalNotes}`,
      `Chunks: ${s.totalChunks}`,
      `By type: ${formatCounts(s.byType)}`,
      `Embedding: ${s.embeddingModel ?? 'none'}`,
      `Last indexed: ${s.lastIndexed}`,
      `Stale notes: ${s.staleNotes}`,
    ];
  }
  if (key === 'memory') {
    return [`Active memories: ${(status.memory as { activeMemories: number }).activeMemories}`];
  }
  if (key === 'inbox') {
    const s = status.inbox as { total: number; pending: number; failed: number };
    return [`Pending: ${s.pending}`, `Failed: ${s.failed}`, `Total: ${s.total}`];
  }
  const s = status.pm as Exclude<FullStatus['pm'], SectionUnavailable>;
  const taskTotal = Object.values(s.tasks).reduce((a, b) => a + b, 0);
  return [
    `Projects: ${s.projects}`,
    `Active project: ${s.activeProject ?? 'none'}`,
    `Tasks: ${taskTotal}${taskTotal > 0 ? ` (${formatCounts(s.tasks)})` : ''}`,
  ];
}

export function renderFullStatus(status: FullStatus): string {
  const lines: string[] = [];
  for (const key of Object.keys(SECTION_TITLES) as (keyof FullStatus)[]) {
    const section = status[key];
    if (isUnavailable(section)) {
      lines.push(`${SECTION_TITLES[key]}: ${section.reason}`);
      continue;
    }
    lines.push(`== ${SECTION_TITLES[key]} ==`, ...renderSection(key, status));
  }
  return lines.join('\n') + '\n';
}
