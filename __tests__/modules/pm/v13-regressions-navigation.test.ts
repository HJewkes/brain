import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject, listProjects, getProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream, listWorkstreams } from '../../../src/modules/pm/data/workstream-ops.js';
import { listTasks, getTask } from '../../../src/modules/pm/data/task-ops.js';
import { createTestTask } from '../../helpers.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('reg-nav'));
  notesDir = join(tmpdir(), `reg-nav-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath: '', embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
  await createProject(db, config, embedder, { name: 'Volt', prefix: 'VOLT' });
  await createWorkstream(db, config, embedder, { project: 'VOLT', name: 'Core' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
});

describe('navigation regressions', () => {
  it('O-05: project list returns at least one project', () => {
    const result = listProjects(db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0].prefix).toBe('VOLT');
  });

  it('O-09: workstream list returns workstreams for existing project', () => {
    const result = listWorkstreams(db, 'VOLT');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0].project).toBe('VOLT');
  });

  it('O-11: task list returns created tasks', async () => {
    await createTestTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'Task A' });
    const result = listTasks(db, 'VOLT');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0].title).toBe('Task A');
  });

  it('O-17: display_id follows PREFIX-WS.NUM format', async () => {
    const result = await createTestTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'Test' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.display_id).toMatch(/^VOLT-\d{2}\.\d{2}$/);
    expect(result.data.display_id).toBe('VOLT-01.01');
  });

  it('O-36: getTask finds task by display_id', async () => {
    await createTestTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'Find me' });
    const result = getTask(db, 'VOLT-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.title).toBe('Find me');
    expect(result.data.display_id).toBe('VOLT-01.01');
  });

  it('O-39: task show includes all metadata fields', async () => {
    await createTestTask(db, config, embedder, {
      project: 'VOLT', workstream: 1, name: 'Detailed', priority: 'high', category: 'implementation',
    });
    const result = getTask(db, 'VOLT-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.priority).toBe('high');
    expect(result.data.category).toBe('implementation');
    expect(result.data.status).toBe('pending');
    expect(result.data.mode).toBe('auto');
    expect(result.data.project).toBe('VOLT');
    expect(result.data.workstream).toBe(1);
  });

  it('O-40: task list filters by workstream', async () => {
    await createWorkstream(db, config, embedder, { project: 'VOLT', name: 'Other' });
    await createTestTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'WS1 task' });
    await createTestTask(db, config, embedder, { project: 'VOLT', workstream: 2, name: 'WS2 task' });
    const result = listTasks(db, 'VOLT', { workstream: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBe(1);
    expect(result.data.every(t => t.workstream === 1)).toBe(true);
    expect(result.data[0].title).toBe('WS1 task');
  });

  it('O-54: project show returns project data', () => {
    const result = getProject(db, 'VOLT');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.prefix).toBe('VOLT');
    expect(result.data.display_id).toBe('VOLT');
    expect(result.data.status).toBe('active');
  });

  it('O-55: task list filters by status', async () => {
    await createTestTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'A' });
    await createTestTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'B' });
    const result = listTasks(db, 'VOLT', { status: 'pending' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBe(2);
    expect(result.data.every(t => t.status === 'pending')).toBe(true);
  });

  it('O-113: tasks auto-number sequentially within a workstream', async () => {
    await createTestTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'First' });
    await createTestTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'Second' });
    const result = listTasks(db, 'VOLT');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.data.map(t => t.display_id).sort();
    expect(ids).toContain('VOLT-01.01');
    expect(ids).toContain('VOLT-01.02');
    expect(result.data.find(t => t.display_id === 'VOLT-01.01')?.number).toBe(1);
    expect(result.data.find(t => t.display_id === 'VOLT-01.02')?.number).toBe(2);
  });
});
