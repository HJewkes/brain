import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrainServiceClass } from '../../src/services/brain-service.js';
import type { TaskMetadata } from '../../src/modules/pm/types.js';
import type { AgentRecord, WorktreeAllocation } from '../../src/modules/agents/types.js';
import type { DeliveryRecord } from '../../src/modules/agents/delivery.js';

vi.mock('../../src/modules/pm/data/queries.js', () => ({
  resolveProject: vi.fn(),
  getPmNotes: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/modules/pm/data/task-ops.js', () => ({
  listTasks: vi.fn(),
}));

vi.mock('../../src/modules/agents/data.js', () => ({
  listAgents: vi.fn(),
  getWorktreeAllocations: vi.fn(),
}));

vi.mock('../../src/modules/pm/engine/dependency.js', () => ({
  computeEligible: vi.fn(),
}));

const { resolveProject } = await import('../../src/modules/pm/data/queries.js');
const { listTasks } = await import('../../src/modules/pm/data/task-ops.js');
const { listAgents, getWorktreeAllocations } = await import('../../src/modules/agents/data.js');
const { computeEligible } = await import('../../src/modules/pm/engine/dependency.js');
const { triageDispatch } = await import('../../src/server/triage.js');

const mockResolveProject = resolveProject as ReturnType<typeof vi.fn>;
const mockListTasks = listTasks as ReturnType<typeof vi.fn>;
const mockListAgents = listAgents as ReturnType<typeof vi.fn>;
const mockGetWorktreeAllocations = getWorktreeAllocations as ReturnType<typeof vi.fn>;
const mockComputeEligible = computeEligible as ReturnType<typeof vi.fn>;

function makeTask(overrides: Partial<TaskMetadata>): TaskMetadata {
  return {
    display_id: 'VNM-01.01',
    project: 'VNM',
    workstream: 1,
    number: 1,
    title: 'Task',
    status: 'pending',
    mode: 'agent',
    category: 'implementation',
    priority: 'medium',
    depends_on: [],
    ...overrides,
  } as TaskMetadata;
}

function makeAgent(overrides: Partial<AgentRecord>): AgentRecord {
  return {
    id: 'a1',
    name: 'agent',
    parent: 'root',
    status: 'active',
    brain_task: 'VNM-01.01',
    claim_token: null,
    branch: null,
    worktree_path: null,
    ownership: null,
    dod_spec: null,
    pid: null,
    created_at: '2026-04-26',
    started_at: null,
    completed_at: null,
    summary: null,
    exit_reason: null,
    context: '{}',
    ...overrides,
  };
}

function makeDelivery(overrides: Partial<DeliveryRecord>): DeliveryRecord {
  return {
    agent_id: 'a1',
    task_id: 'VNM-01.01',
    branch: 'agent/foo',
    status: 'pr-open',
    pr_number: null,
    pr_url: null,
    pr_merged_at: null,
    delivered_at: null,
    retry_count: 0,
    session_id: null,
    review_tier: null,
    review_score: null,
    fix_attempts: 0,
    review_agent_id: null,
    stall_reason: null,
    human_signal: null,
    created_at: '2026-04-26',
    updated_at: '2026-04-26',
    ...overrides,
  };
}

function makeService(deliveries: DeliveryRecord[] = []): BrainServiceClass {
  const prepare = vi.fn((sql: string) => {
    if (sql.includes('FROM delivery_states')) {
      return { all: () => deliveries } as unknown as ReturnType<typeof vi.fn>;
    }
    if (sql.includes("type = 'workstream'")) {
      return {
        all: () => [
          {
            metadata: JSON.stringify({
              project: 'VNM',
              display_id: 'VNM-01',
              title: 'Workstream 01',
            }),
          },
        ],
      } as unknown as ReturnType<typeof vi.fn>;
    }
    return { all: () => [] } as unknown as ReturnType<typeof vi.fn>;
  });
  return {
    db: { rawDb: { prepare } },
  } as unknown as BrainServiceClass;
}

