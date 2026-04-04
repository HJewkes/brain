import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { buildPlanningCompletion } from '../../../../src/modules/workflow/flows/planning-completion.js';
import type { BrainDB } from '../../../../src/services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../../src/types.js';

// Mock indexSingleFile and createTask
vi.mock('../../../../src/services/indexing.js', () => ({
  indexSingleFile: vi.fn().mockResolvedValue('note-id-mock'),
}));

vi.mock('../../../../src/modules/pm/data/task-ops.js', () => ({
  createTask: vi.fn().mockResolvedValue({
    ok: true,
    data: { display_id: 'TST-01.005' },
  }),
}));

describe('buildPlanningCompletion', () => {
  let projectDir: string;
  let notesDir: string;
  let planId: string;
  let config: BrainConfig;
  let db: BrainDB;
  let embedder: Embedder;

  beforeEach(() => {
    projectDir = join(tmpdir(), `plan-complete-${randomUUID()}`);
    notesDir = join(projectDir, '.brain', 'notes');
    planId = `test-${randomUUID().slice(0, 8)}`;
    mkdirSync(join(projectDir, '.plans', planId), { recursive: true });
    mkdirSync(notesDir, { recursive: true });

    config = {
      notesDir,
      dbPath: join(projectDir, 'brain.db'),
      embedder: 'local',
      fusionWeights: { bm25: 0.3, vector: 0.7 },
    };

    db = {} as BrainDB;
    embedder = { embed: vi.fn().mockResolvedValue([new Float32Array(768)]) } as unknown as Embedder;

    vi.clearAllMocks();
  });

  afterEach(() => {
    if (existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test('ingests existing plan artifacts as brain notes', async () => {
    const planDir = join(projectDir, '.plans', planId);
    writeFileSync(join(planDir, 'spec.md'), '# Spec\nContent here');
    writeFileSync(join(planDir, 'design.md'), '# Design\nDesign content');

    const seedFn = buildPlanningCompletion({
      projectDir,
      planId,
      brief: 'Build a new feature',
      workflowName: 'planning',
      project: 'TST',
      workstream: 1,
      db,
      config,
      embedder,
    });

    const result = await seedFn();

    expect(result.data.ingestedCount).toBe('2');
    expect(result.output).toContain('Ingested 2 plan artifact(s)');

    const { indexSingleFile } = await import('../../../../src/services/indexing.js');
    expect(indexSingleFile).toHaveBeenCalledTimes(2);
  });

  test('creates implementation task with correct metadata', async () => {
    const planDir = join(projectDir, '.plans', planId);
    writeFileSync(join(planDir, 'spec.md'), '# Spec');

    const seedFn = buildPlanningCompletion({
      projectDir,
      planId,
      brief: 'Build a brand new fancy feature with lots of detail',
      workflowName: 'planning',
      project: 'TST',
      workstream: 1,
      db,
      config,
      embedder,
    });

    const result = await seedFn();

    expect(result.data.implementationTask).toBe('TST-01.005');
    expect(result.output).toContain('Created implementation task: TST-01.005');

    const { createTask } = await import('../../../../src/modules/pm/data/task-ops.js');
    expect(createTask).toHaveBeenCalledWith(
      db,
      config,
      embedder,
      expect.objectContaining({
        project: 'TST',
        workstream: 1,
        category: 'implementation',
        priority: 'high',
        name: expect.stringContaining('Implement:'),
      })
    );
  });

  test('cleans up plan directory after successful ingestion', async () => {
    const planDir = join(projectDir, '.plans', planId);
    writeFileSync(join(planDir, 'spec.md'), '# Spec');

    const seedFn = buildPlanningCompletion({
      projectDir,
      planId,
      brief: 'Test cleanup',
      workflowName: 'planning',
      project: 'TST',
      workstream: 1,
      db,
      config,
      embedder,
    });

    await seedFn();

    expect(existsSync(planDir)).toBe(false);
  });

  test('returns zero count when no artifacts exist', async () => {
    const seedFn = buildPlanningCompletion({
      projectDir,
      planId,
      brief: 'No artifacts',
      workflowName: 'planning',
      project: 'TST',
      workstream: 1,
      db,
      config,
      embedder,
    });

    const result = await seedFn();

    expect(result.data.ingestedCount).toBe('0');
    expect(result.output).toContain('No plan artifacts found');
  });

  test('skips non-existent artifact files gracefully', async () => {
    const planDir = join(projectDir, '.plans', planId);
    // Only create spec.md, skip design.md, acceptance-criteria.md, critic-report.md
    writeFileSync(join(planDir, 'spec.md'), '# Spec only');

    const seedFn = buildPlanningCompletion({
      projectDir,
      planId,
      brief: 'Partial artifacts',
      workflowName: 'planning',
      project: 'TST',
      workstream: 1,
      db,
      config,
      embedder,
    });

    const result = await seedFn();

    expect(result.data.ingestedCount).toBe('1');

    const { indexSingleFile } = await import('../../../../src/services/indexing.js');
    expect(indexSingleFile).toHaveBeenCalledTimes(1);
  });
});
