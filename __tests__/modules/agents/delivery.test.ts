import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/utils/db.js', () => ({
  getRawDb: vi.fn((db: unknown) => db),
  sleep: vi.fn(() => Promise.resolve()),
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { sleep } from '../../../src/utils/db.js';
import { initiateDelivery } from '../../../src/modules/agents/delivery.js';

const mockExec = execFileSync as ReturnType<typeof vi.fn>;
const mockSleep = sleep as ReturnType<typeof vi.fn>;

function makeFakeDb() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    prepare: vi.fn((sql: string) => ({
      get: vi.fn((agentId: string) => rows.get(agentId)),
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT INTO delivery_states')) {
          const [agentId] = args as [string, ...unknown[]];
          const status = args[3] as string;
          rows.set(agentId, { agent_id: agentId, status });
        } else if (sql.includes('UPDATE delivery_states')) {
          const agentId = args[args.length - 1] as string;
          const existing = rows.get(agentId) ?? { agent_id: agentId };
          rows.set(agentId, { ...existing, status: args[0] });
        }
      }),
    })),
    _rows: rows,
  } as unknown as Parameters<typeof initiateDelivery>[0] & {
    _rows: Map<string, Record<string, unknown>>;
  };
}

describe('initiateDelivery push retry', () => {
  beforeEach(() => {
    mockExec.mockReset();
    mockSleep.mockClear();
  });

  afterEach(() => vi.restoreAllMocks());

  it('retries push up to 3 times with exponential backoff', async () => {
    const db = makeFakeDb();

    // gh auth status OK, push fails twice then succeeds, pr view + create
    mockExec.mockImplementation((bin: string, args: string[]) => {
      if (bin === 'gh' && args[0] === 'auth') return Buffer.from('');
      if (bin === 'git' && args[0] === 'push') {
        const callCount = mockExec.mock.calls.filter(
          (c) => c[0] === 'git' && (c[1] as string[])[0] === 'push'
        ).length;
        if (callCount < 3) throw new Error('push failed');
        return Buffer.from('');
      }
      if (bin === 'gh' && args[0] === 'pr' && args[1] === 'view') {
        throw new Error('no existing pr');
      }
      if (bin === 'gh' && args[0] === 'pr' && args[1] === 'create') {
        return 'https://github.com/test/repo/pull/7';
      }
      return Buffer.from('');
    });

    await initiateDelivery(db, 'agent-1', 'VNM-1.1', 'branch-a', '/tmp/proj');

    const pushCalls = mockExec.mock.calls.filter(
      (c) => c[0] === 'git' && (c[1] as string[])[0] === 'push'
    );
    expect(pushCalls).toHaveLength(3);
    expect(mockSleep).toHaveBeenCalledWith(2_000);
    expect(mockSleep).toHaveBeenCalledWith(4_000);
    expect(mockSleep).toHaveBeenCalledTimes(2);
    expect(db._rows.get('agent-1')?.status).toBe('pr-open');
  });

  it('records push-failed after exhausting retries', async () => {
    const db = makeFakeDb();

    mockExec.mockImplementation((bin: string, args: string[]) => {
      if (bin === 'gh' && args[0] === 'auth') return Buffer.from('');
      if (bin === 'git' && args[0] === 'push') throw new Error('push failed');
      return Buffer.from('');
    });

    await expect(
      initiateDelivery(db, 'agent-1', 'VNM-1.1', 'branch-a', '/tmp/proj')
    ).rejects.toThrow('push failed');

    const pushCalls = mockExec.mock.calls.filter(
      (c) => c[0] === 'git' && (c[1] as string[])[0] === 'push'
    );
    expect(pushCalls).toHaveLength(3);
    // Sleeps only between attempts — not after the final failure
    expect(mockSleep).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledWith(2_000);
    expect(mockSleep).toHaveBeenCalledWith(4_000);
    expect(db._rows.get('agent-1')?.status).toBe('push-failed');
  });

  it('succeeds on first attempt without sleeping', async () => {
    const db = makeFakeDb();

    mockExec.mockImplementation((bin: string, args: string[]) => {
      if (bin === 'gh' && args[0] === 'auth') return Buffer.from('');
      if (bin === 'git' && args[0] === 'push') return Buffer.from('');
      if (bin === 'gh' && args[0] === 'pr' && args[1] === 'view') {
        throw new Error('no existing pr');
      }
      if (bin === 'gh' && args[0] === 'pr' && args[1] === 'create') {
        return 'https://github.com/test/repo/pull/7';
      }
      return Buffer.from('');
    });

    await initiateDelivery(db, 'agent-1', 'VNM-1.1', 'branch-a', '/tmp/proj');

    const pushCalls = mockExec.mock.calls.filter(
      (c) => c[0] === 'git' && (c[1] as string[])[0] === 'push'
    );
    expect(pushCalls).toHaveLength(1);
    expect(mockSleep).not.toHaveBeenCalled();
  });
});

describe('initiateDelivery auto-merge', () => {
  beforeEach(() => {
    mockExec.mockReset();
    mockSleep.mockClear();
  });

  afterEach(() => vi.restoreAllMocks());

  it('arms auto-merge with --squash after PR creation', async () => {
    const db = makeFakeDb();

    mockExec.mockImplementation((bin: string, args: string[]) => {
      if (bin === 'gh' && args[0] === 'auth') return Buffer.from('');
      if (bin === 'git' && args[0] === 'push') return Buffer.from('');
      if (bin === 'gh' && args[0] === 'pr' && args[1] === 'view') {
        throw new Error('no existing pr');
      }
      if (bin === 'gh' && args[0] === 'pr' && args[1] === 'create') {
        return 'https://github.com/test/repo/pull/42';
      }
      if (bin === 'gh' && args[0] === 'pr' && args[1] === 'merge') {
        return Buffer.from('');
      }
      return Buffer.from('');
    });

    await initiateDelivery(db, 'agent-1', 'VNM-1.1', 'branch-a', '/tmp/proj');

    const mergeCalls = mockExec.mock.calls.filter(
      (c) => c[0] === 'gh' && (c[1] as string[])[0] === 'pr' && (c[1] as string[])[1] === 'merge'
    );
    expect(mergeCalls).toHaveLength(1);
    expect(mergeCalls[0][1]).toEqual(['pr', 'merge', '42', '--auto', '--squash']);
    expect(db._rows.get('agent-1')?.status).toBe('pr-open');
  });

  it('does not fail delivery when auto-merge arming fails', async () => {
    const db = makeFakeDb();

    mockExec.mockImplementation((bin: string, args: string[]) => {
      if (bin === 'gh' && args[0] === 'auth') return Buffer.from('');
      if (bin === 'git' && args[0] === 'push') return Buffer.from('');
      if (bin === 'gh' && args[0] === 'pr' && args[1] === 'view') {
        throw new Error('no existing pr');
      }
      if (bin === 'gh' && args[0] === 'pr' && args[1] === 'create') {
        return 'https://github.com/test/repo/pull/42';
      }
      if (bin === 'gh' && args[0] === 'pr' && args[1] === 'merge') {
        throw new Error('auto-merge not available');
      }
      return Buffer.from('');
    });

    const delivery = await initiateDelivery(db, 'agent-1', 'VNM-1.1', 'branch-a', '/tmp/proj');

    expect(delivery.status).toBe('pr-open');
    expect(db._rows.get('agent-1')?.status).toBe('pr-open');
  });
});
