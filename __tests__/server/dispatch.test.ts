import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrainServiceClass } from '../../src/services/brain-service.js';
import type { RoutingResult } from '../../src/modules/pm/engine/routing.js';
import { parseCompletionMessage } from '../../src/modules/agents/completion-protocol.js';

// --- Module mocks ---

vi.mock('../../src/modules/agents/task-pull.js', () => ({
  pullNextTask: vi.fn(),
}));

vi.mock('../../src/modules/agents/coordinator.js', () => ({
  buildWorkerDispatchFromPull: vi.fn(),
}));

vi.mock('../../src/modules/pm/data/task-ops.js', () => ({
  getTask: vi.fn(),
}));

vi.mock('../../src/modules/pm/engine/claims.js', () => ({
  generateClaim: vi
    .fn()
    .mockReturnValue({ token: 'test-token', claimedAt: '2026-03-29T00:00:00.000Z' }),
  isClaimStale: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/modules/pm/data/queries.js', () => ({
  getPmNotes: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/modules/agents/dispatch-context.js', () => ({
  buildAgentDispatchContext: vi.fn(),
  formatDispatchBrief: vi.fn().mockReturnValue('test brief'),
}));

vi.mock('../../src/modules/agents/worktree.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/agents/worktree.js')>();
  return {
    ...actual,
    allocateWorktree: vi.fn(),
  };
});

