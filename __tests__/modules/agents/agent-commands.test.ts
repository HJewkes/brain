import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { agentsMigrationV1, agentsMigrationV2 } from '../../../src/modules/agents/schema.js';

// We use a raw better-sqlite3 Database that has the agents migration applied.
// The data.ts toRaw() helper handles both BrainDB and raw Database instances.
let db: ReturnType<typeof Database>;

const mockUpdateTaskStatus = vi.fn().mockResolvedValue({ ok: true, value: {} });

vi.mock('../../../src/modules/pm/data/task-ops.js', () => ({
  updateTaskStatus: (...args: unknown[]) => mockUpdateTaskStatus(...args),
}));

const mockSvc = () => ({
  db,
  config: { notesDir: '/tmp/test-agents', dbPath: ':memory:' },
  embedder: { embed: vi.fn() },
  instance: { root: '/tmp/test-agents', isLocal: false, source: 'test' },
  modules: {},
  close: () => {},
});

vi.mock('../../../src/services/brain-service.js', () => ({
  withDb: vi.fn(async (fn: (svc: unknown) => unknown) => fn(mockSvc())),
  withBrain: vi.fn(async (fn: (svc: unknown) => unknown) => fn(mockSvc())),
}));

import { createAgentCommands } from '../../../src/modules/agents/commands.js';

let stdoutData: string;
let stderrData: string;

async function run(...args: string[]): Promise<void> {
  const cmd = createAgentCommands();
  await cmd.parseAsync(args, { from: 'user' });
}

beforeEach(() => {
  db = new Database(':memory:');
  agentsMigrationV1.up(db);
  agentsMigrationV2.up(db);

  stdoutData = '';
  stderrData = '';
  mockUpdateTaskStatus.mockClear();
  mockUpdateTaskStatus.mockResolvedValue({ ok: true, value: {} });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutData += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrData += String(chunk);
    return true;
  });
  process.exitCode = undefined;
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

// ── register ──────────────────────────────────────────────────────────────────

describe('agent register', () => {
  it('creates an agent and prints the ID', async () => {
    await run('register', '--name', 'impl-agent');
    const id = stdoutData.trim();
    expect(id).toHaveLength(36); // UUID
    expect(stderrData).toBe('');
    expect(process.exitCode).toBeUndefined();
  });

  it('uses human as default parent', async () => {
    await run('register', '--name', 'test-agent');
    const id = stdoutData.trim();
    const row = db.prepare('SELECT parent FROM agents WHERE id = ?').get(id) as {
      parent: string;
    };
    expect(row.parent).toBe('human');
  });

  it('stores custom parent, branch, and ownership', async () => {
    await run(
      'register',
      '--name',
      'feat-agent',
      '--parent',
      'orchestrator',
      '--branch',
      'feat/vnm-09',
      '--ownership',
      'src/modules/agents/,__tests__/modules/agents/'
    );
    const id = stdoutData.trim();
    const row = db.prepare('SELECT parent, branch, ownership FROM agents WHERE id = ?').get(id) as {
      parent: string;
      branch: string;
      ownership: string;
    };
    expect(row.parent).toBe('orchestrator');
    expect(row.branch).toBe('feat/vnm-09');
    expect(JSON.parse(row.ownership)).toEqual(['src/modules/agents/', '__tests__/modules/agents/']);
  });

  it('stores brain_task and claim_token', async () => {
    await run(
      'register',
      '--name',
      'task-agent',
      '--brain-task',
      'VNM-09.08',
      '--claim-token',
      'tok-abc'
    );
    const id = stdoutData.trim();
    const row = db.prepare('SELECT brain_task, claim_token FROM agents WHERE id = ?').get(id) as {
      brain_task: string;
      claim_token: string;
    };
    expect(row.brain_task).toBe('VNM-09.08');
    expect(row.claim_token).toBe('tok-abc');
  });
});

// ── start ──────────────────────────────────────────────────────────────────────

