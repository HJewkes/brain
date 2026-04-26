import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DeliveryRecord } from '../../../src/modules/agents/delivery.js';

// Mock all external dependencies
vi.mock('../../../src/utils/db.js', () => ({
  getRawDb: vi.fn((db: unknown) => {
    if (db && typeof db === 'object' && 'rawDb' in db) return (db as Record<string, unknown>).rawDb;
    return db;
  }),
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../src/modules/agents/auto-merge.js', () => ({
  getPrForBranch: vi.fn(),
  mergePr: vi.fn(),
  rerunPrChecks: vi.fn(() => false),
}));

vi.mock('../../../src/modules/agents/rebase-isolation.js', () => ({
  rebaseInIsolationDetailed: vi.fn(),
}));

vi.mock('../../../src/modules/agents/fix-agent.js', () => ({
  spawnFixAgent: vi.fn(),
}));

vi.mock('../../../src/modules/agents/delivery.js', () => ({
  updateDeliveryStatus: vi.fn(),
}));

import { monitorDelivery } from '../../../src/modules/agents/delivery-monitor.js';
import { getPrForBranch, mergePr, rerunPrChecks } from '../../../src/modules/agents/auto-merge.js';
import { rebaseInIsolationDetailed } from '../../../src/modules/agents/rebase-isolation.js';
import { spawnFixAgent } from '../../../src/modules/agents/fix-agent.js';
import { updateDeliveryStatus } from '../../../src/modules/agents/delivery.js';

const mockGetPr = getPrForBranch as ReturnType<typeof vi.fn>;
const mockMergePr = mergePr as ReturnType<typeof vi.fn>;
const mockRebaseDetailed = rebaseInIsolationDetailed as ReturnType<typeof vi.fn>;
const mockFixAgent = spawnFixAgent as ReturnType<typeof vi.fn>;
const mockUpdateStatus = updateDeliveryStatus as ReturnType<typeof vi.fn>;
const mockRerun = rerunPrChecks as ReturnType<typeof vi.fn>;

