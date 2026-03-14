import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockComputeEligible = vi.fn();
const mockGetAllProjectPrefixes = vi.fn();
const mockGetPmNotes = vi.fn();
const mockGetTask = vi.fn();
const mockBuildAgentDispatchContext = vi.fn();
const mockFormatDispatchBrief = vi.fn();
const mockGenerateClaim = vi.fn();
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockIndexSingleFile = vi.fn();

vi.mock('../../../src/modules/pm/engine/dependency.js', () => ({
  computeEligible: (...args: unknown[]) => mockComputeEligible(...args),
}));

vi.mock('../../../src/modules/pm/data/queries.js', () => ({
  getAllProjectPrefixes: (...args: unknown[]) => mockGetAllProjectPrefixes(...args),
  getPmNotes: (...args: unknown[]) => mockGetPmNotes(...args),
}));

vi.mock('../../../src/modules/pm/data/task-ops.js', () => ({
  getTask: (...args: unknown[]) => mockGetTask(...args),
  updateTaskStatus: vi.fn(),
}));

vi.mock('../../../src/modules/agents/dispatch-context.js', () => ({
  buildAgentDispatchContext: (...args: unknown[]) => mockBuildAgentDispatchContext(...args),
  formatDispatchBrief: (...args: unknown[]) => mockFormatDispatchBrief(...args),
}));