describe('agent start', () => {
  it('transitions pending agent to active', async () => {
    await run('register', '--name', 'start-agent');
    const id = stdoutData.trim();
    stdoutData = '';

    await run('start', id);
    expect(stderrData).toBe('');
    expect(process.exitCode).toBeUndefined();

    const row = db.prepare('SELECT status, started_at, pid FROM agents WHERE id = ?').get(id) as {
      status: string;
      started_at: string;
      pid: number;
    };
    expect(row.status).toBe('active');
    expect(row.started_at).toBeTruthy();
    expect(row.pid).toBeGreaterThan(0);
  });

  it('prints agent detail after starting', async () => {
    await run('register', '--name', 'detail-agent');
    const id = stdoutData.trim();
    stdoutData = '';

    await run('start', id);
    expect(stdoutData).toContain('detail-agent');
    expect(stdoutData).toContain('active');
  });

  it('errors when agent not found', async () => {
    await run('start', 'nonexistent-id');
    expect(stderrData).toContain('not found');
    expect(process.exitCode).toBe(1);
  });

  it('errors when agent is not pending', async () => {
    await run('register', '--name', 'double-start');
    const id = stdoutData.trim();
    stdoutData = '';
    stderrData = '';

    await run('start', id);
    stderrData = '';
    process.exitCode = undefined;

    await run('start', id);
    expect(stderrData).toContain('not pending');
    expect(process.exitCode).toBe(1);
  });

  it('sets BRAIN_PM_TASK env when brain_task is present', async () => {
    await run('register', '--name', 'env-agent', '--brain-task', 'VNM-09.08');
    const id = stdoutData.trim();
    stdoutData = '';

    await run('start', id);
    expect(process.env.BRAIN_PM_TASK).toBe('VNM-09.08');

    // Cleanup
    delete process.env.BRAIN_PM_TASK;
  });
});

// ── complete ──────────────────────────────────────────────────────────────────

describe('agent complete', () => {
  it('transitions active agent to completed', async () => {
    await run('register', '--name', 'complete-agent');
    const id = stdoutData.trim();
    stdoutData = '';
    await run('start', id);
    stdoutData = '';
    stderrData = '';

    await run('complete', id, '--summary', 'All tests passed');
    expect(stderrData).toBe('');
    expect(process.exitCode).toBeUndefined();

    const row = db
      .prepare('SELECT status, completed_at, summary FROM agents WHERE id = ?')
      .get(id) as { status: string; completed_at: string; summary: string };
    expect(row.status).toBe('completed');
    expect(row.completed_at).toBeTruthy();
    expect(row.summary).toBe('All tests passed');
  });

  it('prints confirmation message', async () => {
    await run('register', '--name', 'done-agent');
    const id = stdoutData.trim();
    stdoutData = '';
    await run('start', id);
    stdoutData = '';

    await run('complete', id, '--summary', 'Done');
    expect(stdoutData).toContain('completed');
  });

  it('errors when agent not found', async () => {
    await run('complete', 'missing', '--summary', 'Done');
    expect(stderrData).toContain('not found');
    expect(process.exitCode).toBe(1);
  });

  it('errors when agent is not active', async () => {
    await run('register', '--name', 'pending-complete');
    const id = stdoutData.trim();
    stdoutData = '';
    stderrData = '';

    await run('complete', id, '--summary', 'Done');
    expect(stderrData).toContain('not active');
    expect(process.exitCode).toBe(1);
  });

  it('propagates completion to linked PM task', async () => {
    await run('register', '--name', 'pm-agent', '--brain-task', 'VNM-10.02');
    const id = stdoutData.trim();
    stdoutData = '';
    await run('start', id);
    stdoutData = '';
    stderrData = '';

    await run('complete', id, '--summary', 'All done');
    expect(mockUpdateTaskStatus).toHaveBeenCalledOnce();
    expect(mockUpdateTaskStatus).toHaveBeenCalledWith(
      db,
      expect.anything(),
      expect.anything(),
      'VNM-10.02',
      'done'
    );
    expect(stdoutData).toContain('VNM-10.02');
    expect(stdoutData).toContain('done');
  });

  it('does not call updateTaskStatus when no brain_task', async () => {
    await run('register', '--name', 'no-task-agent');
    const id = stdoutData.trim();
    stdoutData = '';
    await run('start', id);
    stdoutData = '';

    await run('complete', id, '--summary', 'Done');
    expect(mockUpdateTaskStatus).not.toHaveBeenCalled();
  });

  it('warns but does not fail when task update fails', async () => {
    mockUpdateTaskStatus.mockResolvedValue({
      ok: false,
      error: { message: 'Task not found', code: 'NOT_FOUND' },
    });

    await run('register', '--name', 'fail-task-agent', '--brain-task', 'VNM-99.99');
    const id = stdoutData.trim();
    stdoutData = '';
    await run('start', id);
    stdoutData = '';
    stderrData = '';

    await run('complete', id, '--summary', 'Done');
    expect(process.exitCode).toBeUndefined();
    expect(stderrData).toContain('Warning');
    expect(stderrData).toContain('VNM-99.99');

    const row = db.prepare('SELECT status FROM agents WHERE id = ?').get(id) as { status: string };
    expect(row.status).toBe('completed');
  });
});

// ── abandon ───────────────────────────────────────────────────────────────────