function makeDelivery(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    agent_id: 'agent-1',
    task_id: 'VNM-48.101',
    branch: 'agent/vnm-48/VNM-48.101',
    status: 'pr-open',
    pr_number: 42,
    pr_url: 'https://github.com/test/repo/pull/42',
    pr_merged_at: null,
    delivered_at: null,
    retry_count: 0,
    session_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

interface PreparedQuery {
  sql: string;
  getArgs: unknown[][];
  runArgs: unknown[][];
}

interface DbMock {
  prepare: ReturnType<typeof vi.fn>;
  queries: PreparedQuery[];
  fixAttemptsInDb: number;
}

// Minimal better-sqlite3 shim: supports prepare().get() for fix_attempts reads
// and prepare().run() for fix_attempts writes. Records every SQL executed so
// tests can assert persistence. stall_reason is now written via the mocked
// updateDeliveryStatus call, not a direct prepare().
function makeDbMock(initialFixAttempts = 0): DbMock {
  const mock: DbMock = {
    prepare: vi.fn(),
    queries: [],
    fixAttemptsInDb: initialFixAttempts,
  };
  mock.prepare = vi.fn((sql: string) => {
    const entry: PreparedQuery = { sql, getArgs: [], runArgs: [] };
    mock.queries.push(entry);
    return {
      get: vi.fn((...args: unknown[]) => {
        entry.getArgs.push(args);
        if (sql.includes('SELECT fix_attempts')) {
          return { fix_attempts: mock.fixAttemptsInDb };
        }
        return undefined;
      }),
      run: vi.fn((...args: unknown[]) => {
        entry.runArgs.push(args);
        if (sql.includes('UPDATE delivery_states') && sql.includes('SET fix_attempts')) {
          mock.fixAttemptsInDb = args[0] as number;
        }
      }),
    };
  });
  return mock;
}

function findQueries(db: DbMock, needle: string): PreparedQuery[] {
  return db.queries.filter((q) => q.sql.includes(needle));
}

const projectDir = '/tmp/test-project';

describe('monitorDelivery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns stalled with pr-missing reason when delivery has no branch', async () => {
    const db = makeDbMock();
    const delivery = makeDelivery({ branch: null });
    const result = await monitorDelivery(db as unknown as object, delivery, projectDir);
    expect(result).toBe('stalled');
    expect(mockUpdateStatus).toHaveBeenCalledWith(db, 'agent-1', 'stalled', {
      stall_reason: 'pr-missing',
    });
  });

  it('returns stalled with pr-missing reason when delivery has no pr_number', async () => {
    const db = makeDbMock();
    const delivery = makeDelivery({ pr_number: null });
    const result = await monitorDelivery(db as unknown as object, delivery, projectDir);
    expect(result).toBe('stalled');
    expect(mockUpdateStatus).toHaveBeenCalledWith(db, 'agent-1', 'stalled', {
      stall_reason: 'pr-missing',
    });
  });

  it('returns merged when PR is already merged externally', async () => {
    const db = makeDbMock();
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'agent/vnm-48/VNM-48.101',
      checksPass: true,
      mergeable: true,
      state: 'merged',
    });

    const result = await monitorDelivery(db as unknown as object, makeDelivery(), projectDir);
    expect(result).toBe('merged');
    expect(mockUpdateStatus).toHaveBeenCalledWith(
      db,
      'agent-1',
      'merged',
      expect.objectContaining({ pr_merged_at: expect.any(String) })
    );
    expect(mockUpdateStatus).toHaveBeenCalledWith(
      db,
      'agent-1',
      'delivered',
      expect.objectContaining({ delivered_at: expect.any(String) })
    );
  });

  it('returns stalled with pr-closed reason when PR is closed without merge', async () => {
    const db = makeDbMock();
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'agent/vnm-48/VNM-48.101',
      checksPass: false,
      mergeable: false,
      state: 'closed',
    });

    const result = await monitorDelivery(db as unknown as object, makeDelivery(), projectDir);
    expect(result).toBe('stalled');
    expect(mockUpdateStatus).toHaveBeenCalledWith(db, 'agent-1', 'stalled', {
      stall_reason: 'pr-closed',
    });
  });

  it('merges when CI green and PR is mergeable', async () => {
    const db = makeDbMock();
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'agent/vnm-48/VNM-48.101',
      checksPass: true,
      mergeable: true,
      state: 'open',
    });
    mockMergePr.mockReturnValueOnce({ merged: true, taskId: 'VNM-48.101', prNumber: 42 });

    const result = await monitorDelivery(db as unknown as object, makeDelivery(), projectDir);
    expect(result).toBe('merged');
    expect(mockMergePr).toHaveBeenCalledWith(42, { projectDir });
  });

  it('retries when merge fails then succeeds on next poll', async () => {
    const db = makeDbMock();
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: true,
      mergeable: true,
      state: 'open',
    });
    mockMergePr.mockReturnValueOnce({ merged: false });
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: true,
      mergeable: true,
      state: 'merged',
    });

    const result = await monitorDelivery(db as unknown as object, makeDelivery(), projectDir);
    expect(result).toBe('merged');
    expect(mockMergePr).toHaveBeenCalledTimes(1);
  });

  it('escalates conflict: rebase succeeds → continues to merge', async () => {
    const db = makeDbMock();
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: true,
      mergeable: false,
      state: 'open',
    });
    mockRebaseDetailed.mockResolvedValueOnce({ ok: true });
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: true,
      mergeable: true,
      state: 'open',
    });
    mockMergePr.mockReturnValueOnce({ merged: true, taskId: 't', prNumber: 42 });

    const result = await monitorDelivery(db as unknown as object, makeDelivery(), projectDir);
    expect(result).toBe('merged');
    expect(mockRebaseDetailed).toHaveBeenCalledTimes(1);
  });

  it('escalates conflict: rebase fails → fix agent succeeds → merge, persists fix_attempts', async () => {
    const db = makeDbMock();
    const brainDb = { rawDb: db } as unknown;
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: true,
      mergeable: false,
      state: 'open',
    });
    mockRebaseDetailed.mockResolvedValueOnce({
      ok: false,
      reason: 'conflict',
      detail: 'content conflict',
    });
    mockFixAgent.mockResolvedValueOnce(true);
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: true,
      mergeable: true,
      state: 'open',
    });
    mockMergePr.mockReturnValueOnce({ merged: true, taskId: 't', prNumber: 42 });

    const result = await monitorDelivery(brainDb, makeDelivery(), projectDir);
    expect(result).toBe('merged');
    expect(mockFixAgent).toHaveBeenCalledTimes(1);
    const attemptWrites = findQueries(db, 'SET fix_attempts');
    expect(attemptWrites).toHaveLength(1);
    expect(attemptWrites[0].runArgs[0][0]).toBe(1);
  });

  it('escalates conflict: rebase fails, fix fails → redispatched', async () => {
    const db = makeDbMock();
    const brainDb = { rawDb: db } as unknown;
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: true,
      mergeable: false,
      state: 'open',
    });
    mockRebaseDetailed.mockResolvedValueOnce({
      ok: false,
      reason: 'conflict',
      detail: 'content conflict',
    });
    mockFixAgent.mockResolvedValueOnce(false);

    const result = await monitorDelivery(brainDb, makeDelivery(), projectDir);
    expect(result).toBe('redispatched');
    expect(mockUpdateStatus).toHaveBeenCalledWith(db, 'agent-1', 'redispatched');
  });

  it('skips fix agent when db is raw (not BrainDB) and redispatches directly', async () => {
    const db = makeDbMock();
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: true,
      mergeable: false,
      state: 'open',
    });
    mockRebaseDetailed.mockResolvedValueOnce({
      ok: false,
      reason: 'conflict',
      detail: 'content conflict',
    });

    const result = await monitorDelivery(db as unknown as object, makeDelivery(), projectDir);
    expect(result).toBe('redispatched');
    expect(mockFixAgent).not.toHaveBeenCalled();
  });

  it('CI failure: fix agent succeeds → continues to merge', async () => {
    const db = makeDbMock();
    const brainDb = { rawDb: db } as unknown;
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: false,
      mergeable: true,
      state: 'open',
    });
    mockFixAgent.mockResolvedValueOnce(true);
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: true,
      mergeable: true,
      state: 'open',
    });
    mockMergePr.mockReturnValueOnce({ merged: true, taskId: 't', prNumber: 42 });

    const result = await monitorDelivery(brainDb, makeDelivery(), projectDir);
    expect(result).toBe('merged');
    expect(mockFixAgent).toHaveBeenCalledTimes(1);
  });

  it('CI failure: fix agent fails → redispatched', async () => {
    const db = makeDbMock();
    const brainDb = { rawDb: db } as unknown;
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: false,
      mergeable: true,
      state: 'open',
    });
    mockFixAgent.mockResolvedValueOnce(false);

    const result = await monitorDelivery(brainDb, makeDelivery(), projectDir);
    expect(result).toBe('redispatched');
  });

  it('respects MAX_FIX_ATTEMPTS (3) before redispatching and persists each increment', async () => {
    const db = makeDbMock();
    const brainDb = { rawDb: db } as unknown;
    const delivery = makeDelivery();

    for (let i = 0; i < 3; i++) {
      mockGetPr.mockReturnValueOnce({
        number: 42,
        branch: 'b',
        checksPass: false,
        mergeable: true,
        state: 'open',
      });
      mockFixAgent.mockResolvedValueOnce(true);
    }
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: false,
      mergeable: true,
      state: 'open',
    });

    const result = await monitorDelivery(brainDb, delivery, projectDir);
    expect(result).toBe('redispatched');
    expect(mockFixAgent).toHaveBeenCalledTimes(3);
    const attemptWrites = findQueries(db, 'SET fix_attempts');
    expect(attemptWrites).toHaveLength(3);
    expect(attemptWrites.map((q) => q.runArgs[0][0])).toEqual([1, 2, 3]);
  });

  it('resumes fix_attempts from DB so prior runs count toward the cap', async () => {
    // Simulate a restart where 2 fix attempts were already persisted.
    const db = makeDbMock(2);
    const brainDb = { rawDb: db } as unknown;
    const delivery = makeDelivery();

    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: false,
      mergeable: true,
      state: 'open',
    });
    mockFixAgent.mockResolvedValueOnce(true);
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: false,
      mergeable: true,
      state: 'open',
    });

    const result = await monitorDelivery(brainDb, delivery, projectDir);
    expect(result).toBe('redispatched');
    expect(mockFixAgent).toHaveBeenCalledTimes(1);
    const attemptWrites = findQueries(db, 'SET fix_attempts');
    expect(attemptWrites).toHaveLength(1);
    expect(attemptWrites[0].runArgs[0][0]).toBe(3);
  });

  it('stalls with pr-missing when PR disappears and stale timeout elapses', async () => {
    const db = makeDbMock();
    const delivery = makeDelivery();
    const now = Date.now();

    mockGetPr.mockReturnValueOnce(null);
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(now) // startedAt
      .mockReturnValueOnce(now + 1000) // first check — within timeout
      .mockReturnValueOnce(now + 3 * 60 * 60 * 1000); // second check — past timeout
    mockGetPr.mockReturnValueOnce(null);

    const result = await monitorDelivery(db as unknown as object, delivery, projectDir);
    expect(result).toBe('stalled');
    expect(mockUpdateStatus).toHaveBeenCalledWith(db, 'agent-1', 'stalled', {
      stall_reason: 'pr-missing',
    });
  });

  it('CI failure: reruns failed checks once before escalating to fix agent', async () => {
    const db = makeDbMock();
    const brainDb = { rawDb: db } as unknown;
    // First poll: CI failed → trigger rerun
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: false,
      mergeable: true,
      state: 'open',
      failedChecks: ['workflow-mcp.test.ts'],
    });
    mockRerun.mockReturnValueOnce(true);
    // Second poll: CI still failed → fix agent called this time
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: false,
      mergeable: true,
      state: 'open',
      failedChecks: ['workflow-mcp.test.ts'],
    });
    mockFixAgent.mockResolvedValueOnce(true);
    // Third poll: green
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: true,
      mergeable: true,
      state: 'open',
      failedChecks: [],
    });
    mockMergePr.mockReturnValueOnce({ merged: true, taskId: 't', prNumber: 42 });

    const result = await monitorDelivery(brainDb, makeDelivery(), projectDir);
    expect(result).toBe('merged');
    expect(mockRerun).toHaveBeenCalledTimes(1);
    expect(mockRerun).toHaveBeenCalledWith('agent/vnm-48/VNM-48.101', projectDir);
    expect(mockFixAgent).toHaveBeenCalledTimes(1);
  });

  it('CI failure: skips rerun if rerunPrChecks returns false and escalates directly', async () => {
    const db = makeDbMock();
    const brainDb = { rawDb: db } as unknown;
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: false,
      mergeable: true,
      state: 'open',
      failedChecks: ['some-test'],
    });
    mockRerun.mockReturnValueOnce(false);
    mockFixAgent.mockResolvedValueOnce(false);

    const result = await monitorDelivery(brainDb, makeDelivery(), projectDir);
    expect(result).toBe('redispatched');
    expect(mockFixAgent).toHaveBeenCalledTimes(1);
  });

  it('CI failure: only retries once per monitor run even if checks fail again', async () => {
    const db = makeDbMock();
    const brainDb = { rawDb: db } as unknown;
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: false,
      mergeable: true,
      state: 'open',
      failedChecks: ['t'],
    });
    mockRerun.mockReturnValueOnce(true);
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'b',
      checksPass: false,
      mergeable: true,
      state: 'open',
      failedChecks: ['t'],
    });
    mockRerun.mockReturnValueOnce(true); // should NOT be called
    mockFixAgent.mockResolvedValueOnce(false);

    const result = await monitorDelivery(brainDb, makeDelivery(), projectDir);
    expect(result).toBe('redispatched');
    expect(mockRerun).toHaveBeenCalledTimes(1);
  });
});

describe('loadFlakyTests', () => {
  it('returns flaky test list from ao.config.json delivery.flakyTests', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { loadFlakyTests } = await import('../../../src/modules/agents/delivery-monitor.js');

    const dir = mkdtempSync(join(tmpdir(), 'flaky-'));
    try {
      writeFileSync(
        join(dir, 'ao.config.json'),
        JSON.stringify({ delivery: { flakyTests: ['workflow-mcp.test.ts', 'other'] } })
      );
      expect(loadFlakyTests(dir)).toEqual(['workflow-mcp.test.ts', 'other']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty list when ao.config.json is missing', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { loadFlakyTests } = await import('../../../src/modules/agents/delivery-monitor.js');

    const dir = mkdtempSync(join(tmpdir(), 'flaky-'));
    try {
      expect(loadFlakyTests(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty list when delivery.flakyTests is absent', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { loadFlakyTests } = await import('../../../src/modules/agents/delivery-monitor.js');

    const dir = mkdtempSync(join(tmpdir(), 'flaky-'));
    try {
      writeFileSync(join(dir, 'ao.config.json'), JSON.stringify({ enforcement: {} }));
      expect(loadFlakyTests(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