describe('triageDispatch', () => {
  beforeEach(() => {
    mockResolveProject.mockReturnValue({ ok: true, data: 'VNM' });
    mockGetWorktreeAllocations.mockReturnValue([] as WorktreeAllocation[]);
    mockComputeEligible.mockReturnValue([]);
    mockListAgents.mockReturnValue([]);
    mockListTasks.mockReturnValue({ ok: true, data: [] });
  });

  it('classifies pending tasks with no deps as ready', () => {
    mockListTasks.mockReturnValue({
      ok: true,
      data: [makeTask({ display_id: 'VNM-01.01', status: 'pending', depends_on: [] })],
    });

    const result = triageDispatch(makeService());

    expect(result.totals.ready).toBe(1);
    expect(result.workstreams[0].tasks[0].classification).toBe('ready');
  });

  it('classifies pending tasks with incomplete deps as blocked', () => {
    mockListTasks.mockReturnValue({
      ok: true,
      data: [
        makeTask({ display_id: 'VNM-01.01', status: 'done' }),
        makeTask({
          display_id: 'VNM-01.02',
          number: 2,
          status: 'pending',
          depends_on: ['VNM-01.01', 'VNM-01.03'],
        }),
        makeTask({ display_id: 'VNM-01.03', number: 3, status: 'pending' }),
      ],
    });

    const result = triageDispatch(makeService());
    const blocked = result.workstreams[0].tasks.find((t) => t.displayId === 'VNM-01.02')!;

    expect(blocked.classification).toBe('blocked');
    expect(blocked.incompleteDeps).toEqual(['VNM-01.03']);
    expect(result.totals.blocked).toBe(1);
  });

  it('classifies in-progress task with conflicted delivery as stuck/pr-conflict', () => {
    mockListTasks.mockReturnValue({
      ok: true,
      data: [makeTask({ display_id: 'VNM-01.01', status: 'in-progress' })],
    });

    const svc = makeService([
      makeDelivery({ task_id: 'VNM-01.01', status: 'conflicted', pr_number: 42 }),
    ]);
    const result = triageDispatch(svc);
    const view = result.workstreams[0].tasks[0];

    expect(view.classification).toBe('stuck');
    expect(view.stuckKind).toBe('pr-conflict');
    expect(view.delivery?.prNumber).toBe(42);
  });

  it('classifies in-progress task with review-paused delivery as stuck/review-pending', () => {
    mockListTasks.mockReturnValue({
      ok: true,
      data: [makeTask({ display_id: 'VNM-01.01', status: 'in-progress' })],
    });
    const svc = makeService([makeDelivery({ task_id: 'VNM-01.01', status: 'review-paused' })]);

    const result = triageDispatch(svc);
    expect(result.workstreams[0].tasks[0].stuckKind).toBe('review-pending');
  });

  it('classifies in-progress task with stalled delivery as stuck/merge-blocked', () => {
    mockListTasks.mockReturnValue({
      ok: true,
      data: [makeTask({ display_id: 'VNM-01.01', status: 'in-progress' })],
    });
    const svc = makeService([
      makeDelivery({ task_id: 'VNM-01.01', status: 'stalled', stall_reason: 'CI hung' }),
    ]);

    const result = triageDispatch(svc);
    const view = result.workstreams[0].tasks[0];
    expect(view.stuckKind).toBe('merge-blocked');
    expect(view.reason).toBe('CI hung');
  });

  it('classifies in-progress task with healthy pr-open delivery as in_flight', () => {
    mockListTasks.mockReturnValue({
      ok: true,
      data: [makeTask({ display_id: 'VNM-01.01', status: 'in-progress' })],
    });
    const svc = makeService([
      makeDelivery({ task_id: 'VNM-01.01', status: 'pr-open', pr_number: 99 }),
    ]);

    const result = triageDispatch(svc);
    const view = result.workstreams[0].tasks[0];
    expect(view.classification).toBe('in_flight');
    expect(view.delivery?.status).toBe('pr-open');
  });

  it('classifies in-progress task with no agent and no delivery as stuck/orphan', () => {
    mockListTasks.mockReturnValue({
      ok: true,
      data: [makeTask({ display_id: 'VNM-01.01', status: 'in-progress' })],
    });

    const result = triageDispatch(makeService());
    const view = result.workstreams[0].tasks[0];
    expect(view.classification).toBe('stuck');
    expect(view.stuckKind).toBe('orphan');
  });

  it('marks ready tasks as capacity_limited when wipLimit is reached', () => {
    mockListTasks.mockReturnValue({
      ok: true,
      data: [makeTask({ display_id: 'VNM-01.01', status: 'pending' })],
    });
    mockListAgents.mockReturnValue([
      makeAgent({ id: 'a1', status: 'active', brain_task: 'VNM-01.05' }),
      makeAgent({ id: 'a2', status: 'active', brain_task: 'VNM-01.06' }),
      makeAgent({ id: 'a3', status: 'active', brain_task: 'VNM-01.07' }),
    ]);

    const result = triageDispatch(makeService(), { wipLimit: 3 });

    expect(result.wip.activeAgents).toBe(3);
    expect(result.wip.atCapacity).toBe(true);
    expect(result.workstreams[0].tasks[0].classification).toBe('capacity_limited');
  });

  it('attaches agent and worktree records to the task view', () => {
    mockListTasks.mockReturnValue({
      ok: true,
      data: [makeTask({ display_id: 'VNM-01.01', status: 'in-progress' })],
    });
    mockListAgents.mockReturnValue([
      makeAgent({ id: 'a1', status: 'active', branch: 'agent/foo', pid: null }),
    ]);
    mockGetWorktreeAllocations.mockReturnValue([
      {
        id: 1,
        task_id: 'VNM-01.01',
        workstream: 'VNM-01',
        worktree_path: '/tmp/wt',
        branch: 'agent/foo',
        claim_token: null,
        created_at: '2026-04-26',
      },
    ] as WorktreeAllocation[]);

    const result = triageDispatch(makeService());
    const view = result.workstreams[0].tasks[0];

    expect(view.agent?.id).toBe('a1');
    expect(view.worktree?.path).toBe('/tmp/wt');
  });

  it('filters by workstream when provided', () => {
    mockListTasks.mockReturnValue({
      ok: true,
      data: [
        makeTask({ display_id: 'VNM-01.01', workstream: 1, status: 'pending' }),
        makeTask({ display_id: 'VNM-02.01', workstream: 2, number: 1, status: 'pending' }),
      ],
    });

    const result = triageDispatch(makeService(), { workstream: 'VNM-02' });

    expect(result.workstreams).toHaveLength(1);
    expect(result.workstreams[0].workstream).toBe('VNM-02');
    expect(result.totals.ready).toBe(1);
  });

  it('skips done, cancelled, and pruned tasks', () => {
    mockListTasks.mockReturnValue({
      ok: true,
      data: [
        makeTask({ display_id: 'VNM-01.01', status: 'done' }),
        makeTask({ display_id: 'VNM-01.02', number: 2, status: 'cancelled' }),
        makeTask({ display_id: 'VNM-01.03', number: 3, status: 'pruned' }),
        makeTask({ display_id: 'VNM-01.04', number: 4, status: 'pending' }),
      ],
    });

    const result = triageDispatch(makeService());
    expect(result.workstreams[0].tasks).toHaveLength(1);
    expect(result.workstreams[0].tasks[0].displayId).toBe('VNM-01.04');
  });

  it('groups tasks by workstream with per-classification counts', () => {
    mockListTasks.mockReturnValue({
      ok: true,
      data: [
        makeTask({ display_id: 'VNM-01.01', status: 'pending' }),
        makeTask({ display_id: 'VNM-01.02', number: 2, status: 'pending' }),
        makeTask({
          display_id: 'VNM-02.01',
          workstream: 2,
          number: 1,
          status: 'pending',
          depends_on: ['NONEXISTENT'],
        }),
      ],
    });

    const result = triageDispatch(makeService());

    expect(result.workstreams).toHaveLength(2);
    const ws01 = result.workstreams.find((w) => w.workstream === 'VNM-01')!;
    expect(ws01.counts.ready).toBe(2);
    const ws02 = result.workstreams.find((w) => w.workstream === 'VNM-02')!;
    expect(ws02.counts.blocked).toBe(1);
  });

  it('throws when project resolution fails', () => {
    mockResolveProject.mockReturnValue({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'No project found' },
    });

    expect(() => triageDispatch(makeService(), { prefix: 'XXX' })).toThrow('No project found');
  });
});
