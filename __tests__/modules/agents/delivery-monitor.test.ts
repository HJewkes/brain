import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DeliveryRecord } from '../../../src/modules/agents/delivery.js';

// Mock all external dependencies
vi.mock('../../../src/utils/db.js', () => ({
  getRawDb: vi.fn((db: unknown) => {
    if (db && typeof db === 'object' && 'rawDb' in db) return (db as any).rawDb;
    return db;
  }),
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../src/modules/agents/auto-merge.js', () => ({
  getPrForBranch: vi.fn(),
  mergePr: vi.fn(),
}));

vi.mock('../../../src/modules/agents/rebase-isolation.js', () => ({
  rebaseInIsolation: vi.fn(),
}));

vi.mock('../../../src/modules/agents/fix-agent.js', () => ({
  spawnFixAgent: vi.fn(),
}));

vi.mock('../../../src/modules/agents/delivery.js', () => ({
  updateDeliveryStatus: vi.fn(),
}));

import { monitorDelivery } from '../../../src/modules/agents/delivery-monitor.js';
import { getPrForBranch, mergePr } from '../../../src/modules/agents/auto-merge.js';
import { rebaseInIsolation } from '../../../src/modules/agents/rebase-isolation.js';
import { spawnFixAgent } from '../../../src/modules/agents/fix-agent.js';
import { updateDeliveryStatus } from '../../../src/modules/agents/delivery.js';

const mockGetPr = getPrForBranch as ReturnType<typeof vi.fn>;
const mockMergePr = mergePr as ReturnType<typeof vi.fn>;
const mockRebase = rebaseInIsolation as ReturnType<typeof vi.fn>;
const mockFixAgent = spawnFixAgent as ReturnType<typeof vi.fn>;
const mockUpdateStatus = updateDeliveryStatus as ReturnType<typeof vi.fn>;

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

// Use a raw object as the "db" — getRawDb mock returns it as-is
const fakeDb = {} as any;
const projectDir = '/tmp/test-project';

