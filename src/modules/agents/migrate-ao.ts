import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { getAgent } from './data.js';
import type { AgentStatus } from './types.js';

interface RawDb {
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number };
  };
}

function toRaw(db: unknown): RawDb {
  const asInner = (db as { db?: RawDb }).db;
  return asInner ?? (db as RawDb);
}

interface AoAgentYaml {
  id?: string;
  status?: string;
  branch?: string;
  worktree?: string;
  task?: string;
  files?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface MigrateResult {
  imported: number;
  skipped: number;
  errors: string[];
}

const STATUS_MAP: Record<string, AgentStatus> = {
  active: 'active',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'abandoned',
};

function mapStatus(aoStatus: string | undefined): AgentStatus {
  if (!aoStatus) return 'pending';
  return STATUS_MAP[aoStatus] ?? 'pending';
}

function terminalStatuses(): Set<AgentStatus> {
  return new Set(['completed', 'failed', 'abandoned']);
}

function insertAgent(db: unknown, agent: AoAgentYaml): void {
  const raw = toRaw(db);
  const status = mapStatus(agent.status);
  const now = agent.createdAt ?? new Date().toISOString();
  const ownership = agent.files ? JSON.stringify(agent.files) : null;
  const completedAt = terminalStatuses().has(status) ? (agent.updatedAt ?? now) : null;
  const startedAt = status !== 'pending' ? now : null;

  raw
    .prepare(
      `INSERT INTO agents
         (id, name, parent, status, brain_task, claim_token, branch,
          worktree_path, ownership, dod_spec, pid, created_at,
          started_at, completed_at, summary, exit_reason)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      agent.id,
      agent.id,
      'ao-migrate',
      status,
      agent.task ?? null,
      null,
      agent.branch ?? null,
      agent.worktree ?? null,
      ownership,
      null,
      null,
      now,
      startedAt,
      completedAt,
      null,
      null
    );
}

export async function readAoYamlFiles(cwd: string): Promise<AoAgentYaml[]> {
  const dir = join(cwd, '.claude', 'ao', 'agents');
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const yamlFiles = entries.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  const agents: AoAgentYaml[] = [];

  for (const file of yamlFiles) {
    try {
      const content = await readFile(join(dir, file), 'utf-8');
      const parsed = parseYaml(content) as AoAgentYaml;
      if (parsed && typeof parsed === 'object' && parsed.id) {
        agents.push(parsed);
      }
    } catch {
      // Skip malformed files
    }
  }

  return agents;
}

export async function migrateAoAgents(
  db: unknown,
  cwd: string,
  dryRun: boolean
): Promise<MigrateResult> {
  const agents = await readAoYamlFiles(cwd);
  const result: MigrateResult = { imported: 0, skipped: 0, errors: [] };

  for (const agent of agents) {
    if (!agent.id) {
      result.errors.push('YAML entry missing id field');
      continue;
    }

    const existing = getAgent(db, agent.id);
    if (existing) {
      result.skipped++;
      continue;
    }

    if (dryRun) {
      result.imported++;
      continue;
    }

    try {
      insertAgent(db, agent);
      result.imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to import ${agent.id}: ${msg}`);
    }
  }

  return result;
}