vi.mock('../../../src/modules/pm/engine/claims.js', () => ({
  generateClaim: (...args: unknown[]) => mockGenerateClaim(...args),
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

vi.mock('../../../src/services/indexing.js', () => ({
  indexSingleFile: (...args: unknown[]) => mockIndexSingleFile(...args),
}));

import { pullNextTask } from '../../../src/modules/agents/task-pull.js';
import type { BrainDB } from '../../../src/services/brain-db.js';
import type { BrainConfig } from '../../../src/types.js';

const mockDb = {} as BrainDB;
const mockConfig = { notesDir: '/tmp/brain' } as BrainConfig;
const mockEmbedder = { embed: vi.fn(), model: 'test', dimensions: 768 };

function setupTaskLookup(tasks: Record<string, { priority: string; status: string }>) {
  mockGetTask.mockImplementation((_db: unknown, displayId: string) => {
    const task = tasks[displayId];
    if (!task) return { ok: false, error: { code: 'NOT_FOUND', message: 'not found' } };
    return { ok: true, data: { display_id: displayId, ...task } };
  });
}

function setupClaimSuccess() {
  mockGetPmNotes.mockReturnValue([
    { id: 'note-1', filePath: '/tmp/brain/modules/pm/X/X-01.01.md', metadata: '{}' },
  ]);
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue('---\nstatus: pending\nmodified: 2026-03-12\n---\n\n# Task\n');
  mockIndexSingleFile.mockResolvedValue('note-1');
  mockGenerateClaim.mockReturnValue({ token: 'tok-123', claimedAt: '2026-03-13T00:00:00Z' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pullNextTask', () => {
  it('returns null when no projects exist', async () => {
    mockGetAllProjectPrefixes.mockReturnValue([]);

    const result = await pullNextTask(mockDb, mockConfig, mockEmbedder);

    expect(result).toBeNull();
  });

  it('returns null when no eligible tasks exist', async () => {
    mockGetAllProjectPrefixes.mockReturnValue(['VNM']);
    mockComputeEligible.mockReturnValue([]);

    const result = await pullNextTask(mockDb, mockConfig, mockEmbedder);

    expect(result).toBeNull();
  });

  it('selects highest priority task from eligible set', async () => {
    mockGetAllProjectPrefixes.mockReturnValue(['VNM']);
    mockComputeEligible.mockReturnValue(['VNM-01.01', 'VNM-01.02', 'VNM-01.03']);

    setupTaskLookup({
      'VNM-01.01': { priority: 'low', status: 'pending' },
      'VNM-01.02': { priority: 'medium', status: 'pending' },
      'VNM-01.03': { priority: 'critical', status: 'pending' },
    });

    setupClaimSuccess();

    const dispatchCtx = {
      taskId: 'VNM-01.03',
      routing: { model: 'opus', agentType: 'general-purpose', isolation: 'worktree', verify: true },
      agentDispatchable: true,
      context: {
        title: 'Critical task',
        body: 'Do it',
        workstream: undefined,
        prompt: undefined,
        dependencies: [],
        decisions: [],
        constraints: [],
      },
      contextHash: 'hash1',
    };
    mockBuildAgentDispatchContext.mockReturnValue(dispatchCtx);
    mockFormatDispatchBrief.mockReturnValue('Task: VNM-01.03 - Critical task');

    const result = await pullNextTask(mockDb, mockConfig, mockEmbedder);

    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('VNM-01.03');
    expect(result!.claimToken).toBe('tok-123');
    expect(result!.brief).toContain('VNM-01.03');
  });

  it('skips tasks that are not pending', async () => {
    mockGetAllProjectPrefixes.mockReturnValue(['VNM']);
    mockComputeEligible.mockReturnValue(['VNM-01.01', 'VNM-01.02']);

    setupTaskLookup({
      'VNM-01.01': { priority: 'high', status: 'claimed' },
      'VNM-01.02': { priority: 'medium', status: 'pending' },
    });

    setupClaimSuccess();

    const dispatchCtx = {
      taskId: 'VNM-01.02',
      routing: { model: 'opus', agentType: 'general-purpose', isolation: 'worktree', verify: true },
      agentDispatchable: true,
      context: {
        title: 'Medium task',
        body: '',
        workstream: undefined,
        prompt: undefined,
        dependencies: [],
        decisions: [],
        constraints: [],
      },
      contextHash: 'hash2',
    };
    mockBuildAgentDispatchContext.mockReturnValue(dispatchCtx);
    mockFormatDispatchBrief.mockReturnValue('Task: VNM-01.02 - Medium task');

    const result = await pullNextTask(mockDb, mockConfig, mockEmbedder);

    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('VNM-01.02');
  });

  it('aggregates eligible tasks across multiple projects', async () => {
    mockGetAllProjectPrefixes.mockReturnValue(['VNM', 'ABC']);
    mockComputeEligible.mockReturnValueOnce(['VNM-01.01']).mockReturnValueOnce(['ABC-01.01']);

    setupTaskLookup({
      'VNM-01.01': { priority: 'low', status: 'pending' },
      'ABC-01.01': { priority: 'critical', status: 'pending' },
    });

    setupClaimSuccess();

    const dispatchCtx = {
      taskId: 'ABC-01.01',
      routing: { model: 'opus', agentType: 'general-purpose', isolation: 'worktree', verify: true },
      agentDispatchable: true,
      context: {
        title: 'ABC task',
        body: '',
        workstream: undefined,
        prompt: undefined,
        dependencies: [],
        decisions: [],
        constraints: [],
      },
      contextHash: 'hash3',
    };
    mockBuildAgentDispatchContext.mockReturnValue(dispatchCtx);
    mockFormatDispatchBrief.mockReturnValue('Task: ABC-01.01');

    const result = await pullNextTask(mockDb, mockConfig, mockEmbedder);

    expect(result!.taskId).toBe('ABC-01.01');
    expect(mockComputeEligible).toHaveBeenCalledTimes(2);
  });

  it('returns null when dispatch context build fails', async () => {
    mockGetAllProjectPrefixes.mockReturnValue(['VNM']);
    mockComputeEligible.mockReturnValue(['VNM-01.01']);

    setupTaskLookup({
      'VNM-01.01': { priority: 'medium', status: 'pending' },
    });

    setupClaimSuccess();
    mockBuildAgentDispatchContext.mockReturnValue(null);

    const result = await pullNextTask(mockDb, mockConfig, mockEmbedder);

    expect(result).toBeNull();
  });
});
