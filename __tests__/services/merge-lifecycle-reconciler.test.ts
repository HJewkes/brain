import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeliveryRecord } from '../../src/modules/agents/delivery.js';
import type { PrStatus } from '../../src/modules/agents/auto-merge.js';

vi.mock('../../src/utils/db.js', () => ({
  getRawDb: vi.fn((db: unknown) => {
    if (db && typeof db === 'object' && 'rawDb' in db) return (db as Record<string, unknown>).rawDb;
    return db;
  }),
}));

vi.mock('../../src/modules/agents/auto-merge.js', () => ({
  getPrForBranch: vi.fn(),
  rerunPrChecks: vi.fn(),
}));

vi.mock('../../src/modules/agents/rebase-isolation.js', () => ({
  rebaseInIsolationDetailed: vi.fn(),
}));

vi.mock('../../src/modules/agents/worktree.js', () => ({
  reclaimTerminatedAllocations: vi.fn(() => []),
}));

vi.mock('../../src/modules/agents/delivery.js', () => ({
  enableAutoMerge: vi.fn(),
  updateDeliveryStatus: vi.fn(),
}));

vi.mock('../../src/modules/pm/data/task-ops.js', () => ({
  updateTaskStatus: vi.fn(() => Promise.resolve({ ok: true, value: {} })),
}));

vi.mock('../../src/server/orchestration.js', () => ({
  recoverBranchForAgent: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/modules/agents/delivery-monitor.js', () => ({
  loadFlakyTests: vi.fn(() => []),
}));

import {
  reconcileMergeLifecycle,
  isAutoMergeArmed,
  MergeLifecycleReconciler,
} from '../../src/services/merge-lifecycle-reconciler.js';
import { getPrForBranch, rerunPrChecks } from '../../src/modules/agents/auto-merge.js';
import { rebaseInIsolationDetailed } from '../../src/modules/agents/rebase-isolation.js';
import { reclaimTerminatedAllocations } from '../../src/modules/agents/worktree.js';
import { enableAutoMerge, updateDeliveryStatus } from '../../src/modules/agents/delivery.js';
import { recoverBranchForAgent } from '../../src/server/orchestration.js';
import { loadFlakyTests } from '../../src/modules/agents/delivery-monitor.js';
import { updateTaskStatus } from '../../src/modules/pm/data/task-ops.js';

const mockGetPr = vi.mocked(getPrForBranch);
const mockRerun = vi.mocked(rerunPrChecks);
const mockRebase = vi.mocked(rebaseInIsolationDetailed);
const mockReclaim = vi.mocked(reclaimTerminatedAllocations);
const mockArm = vi.mocked(enableAutoMerge);
const mockRecover = vi.mocked(recoverBranchForAgent);
const mockFlaky = vi.mocked(loadFlakyTests);
const mockUpdateDelivery = vi.mocked(updateDeliveryStatus);
const mockUpdateTask = vi.mocked(updateTaskStatus);

interface PreparedQuery {
  sql: string;
  bindings: unknown[][];
}

interface DbMock {
  prepare: ReturnType<typeof vi.fn>;
  queries: PreparedQuery[];
  deliveries: DeliveryRecord[];
  orphanRows: { id: string; brain_task: string; branch: string }[];
}

