import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { loadModules } from '../../../src/modules/loader.js';
import { pmModule } from '../../../src/modules/pm/index.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { updateTaskStatus, listTasks } from '../../../src/modules/pm/data/task-ops.js';
import { assembleDispatch } from '../../../src/modules/pm/engine/dispatch.js';
import { computeWaves } from '../../../src/modules/pm/engine/dependency.js';
import { createTestTask } from '../../helpers.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('v13-integration'));
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `v13-int-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath: '',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await loadModules({ modules: [pmModule] });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
});

describe('V13 integration: full workflow', () => {
  it('end-to-end: create → deps → complete → activity → eligible', async () => {
    await createProject(db, config, embedder, { name: 'Integration', prefix: 'INT' });
    await createWorkstream(db, config, embedder, { project: 'INT', name: 'Core' });

    await createTestTask(db, config, embedder, { project: 'INT', workstream: 1, name: 'Foundation' });
    await createTestTask(db, config, embedder, {
      project: 'INT', workstream: 1, name: 'Build on foundation',
      dependsOn: ['INT-01.01'],
    });
    await createTestTask(db, config, embedder, {
      project: 'INT', workstream: 1, name: 'Final step',
      dependsOn: ['INT-01.02'],
    });

    // Verify waves reflect dependency chain
    const waves = computeWaves(db, 'INT');
    expect(waves.length).toBe(3);
    expect(waves[0].taskIds).toContain('INT-01.01');
    expect(waves[1].taskIds).toContain('INT-01.02');
    expect(waves[2].taskIds).toContain('INT-01.03');

    // Verify virtual states before completion
    let tasks = listTasks(db, 'INT');
    expect(tasks.ok).toBe(true);
    if (!tasks.ok) return;
    const t2 = tasks.data.find(t => t.display_id === 'INT-01.02');
    expect(t2?.virtualStates).toContain('+BLOCKED');

    // Complete first task through valid state transitions
    await updateTaskStatus(db, config, embedder, 'INT-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'INT-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'INT-01.01', 'done');

    // Verify activity notes were created
    const allNotes = db.getAllNotes();
    const activities = allNotes.filter(n => {
      if (!n.metadata) return false;
      const meta = JSON.parse(n.metadata);
      return meta.type === 'activity' && meta.activity_type !== 'onboard';
    });
    // Should have: claim, start, complete activity notes
    expect(activities.length).toBeGreaterThanOrEqual(3);

    // Verify complete activity has newly_eligible
    const completeActivity = activities.find(n => {
      const meta = JSON.parse(n.metadata!);
      return meta.activity_type === 'complete';
    });
    expect(completeActivity).toBeDefined();
    const completeMeta = JSON.parse(completeActivity!.metadata!);
    expect(completeMeta.newly_eligible).toContain('INT-01.02');

    // Verify second task is now unblocked
    tasks = listTasks(db, 'INT');
    if (!tasks.ok) return;
    const t2After = tasks.data.find(t => t.display_id === 'INT-01.02');
    expect(t2After?.virtualStates).toContain('+READY');
    expect(t2After?.virtualStates).not.toContain('+BLOCKED');
  });

  it('hybrid context includes relatedNotes field', async () => {
    await createProject(db, config, embedder, { name: 'Hybrid', prefix: 'HYB' });
    await createWorkstream(db, config, embedder, { project: 'HYB', name: 'Core' });
    await createTestTask(db, config, embedder, { project: 'HYB', workstream: 1, name: 'Design auth system' });
    await createTestTask(db, config, embedder, {
      project: 'HYB', workstream: 1, name: 'Implement auth',
      dependsOn: ['HYB-01.01'],
    });

    const result = await assembleDispatch(db, embedder, config, 'HYB-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Hybrid context should include relatedNotes (may be empty if no semantic matches)
    expect(result.data.relatedNotes).toBeDefined();
    expect(Array.isArray(result.data.relatedNotes)).toBe(true);
  });

  it('relations are single source of truth for deps', async () => {
    await createProject(db, config, embedder, { name: 'Rel', prefix: 'REL' });
    await createWorkstream(db, config, embedder, { project: 'REL', name: 'Core' });
    await createTestTask(db, config, embedder, { project: 'REL', workstream: 1, name: 'A' });
    await createTestTask(db, config, embedder, {
      project: 'REL', workstream: 1, name: 'B', dependsOn: ['REL-01.01'],
    });

    // Dependencies should come from relations
    const tasks = listTasks(db, 'REL');
    expect(tasks.ok).toBe(true);
    if (!tasks.ok) return;
    const b = tasks.data.find(t => t.display_id === 'REL-01.02');
    expect(b?.depends_on).toContain('REL-01.01');

    // Add a third task and manually add a relation (simulating inferDependencies)
    await createTestTask(db, config, embedder, { project: 'REL', workstream: 1, name: 'C' });
    const notes = db.getAllNotes();
    const cNote = notes.find(n => {
      if (!n.metadata) return false;
      const meta = JSON.parse(n.metadata);
      return meta.display_id === 'REL-01.03';
    });
    const aNote = notes.find(n => {
      if (!n.metadata) return false;
      const meta = JSON.parse(n.metadata);
      return meta.display_id === 'REL-01.01';
    });
    expect(cNote).toBeDefined();
    expect(aNote).toBeDefined();

    db.upsertRelations(cNote!.id, [
      { sourceId: cNote!.id, targetId: aNote!.id, type: 'depends_on' },
    ]);

    // C should now show dep on A (from relations)
    const tasks2 = listTasks(db, 'REL');
    if (!tasks2.ok) return;
    const c = tasks2.data.find(t => t.display_id === 'REL-01.03');
    expect(c?.depends_on).toContain('REL-01.01');
  });

  it('embed_status and activity_type generated columns exist', () => {
    const info = (db as unknown as { db: { prepare: (s: string) => { all: () => Array<{ name: string }> } } })
      .db.prepare('PRAGMA table_xinfo(notes)').all();
    const embedCol = info.find(c => c.name === 'embed_status');
    const activityCol = info.find(c => c.name === 'activity_type');
    expect(embedCol).toBeDefined();
    expect(activityCol).toBeDefined();
  });

  it('waves exclude completed tasks and recompute correctly', async () => {
    await createProject(db, config, embedder, { name: 'Waves', prefix: 'WAV' });
    await createWorkstream(db, config, embedder, { project: 'WAV', name: 'Core' });
    await createTestTask(db, config, embedder, { project: 'WAV', workstream: 1, name: 'First' });
    await createTestTask(db, config, embedder, {
      project: 'WAV', workstream: 1, name: 'Second',
      dependsOn: ['WAV-01.01'],
    });

    // Initially two waves
    let waves = computeWaves(db, 'WAV');
    expect(waves.length).toBe(2);

    // Complete first task
    await updateTaskStatus(db, config, embedder, 'WAV-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'WAV-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'WAV-01.01', 'done');

    // Waves should exclude completed task
    waves = computeWaves(db, 'WAV');
    const allTaskIds = waves.flatMap(w => w.taskIds);
    expect(allTaskIds).not.toContain('WAV-01.01');
    expect(allTaskIds).toContain('WAV-01.02');
  });
});