describe('agent abandon', () => {
  it('transitions active agent to abandoned', async () => {
    await run('register', '--name', 'abandon-agent');
    const id = stdoutData.trim();
    stdoutData = '';
    await run('start', id);
    stdoutData = '';
    stderrData = '';

    await run('abandon', id, '--reason', 'timeout');
    expect(stderrData).toBe('');
    expect(process.exitCode).toBeUndefined();

    const row = db
      .prepare('SELECT status, completed_at, exit_reason FROM agents WHERE id = ?')
      .get(id) as { status: string; completed_at: string; exit_reason: string };
    expect(row.status).toBe('abandoned');
    expect(row.completed_at).toBeTruthy();
    expect(row.exit_reason).toBe('timeout');
  });

  it('errors when agent not found', async () => {
    await run('abandon', 'missing', '--reason', 'gone');
    expect(stderrData).toContain('not found');
    expect(process.exitCode).toBe(1);
  });

  it('errors when agent is not active', async () => {
    await run('register', '--name', 'pending-abandon');
    const id = stdoutData.trim();
    stdoutData = '';
    stderrData = '';

    await run('abandon', id, '--reason', 'bail');
    expect(stderrData).toContain('not active');
    expect(process.exitCode).toBe(1);
  });

  it('reverts linked PM task to pending on abandon', async () => {
    await run('register', '--name', 'abandon-pm', '--brain-task', 'VNM-10.05');
    const id = stdoutData.trim();
    stdoutData = '';
    await run('start', id);
    stdoutData = '';
    stderrData = '';

    await run('abandon', id, '--reason', 'timeout');
    expect(mockUpdateTaskStatus).toHaveBeenCalledOnce();
    expect(mockUpdateTaskStatus).toHaveBeenCalledWith(
      db,
      expect.anything(),
      expect.anything(),
      'VNM-10.05',
      'pending'
    );
    expect(stdoutData).toContain('VNM-10.05');
    expect(stdoutData).toContain('pending');
  });

  it('does not call updateTaskStatus when no brain_task on abandon', async () => {
    await run('register', '--name', 'abandon-no-task');
    const id = stdoutData.trim();
    stdoutData = '';
    await run('start', id);
    stdoutData = '';

    await run('abandon', id, '--reason', 'done');
    expect(mockUpdateTaskStatus).not.toHaveBeenCalled();
  });
});

// ── status ────────────────────────────────────────────────────────────────────

describe('agent status', () => {
  it('lists all agents in table format', async () => {
    await run('register', '--name', 'agent-alpha');
    stdoutData = '';
    await run('register', '--name', 'agent-beta');
    stdoutData = '';

    await run('status');
    expect(stdoutData).toContain('agent-alpha');
    expect(stdoutData).toContain('agent-beta');
    expect(stdoutData).toContain('pending');
  });

  it('prints "No agents found" when empty', async () => {
    await run('status');
    expect(stdoutData).toContain('No agents found');
  });

  it('--active filters to active agents only', async () => {
    await run('register', '--name', 'inactive-agent');
    const pendingId = stdoutData.trim();
    stdoutData = '';

    await run('register', '--name', 'active-agent');
    const activeId = stdoutData.trim();
    stdoutData = '';

    await run('start', activeId);
    stdoutData = '';

    await run('status', '--active');
    expect(stdoutData).toContain('active-agent');
    expect(stdoutData).not.toContain('inactive-agent');
    // Suppress unused-var warning
    void pendingId;
  });

  it('--json returns valid JSON array', async () => {
    await run('register', '--name', 'json-agent');
    stdoutData = '';

    await run('status', '--json');
    const parsed = JSON.parse(stdoutData) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    const first = parsed[0] as Record<string, unknown>;
    expect(first.name).toBe('json-agent');
    expect(first.status).toBe('pending');
  });

  it('--json with empty list returns valid JSON empty array', async () => {
    await run('status', '--json');
    const parsed = JSON.parse(stdoutData) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(0);
  });

  it('--agent <id> shows detail view for a specific agent', async () => {
    await run('register', '--name', 'detail-target', '--branch', 'feat/detail');
    const id = stdoutData.trim();
    stdoutData = '';

    await run('status', '--agent', id);
    expect(stdoutData).toContain('detail-target');
    expect(stdoutData).toContain('feat/detail');
    expect(stdoutData).toContain('pending');
  });

  it('--agent --json returns valid JSON object', async () => {
    await run('register', '--name', 'json-detail');
    const id = stdoutData.trim();
    stdoutData = '';

    await run('status', '--agent', id, '--json');
    const parsed = JSON.parse(stdoutData) as Record<string, unknown>;
    expect(parsed.id).toBe(id);
    expect(parsed.name).toBe('json-detail');
  });

  it('--agent errors when not found', async () => {
    await run('status', '--agent', 'no-such-id');
    expect(stderrData).toContain('not found');
    expect(process.exitCode).toBe(1);
  });
});
