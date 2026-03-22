import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as yamlStringify } from 'yaml';
import { agentsMigrationV1, agentsMigrationV2 } from '../../../src/modules/agents/schema.js';
import { migrateAoAgents, readAoYamlFiles } from '../../../src/modules/agents/migrate-ao.js';
import { getAgent } from '../../../src/modules/agents/data.js';
import type { AgentRecord } from '../../../src/modules/agents/types.js';

let db: ReturnType<typeof Database>;
let tmpDir: string;

async function writeAoYaml(
  dir: string,
  filename: string,
  data: Record<string, unknown>
): Promise<void> {
  const agentsDir = join(dir, '.claude', 'ao', 'agents');
  await mkdir(agentsDir, { recursive: true });
  await writeFile(join(agentsDir, filename), yamlStringify(data));
}

beforeEach(async () => {
  db = new Database(':memory:');
  agentsMigrationV1.up(db);
  agentsMigrationV2.up(db);
  tmpDir = await mkdtemp(join(tmpdir(), 'migrate-ao-'));
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('readAoYamlFiles', () => {
  it('reads and parses ao YAML files', async () => {
    await writeAoYaml(tmpDir, 'agent-abc.yaml', {
      id: 'agent-abc',
      status: 'active',
      branch: 'feat/something',
      task: 'VNM-01.05',
    });

    const agents = await readAoYamlFiles(tmpDir);

    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('agent-abc');
    expect(agents[0].status).toBe('active');
    expect(agents[0].branch).toBe('feat/something');
    expect(agents[0].task).toBe('VNM-01.05');
  });

  it('returns empty array when directory does not exist', async () => {
    const agents = await readAoYamlFiles('/nonexistent/path');
    expect(agents).toEqual([]);
  });

  it('skips malformed YAML files', async () => {
    const agentsDir = join(tmpDir, '.claude', 'ao', 'agents');
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, 'bad.yaml'), ':::not valid yaml[[[');
    await writeAoYaml(tmpDir, 'good.yaml', { id: 'good-agent', status: 'completed' });

    const agents = await readAoYamlFiles(tmpDir);

    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('good-agent');
  });

  it('skips YAML entries without an id field', async () => {
    await writeAoYaml(tmpDir, 'no-id.yaml', { status: 'active', branch: 'feat/x' });

    const agents = await readAoYamlFiles(tmpDir);
    expect(agents).toHaveLength(0);
  });
});

describe('migrateAoAgents', () => {
  it('imports agents with correct field mapping', async () => {
    await writeAoYaml(tmpDir, 'agent-1.yaml', {
      id: 'agent-1',
      status: 'active',
      branch: 'feat/thing',
      worktree: '/path/to/worktree',
      task: 'VNM-02.01',
      files: ['src/a.ts', 'src/b.ts'],
      createdAt: '2026-03-14T00:00:00Z',
      updatedAt: '2026-03-14T01:00:00Z',
    });

    const result = await migrateAoAgents(db, tmpDir, false);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);

    const agent = getAgent(db, 'agent-1') as AgentRecord;
    expect(agent).not.toBeNull();
    expect(agent.name).toBe('agent-1');
    expect(agent.parent).toBe('ao-migrate');
    expect(agent.status).toBe('active');
    expect(agent.branch).toBe('feat/thing');
    expect(agent.worktree_path).toBe('/path/to/worktree');
    expect(agent.brain_task).toBe('VNM-02.01');
    expect(JSON.parse(agent.ownership!)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(agent.created_at).toBe('2026-03-14T00:00:00Z');
    expect(agent.started_at).toBe('2026-03-14T00:00:00Z');
  });

  it('maps cancelled status to abandoned', async () => {
    await writeAoYaml(tmpDir, 'agent-c.yaml', {
      id: 'agent-c',
      status: 'cancelled',
      createdAt: '2026-03-14T00:00:00Z',
      updatedAt: '2026-03-14T02:00:00Z',
    });

    await migrateAoAgents(db, tmpDir, false);

    const agent = getAgent(db, 'agent-c') as AgentRecord;
    expect(agent.status).toBe('abandoned');
    expect(agent.completed_at).toBe('2026-03-14T02:00:00Z');
  });

  it('sets completed_at for terminal statuses', async () => {
    await writeAoYaml(tmpDir, 'agent-done.yaml', {
      id: 'agent-done',
      status: 'completed',
      createdAt: '2026-03-14T00:00:00Z',
      updatedAt: '2026-03-14T03:00:00Z',
    });

    await migrateAoAgents(db, tmpDir, false);

    const agent = getAgent(db, 'agent-done') as AgentRecord;
    expect(agent.completed_at).toBe('2026-03-14T03:00:00Z');
  });

  it('skips existing agents without error', async () => {
    // Pre-insert an agent
    const raw = db as unknown as {
      prepare(sql: string): { run(...args: unknown[]): void };
    };
    raw
      .prepare(
        `INSERT INTO agents (id, name, parent, status, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run('agent-existing', 'existing', 'human', 'active', '2026-01-01T00:00:00Z');

    await writeAoYaml(tmpDir, 'agent-existing.yaml', {
      id: 'agent-existing',
      status: 'completed',
    });

    const result = await migrateAoAgents(db, tmpDir, false);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([]);

    // Verify original was not overwritten
    const agent = getAgent(db, 'agent-existing') as AgentRecord;
    expect(agent.status).toBe('active');
  });

  it('dry-run shows results without writing', async () => {
    await writeAoYaml(tmpDir, 'agent-dry.yaml', {
      id: 'agent-dry',
      status: 'active',
    });

    const result = await migrateAoAgents(db, tmpDir, true);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);

    const agent = getAgent(db, 'agent-dry');
    expect(agent).toBeNull();
  });

  it('empty directory produces zero imports', async () => {
    const agentsDir = join(tmpDir, '.claude', 'ao', 'agents');
    await mkdir(agentsDir, { recursive: true });

    const result = await migrateAoAgents(db, tmpDir, false);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('handles multiple agents in one migration', async () => {
    for (let i = 1; i <= 3; i++) {
      await writeAoYaml(tmpDir, `agent-${i}.yaml`, {
        id: `agent-${i}`,
        status: 'completed',
        createdAt: `2026-03-14T0${i}:00:00Z`,
      });
    }

    const result = await migrateAoAgents(db, tmpDir, false);

    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('handles missing directory gracefully', async () => {
    const result = await migrateAoAgents(db, '/nonexistent', false);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);
  });
});
