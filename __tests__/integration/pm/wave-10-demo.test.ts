import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { loadModules } from '../../../src/modules/loader.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { pmModule } from '../../../src/modules/pm/index.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { createTask, listTasks, updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';
import { createDecision } from '../../../src/modules/pm/data/decision-ops.js';
import { computeWaves, computeEligible } from '../../../src/modules/pm/engine/dependency.js';
import { assembleContext } from '../../../src/modules/pm/engine/dispatch.js';
import { computeRouting } from '../../../src/modules/pm/engine/routing.js';
import { renderAgentPrompt } from '../../../src/modules/pm/engine/template.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  const dbPath = tmpDbPath('pm-wave10-demo');
  db = new BrainDB(dbPath);
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `pm-wave10-demo-${randomUUID()}`);
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
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

async function setupDemoProject(): Promise<void> {
  await createProject(db, config, embedder, { name: 'CLI Todo App', prefix: 'DEMO' });
  await createWorkstream(db, config, embedder, { project: 'DEMO', name: 'Implementation' });
  await createWorkstream(db, config, embedder, { project: 'DEMO', name: 'Testing' });

  // Wave 0: design (no deps)
  await createTask(db, config, embedder, {
    project: 'DEMO', workstream: 1, name: 'Design data model',
    category: 'design', mode: 'agent',
  });
  // Wave 1: implement (depends on design)
  await createTask(db, config, embedder, {
    project: 'DEMO', workstream: 1, name: 'Implement CRUD',
    category: 'implementation', mode: 'agent', dependsOn: ['DEMO-01.01'],
  });
  // Wave 1: docs (depends on design)
  await createTask(db, config, embedder, {
    project: 'DEMO', workstream: 1, name: 'Write README',
    category: 'documentation', mode: 'agent', dependsOn: ['DEMO-01.01'],
  });
  // Wave 2: tests (depends on CRUD)
  await createTask(db, config, embedder, {
    project: 'DEMO', workstream: 2, name: 'Unit tests',
    category: 'testing', mode: 'agent', dependsOn: ['DEMO-01.02'],
  });
  // Wave 2: config (depends on CRUD)
  await createTask(db, config, embedder, {
    project: 'DEMO', workstream: 1, name: 'CI configuration',
    category: 'configuration', mode: 'agent', dependsOn: ['DEMO-01.02'],
  });
  // Wave 3: integration (depends on tests + config)
  await createTask(db, config, embedder, {
    project: 'DEMO', workstream: 2, name: 'Integration tests',
    category: 'testing', mode: 'agent', dependsOn: ['DEMO-02.01', 'DEMO-01.04'],
  });
}

