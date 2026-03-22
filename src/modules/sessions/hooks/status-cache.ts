import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { BrainDB } from '../../../services/brain-db.js';
import { getActiveProject } from '../../pm/data/queries.js';

const CACHE_DIR = join(homedir(), '.claude', 'status-cache');
const CACHE_PATH = join(CACHE_DIR, 'brain-state.json');

interface RawDb {
  prepare(sql: string): {
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
  };
}

interface AgentRow {
  id: string;
  name: string;
  status: string;
  brain_task: string | null;
  branch: string | null;
}

export interface StatusCache {
  session_id: string;
  agent_id: string | null;
  project: string | null;
  agents: {
    id: string;
    name: string;
    status: string;
    task: string | null;
    branch: string | null;
  }[];
  agent_count: number;
  active_agents: number;
  tasks_ready: number;
  tasks_in_progress: number;
  tasks_done: number;
  tasks_total: number;
  friction_count: number;
  event_count: number;
  prs_created: string[];
  updated_at: string;
}

export function writeStatusCache(db: BrainDB, sessionId: string): void {
  try {
    const rawDb = (db as unknown as { db: RawDb }).db;

    const agents = rawDb
      .prepare(
        `SELECT id, name, status, brain_task, branch
         FROM agents WHERE status IN ('pending', 'active')
         ORDER BY created_at DESC`
      )
      .all() as AgentRow[];

    const activeCount = agents.filter((a) => a.status === 'active').length;

    const frictionRow = rawDb
      .prepare(
        `SELECT COUNT(*) as n FROM session_events
         WHERE session_id = ? AND event_type LIKE 'friction:%'`
      )
      .get(sessionId) as { n: number };

    const eventRow = rawDb
      .prepare('SELECT COUNT(*) as n FROM session_events WHERE session_id = ?')
      .get(sessionId) as { n: number };

    const prEvents = rawDb
      .prepare(
        `SELECT data FROM session_events
         WHERE session_id = ? AND event_type = 'pr:created'
         ORDER BY timestamp DESC`
      )
      .all(sessionId) as { data: string }[];

    const prs = prEvents.map((e) => {
      const d = JSON.parse(e.data) as { pr_url: string };
      return d.pr_url;
    });

    // PM task counts
    let tasksReady = 0;
    let tasksInProgress = 0;
    let tasksDone = 0;
    let tasksTotal = 0;
    const project = getActiveProject(db);

    if (project) {
      const counts = rawDb
        .prepare(
          `SELECT
             json_extract(metadata, '$.status') as status,
             COUNT(*) as n
           FROM notes
           WHERE module = 'pm'
             AND json_extract(metadata, '$.display_id') LIKE ?
             AND json_extract(metadata, '$.status') IS NOT NULL
           GROUP BY json_extract(metadata, '$.status')`
        )
        .all(`${project}-%`) as { status: string; n: number }[];

      for (const row of counts) {
        tasksTotal += row.n;
        if (row.status === 'ready' || row.status === 'open') tasksReady += row.n;
        else if (row.status === 'in-progress' || row.status === 'claimed') tasksInProgress += row.n;
        else if (row.status === 'done' || row.status === 'verified') tasksDone += row.n;
      }
    }

    const cache: StatusCache = {
      session_id: sessionId,
      agent_id: process.env.BRAIN_AGENT_ID ?? null,
      project,
      agents: agents.map((a) => ({
        id: a.id.slice(0, 8),
        name: a.name,
        status: a.status,
        task: a.brain_task,
        branch: a.branch,
      })),
      agent_count: agents.length,
      active_agents: activeCount,
      tasks_ready: tasksReady,
      tasks_in_progress: tasksInProgress,
      tasks_done: tasksDone,
      tasks_total: tasksTotal,
      friction_count: frictionRow.n,
      event_count: eventRow.n,
      prs_created: prs,
      updated_at: new Date().toISOString(),
    };

    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(cache));
  } catch {
    // Status cache is best-effort — never block hooks
  }
}
