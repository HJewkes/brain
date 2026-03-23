import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Command } from '@commander-js/extra-typings';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb } from '../../../helpers.js';
import { createStandardProject } from '../../../fixtures/pm-project.js';
import type { BrainConfig } from '../../../../src/types.js';
import {
  createDispatchWaveCommand,
  computeDispatchWave,
} from '../../../../src/modules/pm/commands/dispatch-wave.js';
import { updateTaskStatus } from '../../../../src/modules/pm/data/task-ops.js';

let db: BrainDB;
const embedder = createMockEmbedder();
let config: BrainConfig;

vi.mock('../../../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(async (fn) => fn({ db, embedder, config, modules: {}, close: () => {} })),
}));

let stdoutChunks: string[];
let stderrChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

function stderr(): string {
  return stderrChunks.join('');
}

function createParentCommand(): Command {
  const parent = new Command('pm');
  parent.addCommand(createDispatchWaveCommand());
  return parent;
}

async function run(...args: string[]): Promise<void> {
  await createParentCommand().parseAsync(['node', 'pm', ...args], { from: 'node' });
}

beforeEach(async () => {
  ({ db } = createTestDb());
  config = {
    notesDir: '/tmp/test-dispatch-wave',
    dbPath: ':memory:',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  stdoutChunks = [];
  stderrChunks = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  });
  process.exitCode = undefined;

  await createStandardProject(db, config, embedder);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('computeDispatchWave', () => {
  it('initial state: wave 0 has 2 eligible tasks (no deps)', () => {
    const result = computeDispatchWave(db, 'TEST');

    expect(result.wave).toBe(0);
    expect(result.eligible.map((t) => t.displayId).sort()).toEqual(['TEST-01.01', 'TEST-02.01']);
    expect(result.inProgress).toEqual([]);
  });

  it('eligible tasks include correct deps info', () => {
    const result = computeDispatchWave(db, 'TEST');

    const t01 = result.eligible.find((t) => t.displayId === 'TEST-01.01');
    expect(t01).toBeDefined();
    expect(t01!.deps).toEqual([]);

    const t02 = result.eligible.find((t) => t.displayId === 'TEST-02.01');
    expect(t02).toBeDefined();
    expect(t02!.deps).toEqual([]);
  });

  it('next wave shows blocked tasks with unmet deps', () => {
    const result = computeDispatchWave(db, 'TEST');

    expect(result.nextWave).not.toBeNull();
    const nextTaskIds = result.nextWave!.tasks.map((t) => t.displayId);
    expect(nextTaskIds).toContain('TEST-01.02');
    expect(nextTaskIds).toContain('TEST-02.02');
  });

  it('after completing wave-0 tasks, wave-1 tasks become eligible', async () => {
    for (const id of ['TEST-01.01', 'TEST-02.01']) {
      await updateTaskStatus(db, config, embedder, id, 'claimed');
      await updateTaskStatus(db, config, embedder, id, 'in-progress');
      await updateTaskStatus(db, config, embedder, id, 'done');
    }

    const result = computeDispatchWave(db, 'TEST');

    // TEST-01.02 depends only on TEST-01.01 (done)
    // TEST-02.02 depends on TEST-01.01 (done) + TEST-02.01 (done)
    const eligibleIds = result.eligible.map((t) => t.displayId);
    expect(eligibleIds).toContain('TEST-01.02');
    expect(eligibleIds).toContain('TEST-02.02');
  });

  it('in-progress tasks appear in inProgress list not eligible', async () => {
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');

    const result = computeDispatchWave(db, 'TEST');

    const eligibleIds = result.eligible.map((t) => t.displayId);
    const inProgressIds = result.inProgress.map((t) => t.displayId);

    expect(eligibleIds).not.toContain('TEST-01.01');
    expect(inProgressIds).toContain('TEST-01.01');
  });

  it('returns empty result when all tasks are done', async () => {
    const allIds = [
      'TEST-01.01',
      'TEST-02.01',
      'TEST-01.02',
      'TEST-02.02',
      'TEST-01.03',
      'TEST-02.03',
    ];
    for (const id of allIds) {
      const task = db.getNoteById(id);
      // Just mark done via status updates in correct dependency order
      void task;
    }

    // Complete all in dependency order
    for (const id of ['TEST-01.01', 'TEST-02.01']) {
      await updateTaskStatus(db, config, embedder, id, 'claimed');
      await updateTaskStatus(db, config, embedder, id, 'in-progress');
      await updateTaskStatus(db, config, embedder, id, 'done');
    }
    for (const id of ['TEST-01.02', 'TEST-02.02']) {
      await updateTaskStatus(db, config, embedder, id, 'claimed');
      await updateTaskStatus(db, config, embedder, id, 'in-progress');
      await updateTaskStatus(db, config, embedder, id, 'done');
    }
    for (const id of ['TEST-01.03', 'TEST-02.03']) {
      await updateTaskStatus(db, config, embedder, id, 'claimed');
      await updateTaskStatus(db, config, embedder, id, 'in-progress');
      await updateTaskStatus(db, config, embedder, id, 'done');
    }

    const result = computeDispatchWave(db, 'TEST');

    expect(result.eligible).toEqual([]);
    expect(result.inProgress).toEqual([]);
    expect(result.nextWave).toBeNull();
  });
});

describe('dispatch-wave CLI output', () => {
  it('shows wave summary with eligible tasks', async () => {
    await run('dispatch-wave', '--project', 'TEST');

    expect(stdout()).toContain('Wave 0');
    expect(stdout()).toContain('TEST-01.01');
    expect(stdout()).toContain('TEST-02.01');
    expect(process.exitCode).toBeUndefined();
  });

  it('--json outputs valid JSON with expected fields', async () => {
    await run('dispatch-wave', '--project', 'TEST', '--json');

    const output = JSON.parse(stdout());
    expect(output).toHaveProperty('wave', 0);
    expect(output).toHaveProperty('eligible');
    expect(output).toHaveProperty('inProgress');
    expect(output).toHaveProperty('blocked');
    expect(Array.isArray(output.eligible)).toBe(true);
    expect(output.eligible.map((t: { displayId: string }) => t.displayId).sort()).toEqual([
      'TEST-01.01',
      'TEST-02.01',
    ]);
  });

  it('--json nextWave contains blocked tasks', async () => {
    await run('dispatch-wave', '--project', 'TEST', '--json');

    const output = JSON.parse(stdout());
    expect(output.nextWave).not.toBeNull();
    const nextIds = output.nextWave.tasks.map((t: { displayId: string }) => t.displayId);
    expect(nextIds).toContain('TEST-01.02');
  });

  it('--max limits eligible tasks dispatched', async () => {
    await run('dispatch-wave', '--project', 'TEST', '--json', '--max', '1');

    const output = JSON.parse(stdout());
    expect(output.eligible.length).toBeLessThanOrEqual(1);
  });

  it('--dry-run shows would-claim message without claiming', async () => {
    await run('dispatch-wave', '--project', 'TEST', '--dry-run');

    expect(stdout()).toContain('[dry-run]');
    expect(stdout()).toContain('Would claim');
    // Tasks should still be pending (not claimed)
    const { getTask } = await import('../../../../src/modules/pm/data/task-ops.js');
    const t = getTask(db, 'TEST-01.01');
    expect(t.ok && t.data.status).toBe('pending');
  });

  it('--claim transitions eligible tasks to claimed', async () => {
    await run('dispatch-wave', '--project', 'TEST', '--claim');

    expect(stdout()).toContain('Claiming');
    expect(stdout()).toContain('pending → claimed');

    const { getTask } = await import('../../../../src/modules/pm/data/task-ops.js');
    const t1 = getTask(db, 'TEST-01.01');
    const t2 = getTask(db, 'TEST-02.01');
    expect(t1.ok && t1.data.status).toBe('claimed');
    expect(t2.ok && t2.data.status).toBe('claimed');
  });

  it('shows next wave blocked message', async () => {
    await run('dispatch-wave', '--project', 'TEST');

    expect(stdout()).toContain('Next wave (blocked)');
  });

  it('shows error when project not found', async () => {
    await run('dispatch-wave', '--project', 'NOPE');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('NOPE');
  });
});