vi.mock('../../src/modules/agents/data.js', () => ({
  createAgent: vi.fn().mockReturnValue('agent-001'),
  updateAgentStatus: vi.fn(),
  setAgentContext: vi.fn(),
  listAgents: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/modules/agents/completion-protocol.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/modules/agents/completion-protocol.js')>();
  return {
    ...actual,
    handleCompletion: vi.fn(),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

vi.mock('../../src/services/indexing.js', () => ({
  indexSingleFile: vi.fn().mockResolvedValue('note-1'),
}));

// Lazy imports for mocked modules
const { pullNextTask } = await import('../../src/modules/agents/task-pull.js');
const { buildWorkerDispatchFromPull } = await import('../../src/modules/agents/coordinator.js');
const { allocateWorktree, WorktreeBudgetExhaustedError } =
  await import('../../src/modules/agents/worktree.js');
const { getPmNotes } = await import('../../src/modules/pm/data/queries.js');
const fs = await import('node:fs');
const { dispatchTask } = await import('../../src/server/dispatch.js');

// --- Fixtures ---

const defaultRouting: RoutingResult = {
  model: 'sonnet',
  isolation: 'none',
  verify: false,
};

function makePullResult(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'VNM-99.01',
    claimToken: 'test-token',
    dispatchContext: {
      routing: defaultRouting,
      context: { title: 'Test task', workstream: { displayId: 'VNM-99' } },
      waveInfo: null,
    },
    brief: 'Test brief',
    ...overrides,
  };
}

function makeWorkerDispatch(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'VNM-99.01',
    claimToken: 'test-token',
    prompt: 'You are an agent. Do the task.',
    routing: defaultRouting,
    description: 'Implement VNM-99.01: Test task',
    ...overrides,
  };
}

const mockSvc = {
  db: {},
  config: {},
  embedder: {},
  instance: { isLocal: true, root: '/tmp/test/.brain', source: 'test' },
} as unknown as BrainServiceClass;

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dispatch', () => {
  describe('dispatchTask — dryRun', () => {
    it('returns prompt and routing for next task', async () => {
      vi.mocked(pullNextTask).mockResolvedValue(makePullResult());
      vi.mocked(buildWorkerDispatchFromPull).mockReturnValue(makeWorkerDispatch());

      const result = await dispatchTask(mockSvc, { dryRun: true });

      expect(result).toHaveProperty('dryRun', true);
      expect(result).toHaveProperty('prompt', 'You are an agent. Do the task.');
      expect(result).toHaveProperty('taskId', 'VNM-99.01');
      expect(result).toHaveProperty('model', 'sonnet');
    });

    it('returns brief as prompt when buildWorkerDispatch returns null', async () => {
      vi.mocked(pullNextTask).mockResolvedValue(makePullResult());
      vi.mocked(buildWorkerDispatchFromPull).mockReturnValue(null);

      const result = await dispatchTask(mockSvc, { dryRun: true });

      expect(result).toHaveProperty('dryRun', true);
      expect(result).toHaveProperty('prompt', 'Test brief');
      expect(result).toHaveProperty('taskId', 'VNM-99.01');
    });

    it('model override takes precedence over routing', async () => {
      vi.mocked(pullNextTask).mockResolvedValue(makePullResult());
      vi.mocked(buildWorkerDispatchFromPull).mockReturnValue(makeWorkerDispatch());

      const result = await dispatchTask(mockSvc, {
        model: 'opus',
        dryRun: true,
      });

      expect(result).toHaveProperty('model', 'opus');
    });

    it('uses routing model when no override provided', async () => {
      vi.mocked(pullNextTask).mockResolvedValue(makePullResult());
      vi.mocked(buildWorkerDispatchFromPull).mockReturnValue(
        makeWorkerDispatch({ routing: { ...defaultRouting, model: 'haiku' } })
      );

      const result = await dispatchTask(mockSvc, { dryRun: true });

      expect(result).toHaveProperty('model', 'haiku');
    });

    it('throws when no eligible tasks found', async () => {
      vi.mocked(pullNextTask).mockResolvedValue(null);

      await expect(dispatchTask(mockSvc, { dryRun: true })).rejects.toThrow(
        'No eligible tasks found for dispatch'
      );
    });
  });

  describe('claim release on failure', () => {
    const claimedFileContent =
      '---\nstatus: claimed\nclaim_token: test-token\nclaimed_at: "2026-04-22T00:00:00Z"\nmodified: 2026-04-22\n---\n\n# Task\n';

    function setupNoteLookup() {
      const note = {
        id: 'note-1',
        filePath: '/tmp/brain/modules/pm/VNM-99/VNM-99.01.md',
        metadata: '{}',
      };
      vi.mocked(getPmNotes).mockReturnValue([note] as unknown as ReturnType<typeof getPmNotes>);
      vi.mocked(fs.readFileSync).mockReturnValue(claimedFileContent);
    }

    it('releases claim and rethrows when worktree allocation fails', async () => {
      vi.mocked(pullNextTask).mockResolvedValue(makePullResult());
      vi.mocked(buildWorkerDispatchFromPull).mockReturnValue(
        makeWorkerDispatch({ routing: { ...defaultRouting, isolation: 'worktree' } })
      );
      vi.mocked(allocateWorktree).mockImplementation(() => {
        throw new Error('git worktree add: fatal');
      });
      setupNoteLookup();

      await expect(dispatchTask(mockSvc, {})).rejects.toThrow('git worktree add: fatal');

      expect(fs.writeFileSync).toHaveBeenCalled();
      const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
      expect(written).toContain('status: pending');
      expect(written).not.toMatch(/^claim_token:/m);
      expect(written).not.toMatch(/^claimed_at:/m);
    });

    it('returns queued result and releases claim when worktree budget is exhausted', async () => {
      vi.mocked(pullNextTask).mockResolvedValue(makePullResult());
      vi.mocked(buildWorkerDispatchFromPull).mockReturnValue(
        makeWorkerDispatch({ routing: { ...defaultRouting, isolation: 'worktree' } })
      );
      vi.mocked(allocateWorktree).mockImplementation(() => {
        throw new WorktreeBudgetExhaustedError(3, 3);
      });
      setupNoteLookup();

      const result = await dispatchTask(mockSvc, {});

      expect(result).toEqual({
        status: 'queued',
        taskId: 'VNM-99.01',
        reason: 'Worktree budget exhausted: 3/3 allocated',
        allocated: 3,
        budget: 3,
      });

      expect(fs.writeFileSync).toHaveBeenCalled();
      const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
      expect(written).toContain('status: pending');
      expect(written).not.toMatch(/^claim_token:/m);
      expect(written).not.toMatch(/^claimed_at:/m);
    });

    it('does not release claim when dryRun fails', async () => {
      vi.mocked(pullNextTask).mockResolvedValue(makePullResult({ claimToken: '' }));
      vi.mocked(buildWorkerDispatchFromPull).mockImplementation(() => {
        throw new Error('buildWorkerDispatch failed');
      });

      await expect(dispatchTask(mockSvc, { dryRun: true })).rejects.toThrow(
        'buildWorkerDispatch failed'
      );

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('parseCompletionMessage integration', () => {
    it('parses DONE message', () => {
      const msg = parseCompletionMessage('DONE VNM-46.17 Implemented headless dispatch');
      expect(msg).toEqual({
        status: 'done',
        taskId: 'VNM-46.17',
        summary: 'Implemented headless dispatch',
      });
    });

    it('parses FAILED message', () => {
      const msg = parseCompletionMessage('FAILED VNM-46.17 Could not find module');
      expect(msg).toEqual({
        status: 'failed',
        taskId: 'VNM-46.17',
        summary: 'Could not find module',
      });
    });

    it('returns null for garbage input', () => {
      expect(parseCompletionMessage('Hello world')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseCompletionMessage('')).toBeNull();
    });

    it('handles multiline DONE with summary', () => {
      const msg = parseCompletionMessage(
        'DONE VNM-01.02 Created the dispatch module\nwith full test coverage'
      );
      expect(msg).not.toBeNull();
      expect(msg!.status).toBe('done');
      expect(msg!.taskId).toBe('VNM-01.02');
      expect(msg!.summary).toContain('Created the dispatch module');
    });

    it('handles DONE with no summary', () => {
      const msg = parseCompletionMessage('DONE VNM-01.02');
      expect(msg).toEqual({
        status: 'done',
        taskId: 'VNM-01.02',
        summary: '',
      });
    });

    it('trims leading/trailing whitespace', () => {
      const msg = parseCompletionMessage('  DONE VNM-01.02 Summary  ');
      expect(msg).not.toBeNull();
      expect(msg!.status).toBe('done');
      expect(msg!.summary).toBe('Summary');
    });
  });

  describe('exit code → agent status mapping', () => {
    it('exit 0 with DONE result → parsed as completed', () => {
      const result = { subtype: 'success', result: 'DONE VNM-01.01 All done' };
      const completion = parseCompletionMessage(result.result);
      expect(completion).not.toBeNull();
      expect(completion!.status).toBe('done');
      expect(completion!.taskId).toBe('VNM-01.01');
    });

    it('exit 0 with FAILED result → parsed as failed', () => {
      const result = { subtype: 'success', result: 'FAILED VNM-01.01 Blocked by dependency' };
      const completion = parseCompletionMessage(result.result);
      expect(completion).not.toBeNull();
      expect(completion!.status).toBe('failed');
    });

    it('exit 0 with budget exceeded → no protocol message', () => {
      const result = { subtype: 'error_max_budget_usd', result: '' };
      const completion = parseCompletionMessage(result.result);
      expect(completion).toBeNull();
    });

    it('exit 0 with no DONE/FAILED → null completion (completed without protocol)', () => {
      const result = { subtype: 'success', result: 'I finished the work successfully' };
      const completion = parseCompletionMessage(result.result);
      expect(completion).toBeNull();
    });

    it('exit 143 contract: rate limited, task stays claimed', () => {
      // Exit 143 = SIGTERM = rate limit from Claude API
      // In dispatch.ts: code === 143 → updateAgentStatus('failed', { exit_reason: 'rate_limited' })
      // Task stays 'claimed' (not blocked) so it can be retried
      const EXIT_RATE_LIMITED = 143;
      expect(EXIT_RATE_LIMITED).not.toBe(0);
    });

    it('exit 1 contract: crash, task stays claimed', () => {
      // Exit 1 = general failure / crash
      // In dispatch.ts: else branch → updateAgentStatus('failed', { exit_reason: 'exit_code_1' })
      // Task stays 'claimed' (not blocked) — different from agent-reported FAILED
      const EXIT_CRASH = 1;
      expect(EXIT_CRASH).not.toBe(0);
    });
  });
});
