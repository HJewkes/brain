import { describe, test, expect, vi } from 'vitest';
import { releaseWorkflowTasks } from '../../../../src/modules/workflow/runtime/failure-cleanup.js';
import type { WorkflowRun } from '../../../../src/modules/workflow/runtime/types.js';
import type { BrainDB } from '../../../../src/services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../../src/types.js';

vi.mock('../../../../src/modules/pm/data/task-ops.js', () => ({
  updateTaskStatus: vi.fn().mockResolvedValue({ ok: true, data: { status: 'pending' } }),
}));

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    workflowName: 'planning',
    context: { project: 'TST', workstream: '1', brief: 'test' },
    status: 'failed',
    currentStep: null,
    stepResults: {},
    activeAgent: null,
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: null,
    error: null,
    ...overrides,
  };
}

describe('releaseWorkflowTasks', () => {
  const db = {} as BrainDB;
  const config = { notesDir: '/tmp', dbPath: '/tmp/db', embedder: 'local' } as BrainConfig;
  const embedder = { embed: vi.fn() } as unknown as Embedder;

  test('releases tasks from step results', async () => {
    const { updateTaskStatus } = await import('../../../../src/modules/pm/data/task-ops.js');
    vi.mocked(updateTaskStatus).mockClear();

    const run = makeRun({
      stepResults: {
        'design:0': {
          stepId: 'design',
          taskId: 'TST-01.001',
          agentId: 'agent-1',
          signal: null,
          completedAt: '2026-01-01T00:00:00Z',
        },
        'critic:0': {
          stepId: 'critic',
          taskId: 'TST-01.002',
          agentId: 'agent-2',
          signal: null,
          completedAt: '2026-01-01T00:01:00Z',
        },
      },
    });

    const released = await releaseWorkflowTasks(db, config, embedder, run);

    expect(released).toBe(2);
    expect(updateTaskStatus).toHaveBeenCalledTimes(2);
    expect(updateTaskStatus).toHaveBeenCalledWith(db, config, embedder, 'TST-01.001', 'pending');
    expect(updateTaskStatus).toHaveBeenCalledWith(db, config, embedder, 'TST-01.002', 'pending');
  });

  test('includes active agent task in release', async () => {
    const { updateTaskStatus } = await import('../../../../src/modules/pm/data/task-ops.js');
    vi.mocked(updateTaskStatus).mockClear();

    const run = makeRun({
      activeAgent: { pid: 12345, taskId: 'TST-01.003', stepId: 'spec-tests' },
    });

    const released = await releaseWorkflowTasks(db, config, embedder, run);

    expect(released).toBe(1);
    expect(updateTaskStatus).toHaveBeenCalledWith(db, config, embedder, 'TST-01.003', 'pending');
  });

  test('skips seed tasks', async () => {
    const { updateTaskStatus } = await import('../../../../src/modules/pm/data/task-ops.js');
    vi.mocked(updateTaskStatus).mockClear();

    const run = makeRun({
      stepResults: {
        seed: {
          stepId: 'seed',
          taskId: 'seed:seed',
          agentId: null,
          signal: null,
          completedAt: '2026-01-01T00:00:00Z',
        },
      },
    });

    const released = await releaseWorkflowTasks(db, config, embedder, run);

    expect(released).toBe(0);
    expect(updateTaskStatus).not.toHaveBeenCalled();
  });

  test('deduplicates task IDs', async () => {
    const { updateTaskStatus } = await import('../../../../src/modules/pm/data/task-ops.js');
    vi.mocked(updateTaskStatus).mockClear();

    const run = makeRun({
      stepResults: {
        'design:0': {
          stepId: 'design',
          taskId: 'TST-01.001',
          agentId: 'agent-1',
          signal: null,
          completedAt: '2026-01-01T00:00:00Z',
        },
      },
      activeAgent: { pid: 12345, taskId: 'TST-01.001', stepId: 'design' },
    });

    const released = await releaseWorkflowTasks(db, config, embedder, run);

    expect(released).toBe(1);
    expect(updateTaskStatus).toHaveBeenCalledTimes(1);
  });

  test('returns 0 when no embedder available', async () => {
    const { updateTaskStatus } = await import('../../../../src/modules/pm/data/task-ops.js');
    vi.mocked(updateTaskStatus).mockClear();

    const run = makeRun({
      stepResults: {
        'design:0': {
          stepId: 'design',
          taskId: 'TST-01.001',
          agentId: 'agent-1',
          signal: null,
          completedAt: '2026-01-01T00:00:00Z',
        },
      },
    });

    const released = await releaseWorkflowTasks(db, config, undefined, run);

    expect(released).toBe(0);
    expect(updateTaskStatus).not.toHaveBeenCalled();
  });

  test('continues releasing when individual task fails', async () => {
    const { updateTaskStatus } = await import('../../../../src/modules/pm/data/task-ops.js');
    vi.mocked(updateTaskStatus).mockClear();
    vi.mocked(updateTaskStatus)
      .mockRejectedValueOnce(new Error('task not found'))
      .mockResolvedValueOnce({ ok: true, data: { status: 'pending' } } as any);

    const run = makeRun({
      stepResults: {
        'design:0': {
          stepId: 'design',
          taskId: 'TST-01.001',
          agentId: 'agent-1',
          signal: null,
          completedAt: '2026-01-01T00:00:00Z',
        },
        'critic:0': {
          stepId: 'critic',
          taskId: 'TST-01.002',
          agentId: 'agent-2',
          signal: null,
          completedAt: '2026-01-01T00:01:00Z',
        },
      },
    });

    const released = await releaseWorkflowTasks(db, config, embedder, run);

    expect(released).toBe(1);
    expect(updateTaskStatus).toHaveBeenCalledTimes(2);
  });
});