describe('monitorDelivery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns stalled when delivery has no branch', async () => {
    const delivery = makeDelivery({ branch: null });
    const result = await monitorDelivery(fakeDb, delivery, projectDir);
    expect(result).toBe('stalled');
    expect(mockUpdateStatus).toHaveBeenCalledWith(fakeDb, 'agent-1', 'stalled');
  });

  it('returns stalled when delivery has no pr_number', async () => {
    const delivery = makeDelivery({ pr_number: null });
    const result = await monitorDelivery(fakeDb, delivery, projectDir);
    expect(result).toBe('stalled');
    expect(mockUpdateStatus).toHaveBeenCalledWith(fakeDb, 'agent-1', 'stalled');
  });

  it('returns merged when PR is already merged externally', async () => {
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'agent/vnm-48/VNM-48.101',
      checksPass: true,
      mergeable: true,
      state: 'merged',
    });

    const result = await monitorDelivery(fakeDb, makeDelivery(), projectDir);
    expect(result).toBe('merged');
    expect(mockUpdateStatus).toHaveBeenCalledWith(fakeDb, 'agent-1', 'merged', expect.objectContaining({ pr_merged_at: expect.any(String) }));
    expect(mockUpdateStatus).toHaveBeenCalledWith(fakeDb, 'agent-1', 'delivered', expect.objectContaining({ delivered_at: expect.any(String) }));
  });

  it('returns stalled when PR is closed without merge', async () => {
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'agent/vnm-48/VNM-48.101',
      checksPass: false,
      mergeable: false,
      state: 'closed',
    });

    const result = await monitorDelivery(fakeDb, makeDelivery(), projectDir);
    expect(result).toBe('stalled');
    expect(mockUpdateStatus).toHaveBeenCalledWith(fakeDb, 'agent-1', 'stalled');
  });

  it('merges when CI green and PR is mergeable', async () => {
    mockGetPr.mockReturnValueOnce({
      number: 42,
      branch: 'agent/vnm-48/VNM-48.101',
      checksPass: true,
      mergeable: true,
      state: 'open',
    });
    mockMergePr.mockReturnValueOnce({ merged: true, taskId: 'VNM-48.101', prNumber: 42 });

    const result = await monitorDelivery(fakeDb, makeDelivery(), projectDir);
    expect(result).toBe('merged');
    expect(mockMergePr).toHaveBeenCalledWith(42, { projectDir });
  });

  it('retries when merge fails then succeeds on next poll', async () => {
    // First poll: merge fails
    mockGetPr.mockReturnValueOnce({
      number: 42, branch: 'b', checksPass: true, mergeable: true, state: 'open',
    });
    mockMergePr.mockReturnValueOnce({ merged: false });
    // Second poll: merged externally
    mockGetPr.mockReturnValueOnce({
      number: 42, branch: 'b', checksPass: true, mergeable: true, state: 'merged',
    });

    const result = await monitorDelivery(fakeDb, makeDelivery(), projectDir);
    expect(result).toBe('merged');
    expect(mockMergePr).toHaveBeenCalledTimes(1);
  });

  it('escalates conflict: rebase succeeds → continues to merge', async () => {
    // First poll: conflict
    mockGetPr.mockReturnValueOnce({
      number: 42, branch: 'b', checksPass: true, mergeable: false, state: 'open',
    });
    mockRebase.mockResolvedValueOnce(true);
    // Second poll after rebase: mergeable
    mockGetPr.mockReturnValueOnce({
      number: 42, branch: 'b', checksPass: true, mergeable: true, state: 'open',
    });
    mockMergePr.mockReturnValueOnce({ merged: true, taskId: 't', prNumber: 42 });

    const result = await monitorDelivery(fakeDb, makeDelivery(), projectDir);
    expect(result).toBe('merged');
    expect(mockRebase).toHaveBeenCalledTimes(1);
  });

  it('escalates conflict: rebase fails → fix agent succeeds → merge', async () => {
    const brainDb = { rawDb: fakeDb } as any;
    // First poll: conflict, rebase fails, fix succeeds
    mockGetPr.mockReturnValueOnce({
      number: 42, branch: 'b', checksPass: true, mergeable: false, state: 'open',
    });
    mockRebase.mockResolvedValueOnce(false);
    mockFixAgent.mockResolvedValueOnce(true);
    // Second poll: now mergeable
    mockGetPr.mockReturnValueOnce({
      number: 42, branch: 'b', checksPass: true, mergeable: true, state: 'open',
    });
    mockMergePr.mockReturnValueOnce({ merged: true, taskId: 't', prNumber: 42 });

    const result = await monitorDelivery(brainDb, makeDelivery(), projectDir);
    expect(result).toBe('merged');
    expect(mockFixAgent).toHaveBeenCalledTimes(1);
  });

  it('escalates conflict: rebase fails, fix fails → redispatched', async () => {
    const brainDb = { rawDb: fakeDb } as any;
    mockGetPr.mockReturnValueOnce({
      number: 42, branch: 'b', checksPass: true, mergeable: false, state: 'open',
    });
    mockRebase.mockResolvedValueOnce(false);
    mockFixAgent.mockResolvedValueOnce(false);

    const result = await monitorDelivery(brainDb, makeDelivery(), projectDir);
    expect(result).toBe('redispatched');
    expect(mockUpdateStatus).toHaveBeenCalledWith(fakeDb, 'agent-1', 'redispatched');
  });

  it('skips fix agent when db is raw (not BrainDB) and redispatches directly', async () => {
    mockGetPr.mockReturnValueOnce({
      number: 42, branch: 'b', checksPass: true, mergeable: false, state: 'open',
    });
    mockRebase.mockResolvedValueOnce(false);

    const result = await monitorDelivery(fakeDb, makeDelivery(), projectDir);
    expect(result).toBe('redispatched');
    expect(mockFixAgent).not.toHaveBeenCalled();
  });

  it('CI failure: fix agent succeeds → continues to merge', async () => {
    const brainDb = { rawDb: fakeDb } as any;
    // First poll: CI fails, fix agent repairs it
    mockGetPr.mockReturnValueOnce({
      number: 42, branch: 'b', checksPass: false, mergeable: true, state: 'open',
    });
    mockFixAgent.mockResolvedValueOnce(true);
    // Second poll: CI passes now
    mockGetPr.mockReturnValueOnce({
      number: 42, branch: 'b', checksPass: true, mergeable: true, state: 'open',
    });
    mockMergePr.mockReturnValueOnce({ merged: true, taskId: 't', prNumber: 42 });

    const result = await monitorDelivery(brainDb, makeDelivery(), projectDir);
    expect(result).toBe('merged');
    expect(mockFixAgent).toHaveBeenCalledTimes(1);
  });

  it('CI failure: fix agent fails → redispatched', async () => {
    const brainDb = { rawDb: fakeDb } as any;
    mockGetPr.mockReturnValueOnce({
      number: 42, branch: 'b', checksPass: false, mergeable: true, state: 'open',
    });
    mockFixAgent.mockResolvedValueOnce(false);

    const result = await monitorDelivery(brainDb, makeDelivery(), projectDir);
    expect(result).toBe('redispatched');
  });

  it('respects MAX_FIX_ATTEMPTS (3) before redispatching', async () => {
    const brainDb = { rawDb: fakeDb } as any;
    const delivery = makeDelivery();

    // 3 polls with CI failure, fix agent returns true each time (keeps trying)
    for (let i = 0; i < 3; i++) {
      mockGetPr.mockReturnValueOnce({
        number: 42, branch: 'b', checksPass: false, mergeable: true, state: 'open',
      });
      mockFixAgent.mockResolvedValueOnce(true);
    }
    // 4th poll: still failing, no more fix attempts → redispatch
    mockGetPr.mockReturnValueOnce({
      number: 42, branch: 'b', checksPass: false, mergeable: true, state: 'open',
    });

    const result = await monitorDelivery(brainDb, delivery, projectDir);
    expect(result).toBe('redispatched');
    expect(mockFixAgent).toHaveBeenCalledTimes(3);
  });

  it('stalls when PR disappears and stale timeout elapses', async () => {
    const delivery = makeDelivery();
    const now = Date.now();

    // First poll: PR not visible
    mockGetPr.mockReturnValueOnce(null);
    // Advance time past stale timeout (2 hours)
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(now) // startedAt
      .mockReturnValueOnce(now + 1000) // first check — within timeout
      .mockReturnValueOnce(now + 3 * 60 * 60 * 1000); // second check — past timeout
    // Second poll: still no PR
    mockGetPr.mockReturnValueOnce(null);

    const result = await monitorDelivery(fakeDb, delivery, projectDir);
    expect(result).toBe('stalled');
  });
});