function makeDelivery(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    agent_id: 'agent-1',
    task_id: 'VNM-1.1',
    branch: 'agent/vnm-1/VNM-1.1',
    status: 'pr-open',
    pr_number: 42,
    pr_url: 'https://github.com/x/y/pull/42',
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
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function makePr(overrides: Partial<PrStatus> = {}): PrStatus {
  return {
    number: 42,
    branch: 'agent/vnm-1/VNM-1.1',
    checksPass: true,
    mergeable: true,
    state: 'open',
    failedChecks: [],
    ...overrides,
  };
}

function makeDbMock(deliveries: DeliveryRecord[], orphanRows: DbMock['orphanRows'] = []): DbMock {
  const mock: DbMock = {
    prepare: vi.fn(),
    queries: [],
    deliveries,
    orphanRows,
  };
  mock.prepare = vi.fn((sql: string) => {
    const entry: PreparedQuery = { sql, bindings: [] };
    mock.queries.push(entry);
    return {
      all: vi.fn((...args: unknown[]) => {
        entry.bindings.push(args);
        if (sql.includes('FROM delivery_states')) return mock.deliveries;
        if (sql.includes('FROM agents')) return mock.orphanRows;
        return [];
      }),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    };
  });
  return mock;
}

const projectDir = '/tmp/test-project';

describe('reconcileMergeLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReclaim.mockReturnValue([]);
    mockFlaky.mockReturnValue([]);
  });

  it('rebases PRs whose mergeStateStatus is BEHIND', async () => {
    const db = makeDbMock([makeDelivery()]);
    mockGetPr.mockReturnValue(makePr({ mergeStateStatus: 'BEHIND', mergeable: false }));
    mockRebase.mockResolvedValue({ ok: true });

    const report = await reconcileMergeLifecycle(db as unknown as object, projectDir);

    expect(mockRebase).toHaveBeenCalledWith('agent/vnm-1/VNM-1.1', projectDir);
    expect(report.rebased).toEqual(['agent/vnm-1/VNM-1.1']);
    expect(report.errors).toEqual([]);
  });

  it('records rebase failures without throwing', async () => {
    const db = makeDbMock([makeDelivery()]);
    mockGetPr.mockReturnValue(makePr({ mergeStateStatus: 'BEHIND', mergeable: false }));
    mockRebase.mockResolvedValue({ ok: false, reason: 'conflict' });

    const report = await reconcileMergeLifecycle(db as unknown as object, projectDir);

    expect(report.rebased).toEqual([]);
    expect(report.errors).toContainEqual({
      kind: 'rebase',
      target: 'agent/vnm-1/VNM-1.1',
      reason: 'conflict',
    });
  });

  it('reruns CI when every failed check is on the flaky allowlist', async () => {
    const db = makeDbMock([makeDelivery()]);
    mockFlaky.mockReturnValue(['flaky-test']);
    mockGetPr.mockReturnValue(
      makePr({ checksPass: false, mergeable: true, failedChecks: ['flaky-test-suite'] })
    );
    mockRerun.mockReturnValue(true);

    const report = await reconcileMergeLifecycle(db as unknown as object, projectDir);

    expect(mockRerun).toHaveBeenCalledWith('agent/vnm-1/VNM-1.1', projectDir);
    expect(report.ciReruns).toEqual(['agent/vnm-1/VNM-1.1']);
  });

  it('does not rerun CI when failed checks are not all flaky', async () => {
    const db = makeDbMock([makeDelivery()]);
    mockFlaky.mockReturnValue(['flaky-test']);
    mockGetPr.mockReturnValue(
      makePr({
        checksPass: false,
        mergeable: true,
        failedChecks: ['flaky-test-suite', 'real-failure'],
      })
    );

    const report = await reconcileMergeLifecycle(db as unknown as object, projectDir);

    expect(mockRerun).not.toHaveBeenCalled();
    expect(report.ciReruns).toEqual([]);
  });

  it('skips CI rerun while branch is in cooldown', async () => {
    const db = makeDbMock([makeDelivery()]);
    mockFlaky.mockReturnValue(['flaky']);
    mockGetPr.mockReturnValue(
      makePr({ checksPass: false, mergeable: true, failedChecks: ['flaky-thing'] })
    );

    const cooldown = new Map<string, number>([['agent/vnm-1/VNM-1.1', 1_000_000]]);
    const report = await reconcileMergeLifecycle(db as unknown as object, projectDir, {
      ciRerunCooldown: cooldown,
      now: () => 1_000_000 + 5_000, // 5s later, well under 30 min
    });

    expect(mockRerun).not.toHaveBeenCalled();
    expect(report.ciReruns).toEqual([]);
  });

  it('reruns CI again after the cooldown elapses', async () => {
    const db = makeDbMock([makeDelivery()]);
    mockFlaky.mockReturnValue(['flaky']);
    mockGetPr.mockReturnValue(
      makePr({ checksPass: false, mergeable: true, failedChecks: ['flaky-thing'] })
    );
    mockRerun.mockReturnValue(true);

    const cooldown = new Map<string, number>([['agent/vnm-1/VNM-1.1', 0]]);
    const report = await reconcileMergeLifecycle(db as unknown as object, projectDir, {
      ciRerunCooldown: cooldown,
      now: () => 60 * 60 * 1000, // 1 hour later
    });

    expect(mockRerun).toHaveBeenCalledOnce();
    expect(report.ciReruns).toEqual(['agent/vnm-1/VNM-1.1']);
  });

  it('advances delivery state to merged when GH reports the PR merged', async () => {
    const db = makeDbMock([makeDelivery()]);
    mockGetPr.mockReturnValue(makePr({ state: 'merged', mergedAt: '2026-04-28T12:00:00Z' }));

    const report = await reconcileMergeLifecycle(db as unknown as object, projectDir);

    expect(mockUpdateDelivery).toHaveBeenCalledWith(db, 'agent-1', 'merged', {
      pr_merged_at: '2026-04-28T12:00:00Z',
    });
    expect(mockRebase).not.toHaveBeenCalled();
    expect(mockRerun).not.toHaveBeenCalled();
    expect(mockArm).not.toHaveBeenCalled();
    expect(report.deliveriesMerged).toEqual(['VNM-1.1']);
    expect(report.prsScanned).toBe(1);
  });

  it('advances delivery state to stalled when GH reports the PR closed without merge', async () => {
    const db = makeDbMock([makeDelivery()]);
    mockGetPr.mockReturnValue(makePr({ state: 'closed' }));

    const report = await reconcileMergeLifecycle(db as unknown as object, projectDir);

    expect(mockUpdateDelivery).toHaveBeenCalledWith(db, 'agent-1', 'stalled', {
      stall_reason: 'pr-closed',
    });
    expect(report.deliveriesClosed).toEqual(['VNM-1.1']);
    expect(report.deliveriesMerged).toEqual([]);
  });

  it('advances PM task to done when pmDeps wired and PR merged', async () => {
    const db = makeDbMock([makeDelivery()]);
    mockGetPr.mockReturnValue(makePr({ state: 'merged', mergedAt: '2026-04-28T12:00:00Z' }));
    const pmDeps = {
      brainDb: {} as never,
      config: {} as never,
      embedder: {} as never,
    };

    const report = await reconcileMergeLifecycle(db as unknown as object, projectDir, {
      pmDeps,
    });

    expect(mockUpdateTask).toHaveBeenCalledWith(
      pmDeps.brainDb,
      pmDeps.config,
      pmDeps.embedder,
      'VNM-1.1',
      'done'
    );
    expect(report.errors).toEqual([]);
  });

  it('skips PM task advance when pmDeps absent', async () => {
    const db = makeDbMock([makeDelivery()]);
    mockGetPr.mockReturnValue(makePr({ state: 'merged' }));

    await reconcileMergeLifecycle(db as unknown as object, projectDir);

    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it('falls back to ctx.now when GH does not report mergedAt', async () => {
    const db = makeDbMock([makeDelivery()]);
    mockGetPr.mockReturnValue(makePr({ state: 'merged' }));
    const fixedNow = Date.UTC(2026, 3, 28, 13, 0, 0);

    await reconcileMergeLifecycle(db as unknown as object, projectDir, {
      now: () => fixedNow,
    });

    expect(mockUpdateDelivery).toHaveBeenCalledWith(db, 'agent-1', 'merged', {
      pr_merged_at: new Date(fixedNow).toISOString(),
    });
  });

  it('reclaims terminated worktrees on every pass', async () => {
    const db = makeDbMock([]);
    mockReclaim.mockReturnValue(['VNM-9.1', 'VNM-9.2']);

    const report = await reconcileMergeLifecycle(db as unknown as object, projectDir);

    expect(mockReclaim).toHaveBeenCalledWith(db.deliveries === db.deliveries ? db : db, projectDir);
    expect(report.worktreesReclaimed).toEqual(['VNM-9.1', 'VNM-9.2']);
  });

  it('triggers branch recovery for orphan agents', async () => {
    const db = makeDbMock(
      [],
      [{ id: 'agent-99', brain_task: 'VNM-9.9', branch: 'agent/vnm-9/VNM-9.9' }]
    );

    const report = await reconcileMergeLifecycle(db as unknown as object, projectDir);

    expect(mockRecover).toHaveBeenCalledWith(db, 'agent-99', projectDir);
    expect(report.branchesRecovered).toEqual(['VNM-9.9']);
  });

  it('skips deliveries with no branch or pr_number', async () => {
    const db = makeDbMock([
      makeDelivery({ branch: null }),
      makeDelivery({ pr_number: null, agent_id: 'agent-2' }),
    ]);

    const report = await reconcileMergeLifecycle(db as unknown as object, projectDir);

    expect(mockGetPr).not.toHaveBeenCalled();
    expect(report.prsScanned).toBe(0);
  });
});

