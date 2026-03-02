import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject, getProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream, listWorkstreams } from '../../../src/modules/pm/data/workstream-ops.js';
import { createTask, listTasks, deleteTask, updateTask } from '../../../src/modules/pm/data/task-ops.js';
import { computeWaves } from '../../../src/modules/pm/engine/dependency.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('reg-data'));
  notesDir = join(tmpdir(), `reg-data-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath: '', embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
  await createProject(db, config, embedder, { name: 'Volt', prefix: 'VOLT' });
  await createWorkstream(db, config, embedder, { project: 'VOLT', name: 'Core' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
});

describe('data regressions', () => {
  // O-66: createTask with dependencies creates relation edges
  it('O-66: dependencies create relations', async () => {
    await createTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'A' });
    await createTask(db, config, embedder, {
      project: 'VOLT', workstream: 1, name: 'B', dependsOn: ['VOLT-01.01'],
    });
    const notes = db.getAllNotes();
    const bNote = notes.find(n => {
      if (!n.metadata) return false;
      const meta = JSON.parse(n.metadata);
      return meta.display_id === 'VOLT-01.02';
    });
    expect(bNote).toBeDefined();
    const rels = db.getRelationsFrom(bNote!.id);
    expect(rels.some(r => r.type === 'depends_on')).toBe(true);
  });

  // O-68: task update changes metadata
  it('O-68: updateTask changes priority', async () => {
    await createTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'Test' });
    const result = await updateTask(db, config, embedder, 'VOLT-01.01', { priority: 'critical' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.priority).toBe('critical');
  });

  // O-70: deleteTask removes note and relations
  it('O-70: deleteTask cleans up', async () => {
    await createTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'Delete me' });
    const result = await deleteTask(db, config, 'VOLT-01.01');
    expect(result.ok).toBe(true);
    const listResult = listTasks(db, 'VOLT');
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.data.length).toBe(0);
  });

  // O-73: task list includes workstream name
  it('O-73: listTasks enriches workstream_name', async () => {
    await createTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'Test' });
    const result = listTasks(db, 'VOLT');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].workstream_name).toBeDefined();
    expect(result.data[0].workstream_display_id).toBeDefined();
    expect(result.data[0].workstream_display_id).toBe('VOLT-01');
  });

  // O-80: computeWaves returns proper wave grouping
  it('O-80: waves respect dependency ordering', async () => {
    await createTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'A' });
    await createTask(db, config, embedder, {
      project: 'VOLT', workstream: 1, name: 'B', dependsOn: ['VOLT-01.01'],
    });
    const waves = computeWaves(db, 'VOLT');
    expect(waves.length).toBe(2);
    expect(waves[0].wave).toBe(0);
    expect(waves[1].wave).toBe(1);
    expect(waves[0].taskIds).toContain('VOLT-01.01');
    expect(waves[1].taskIds).toContain('VOLT-01.02');
  });

  // O-88: task list includes virtual states
  it('O-88: listTasks includes virtualStates', async () => {
    await createTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'Ready' });
    const result = listTasks(db, 'VOLT');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].virtualStates).toBeDefined();
    expect(Array.isArray(result.data[0].virtualStates)).toBe(true);
  });

  // O-91: task with acceptance_criteria
  it('O-91: acceptance_criteria passed through', async () => {
    await createTask(db, config, embedder, {
      project: 'VOLT', workstream: 1, name: 'AC test',
      acceptanceCriteria: ['Must compile', 'Tests pass'],
    });
    const result = listTasks(db, 'VOLT');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].acceptance_criteria).toBeDefined();
    expect(result.data[0].acceptance_criteria!.length).toBe(2);
    expect(result.data[0].acceptance_criteria).toContain('Must compile');
    expect(result.data[0].acceptance_criteria).toContain('Tests pass');
  });

  // O-97: task file exists on disk after creation
  it('O-97: task file written to disk', async () => {
    await createTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'Disk test' });
    const taskFile = join(notesDir, 'modules', 'pm', 'VOLT', 'VOLT-01.01.md');
    expect(existsSync(taskFile)).toBe(true);
  });

  // O-102: project create then get round-trip
  it('O-102: project round-trip create then get', () => {
    const result = getProject(db, 'VOLT');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.prefix).toBe('VOLT');
    expect(result.data.status).toBe('active');
    expect(result.data.display_id).toBe('VOLT');
  });

  // O-103: workstreams list returns created workstreams
  it('O-103: project lists workstreams', () => {
    const wsResult = listWorkstreams(db, 'VOLT');
    expect(wsResult.ok).toBe(true);
    if (!wsResult.ok) return;
    expect(wsResult.data.length).toBeGreaterThan(0);
    expect(wsResult.data[0].display_id).toBe('VOLT-01');
    expect(wsResult.data[0].project).toBe('VOLT');
  });
});