describe('Wave 10: Demo Workflow Integration', () => {
  it('full project lifecycle: create -> workstreams -> tasks -> verify structure', async () => {
    await setupDemoProject();

    const tasks = listTasks(db, 'DEMO');
    expect(tasks.ok).toBe(true);
    if (!tasks.ok) return;

    expect(tasks.data).toHaveLength(6);

    const ids = tasks.data.map((t) => t.display_id).sort();
    expect(ids).toEqual([
      'DEMO-01.01', 'DEMO-01.02', 'DEMO-01.03', 'DEMO-01.04',
      'DEMO-02.01', 'DEMO-02.02',
    ]);

    const withDeps = tasks.data.filter((t) => t.depends_on && t.depends_on.length > 0);
    expect(withDeps).toHaveLength(5);

    const designTask = tasks.data.find((t) => t.display_id === 'DEMO-01.01')!;
    expect(designTask.category).toBe('design');
    expect(designTask.status).toBe('pending');
  });

  it('wave computation groups tasks by dependency depth', async () => {
    await setupDemoProject();

    const waves = computeWaves(db, 'DEMO');
    expect(waves.length).toBe(4);

    expect(waves[0].taskIds).toEqual(['DEMO-01.01']);
    expect(waves[1].taskIds.sort()).toEqual(['DEMO-01.02', 'DEMO-01.03']);
    expect(waves[2].taskIds.sort()).toEqual(['DEMO-01.04', 'DEMO-02.01']);
    expect(waves[3].taskIds).toEqual(['DEMO-02.02']);

    for (let i = 1; i < waves.length; i++) {
      expect(waves[i].wave).toBeGreaterThan(waves[i - 1].wave);
    }
  });

  it('eligible task progression follows wave order', async () => {
    await setupDemoProject();

    // Initially only wave 0 is eligible
    let eligible = computeEligible(db, 'DEMO');
    expect(eligible).toEqual(['DEMO-01.01']);

    // Complete design -> wave 1 becomes eligible
    await updateTaskStatus(db, config, embedder, 'DEMO-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'DEMO-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'DEMO-01.01', 'done');

    eligible = computeEligible(db, 'DEMO');
    expect(eligible.sort()).toEqual(['DEMO-01.02', 'DEMO-01.03']);

    // Complete CRUD -> wave 2 tasks that depend only on CRUD become eligible
    await updateTaskStatus(db, config, embedder, 'DEMO-01.02', 'claimed');
    await updateTaskStatus(db, config, embedder, 'DEMO-01.02', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'DEMO-01.02', 'done');

    eligible = computeEligible(db, 'DEMO');
    expect(eligible).toContain('DEMO-02.01');
    expect(eligible).toContain('DEMO-01.04');
    // DEMO-01.03 still eligible (pending, no unmet deps)
    expect(eligible).toContain('DEMO-01.03');
    // DEMO-02.02 not eligible (depends on DEMO-02.01 and DEMO-01.04)
    expect(eligible).not.toContain('DEMO-02.02');
  });

  it('routing computation maps each category to correct profile', () => {
    const design = computeRouting('design', 'agent');
    expect(design.model).toBe('opus');
    expect(design.isolation).toBe('none');

    const impl = computeRouting('implementation', 'agent');
    expect(impl.model).toBe('opus');
    expect(impl.isolation).toBe('worktree');
    expect(impl.verify).toBe(true);

    const testing = computeRouting('testing', 'agent');
    expect(testing.model).toBe('haiku');
    expect(testing.isolation).toBe('none');

    const docs = computeRouting('documentation', 'agent');
    expect(docs.model).toBe('sonnet');
    expect(docs.isolation).toBe('none');

    // Non-agent mode returns default profile
    const manual = computeRouting('implementation', 'human');
    expect(manual.model).toBe('sonnet');
    expect(manual.verify).toBe(false);
  });

  it('context bundle includes dependency status and decisions', async () => {
    await setupDemoProject();

    // Complete design task
    await updateTaskStatus(db, config, embedder, 'DEMO-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'DEMO-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'DEMO-01.01', 'done');

    // Add decision on design task that impacts CRUD
    await createDecision(db, config, embedder, {
      project: 'DEMO',
      name: 'Use JSON storage',
      sourceTask: 'DEMO-01.01',
      impacts: ['DEMO-01.02'],
      content: 'Store todos as JSON for simplicity',
    });

    const ctx = assembleContext(db, 'DEMO-01.02');
    expect(ctx.ok).toBe(true);
    if (!ctx.ok) return;

    expect(ctx.data.task.display_id).toBe('DEMO-01.02');
    expect(ctx.data.dependencies).toHaveLength(1);
    expect(ctx.data.dependencies[0].displayId).toBe('DEMO-01.01');
    expect(ctx.data.dependencies[0].status).toBe('done');
    expect(ctx.data.decisions).toHaveLength(1);
    expect(ctx.data.decisions[0].content).toBe('Use JSON storage');
    expect(ctx.data.contextHash).toBeDefined();
  });

  it('agent prompt contains required sections', async () => {
    await setupDemoProject();

    // Complete design so CRUD has a done dependency
    await updateTaskStatus(db, config, embedder, 'DEMO-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'DEMO-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'DEMO-01.01', 'done');

    await createDecision(db, config, embedder, {
      project: 'DEMO',
      name: 'Use JSON storage',
      sourceTask: 'DEMO-01.01',
      impacts: ['DEMO-01.02'],
      content: 'JSON for storage',
    });

    const ctx = assembleContext(db, 'DEMO-01.02');
    expect(ctx.ok).toBe(true);
    if (!ctx.ok) return;

    const prompt = renderAgentPrompt(ctx.data);
    expect(prompt).toContain('# Task DEMO-01.02');
    expect(prompt).toContain('## Dependencies');
    expect(prompt).toContain('DEMO-01.01');
    expect(prompt).toContain('## Decisions');
    expect(prompt).toContain('Use JSON storage');
    expect(prompt).toContain('## Validation');
    expect(prompt).toContain('## Status Reporting');
    expect(prompt).toContain('brain pm task update DEMO-01.02');
    expect(prompt).toContain('## Completion');
  });

  it('decision propagation: decision on A appears in B context', async () => {
    await setupDemoProject();

    await createDecision(db, config, embedder, {
      project: 'DEMO',
      name: 'Use TypeScript',
      sourceTask: 'DEMO-01.01',
      impacts: ['DEMO-01.02'],
      content: 'All code in TypeScript',
    });

    const ctx = assembleContext(db, 'DEMO-01.02');
    expect(ctx.ok).toBe(true);
    if (!ctx.ok) return;

    expect(ctx.data.decisions.length).toBe(1);
    expect(ctx.data.decisions[0].content).toBe('Use TypeScript');
    expect(ctx.data.decisions[0].status).toBe('accepted');
  });

  it('session summary: mixed task states produce correct counts', async () => {
    await setupDemoProject();

    // Set up mixed states: 2 done, 1 in-progress, 2 pending, 1 blocked
    await updateTaskStatus(db, config, embedder, 'DEMO-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'DEMO-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'DEMO-01.01', 'done');

    await updateTaskStatus(db, config, embedder, 'DEMO-01.02', 'claimed');
    await updateTaskStatus(db, config, embedder, 'DEMO-01.02', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'DEMO-01.02', 'done');

    await updateTaskStatus(db, config, embedder, 'DEMO-01.03', 'claimed');
    await updateTaskStatus(db, config, embedder, 'DEMO-01.03', 'in-progress');

    await updateTaskStatus(db, config, embedder, 'DEMO-02.01', 'blocked');

    const tasks = listTasks(db, 'DEMO');
    expect(tasks.ok).toBe(true);
    if (!tasks.ok) return;

    const counts = { done: 0, 'in-progress': 0, pending: 0, blocked: 0 };
    for (const t of tasks.data) {
      if (t.status in counts) {
        counts[t.status as keyof typeof counts]++;
      }
    }

    expect(counts.done).toBe(2);
    expect(counts['in-progress']).toBe(1);
    expect(counts.pending).toBe(2);
    expect(counts.blocked).toBe(1);
    expect(tasks.data.length).toBe(6);
  });
});