describe('MergeLifecycleReconciler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReclaim.mockReturnValue([]);
    mockFlaky.mockReturnValue([]);
    mockGetPr.mockReturnValue(null);
  });

  it('tickNow runs a pass and stores the report on `last`', async () => {
    const db = makeDbMock([]);
    const r = new MergeLifecycleReconciler(db as unknown as object, projectDir, 60_000);

    const report = await r.tickNow();

    expect(report).not.toBeNull();
    expect(r.last).toBe(report);
  });

  it('tickNow returns null when a pass is already running', async () => {
    const db = makeDbMock([]);
    const r = new MergeLifecycleReconciler(db as unknown as object, projectDir, 60_000);

    // Force concurrency: hold the worktree reclaim mock until we release it
    let release: () => void = () => {};
    mockReclaim.mockImplementationOnce(() => {
      // synchronous, but wrap recoverBranchForAgent to await
      return [];
    });
    mockRecover.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    db.orphanRows = [{ id: 'a', brain_task: 'T', branch: 'agent/x/T' }];

    const first = r.tickNow();
    const second = await r.tickNow();
    expect(second).toBeNull();
    release();
    await first;
  });

  it('stop prevents further scheduled ticks', async () => {
    const db = makeDbMock([]);
    vi.useFakeTimers();
    try {
      const r = new MergeLifecycleReconciler(db as unknown as object, projectDir, 1000);
      r.start();
      r.stop();
      vi.advanceTimersByTime(5000);
      expect(mockReclaim).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isAutoMergeArmed', () => {
  it('returns null when gh fails (treated as indeterminate)', () => {
    // gh is unlikely to be authenticated against a synthetic branch in CI; the
    // function should swallow the error and return null so the caller skips
    // arming auto-merge against unknown state.
    const result = isAutoMergeArmed('definitely-not-a-real-branch-xyz', '/tmp');
    expect(result).toBeNull();
  });
});
