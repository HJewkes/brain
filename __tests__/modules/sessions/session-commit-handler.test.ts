import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HookInput } from '../../../src/hooks/types.js';
import { DEFAULT_HOOK_CONFIG } from '../../../src/hooks/config.js';

vi.mock('../../../src/services/config.js', () => ({
  loadConfig: vi.fn(),
  resolveInstance: vi.fn(),
}));

vi.mock('../../../src/services/brain-db.js', () => ({
  BrainDB: vi.fn(),
}));

vi.mock('../../../src/modules/sessions/data/session-ops.js', () => ({
  getSessionBySessionId: vi.fn(),
}));

vi.mock('../../../src/modules/sessions/engine/aggregate.js', () => ({
  aggregateSessionEvents: vi.fn(),
}));

vi.mock('../../../src/hooks/utils.js', () => ({
  findBrainBinary: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { loadConfig, resolveInstance } from '../../../src/services/config.js';
import { BrainDB } from '../../../src/services/brain-db.js';
import { getSessionBySessionId } from '../../../src/modules/sessions/data/session-ops.js';
import { aggregateSessionEvents } from '../../../src/modules/sessions/engine/aggregate.js';
import { findBrainBinary } from '../../../src/hooks/utils.js';
import { spawn } from 'node:child_process';
import { sessionCommitHandler } from '../../../src/modules/sessions/hooks/session-commit-handler.js';

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>;
const mockResolveInstance = resolveInstance as ReturnType<typeof vi.fn>;
const mockBrainDB = BrainDB as ReturnType<typeof vi.fn>;
const mockGetSession = getSessionBySessionId as ReturnType<typeof vi.fn>;
const mockAggregate = aggregateSessionEvents as ReturnType<typeof vi.fn>;
const mockFindBinary = findBrainBinary as ReturnType<typeof vi.fn>;
const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;

function makeInput(cwd = '/proj'): HookInput {
  return { event: 'agent-done', raw: '', parsed: {}, cwd };
}

describe('sessions:commit handler', () => {
  const origEnv = process.env.BRAIN_PM_SESSION;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRAIN_PM_SESSION = 'test-session-id';

    const fakeDb = { close: vi.fn() };
    mockBrainDB.mockReturnValue(fakeDb);
    mockResolveInstance.mockReturnValue({ root: '/tmp' });
    mockLoadConfig.mockReturnValue({ dbPath: '/tmp/db' });
    mockFindBinary.mockReturnValue('/usr/local/bin/brain');
    mockSpawn.mockReturnValue({ unref: vi.fn() });
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.BRAIN_PM_SESSION = origEnv;
    } else {
      delete process.env.BRAIN_PM_SESSION;
    }
  });

  it('is disabled when BRAIN_PM_SESSION is not set', () => {
    delete process.env.BRAIN_PM_SESSION;
    expect(sessionCommitHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);
  });

  it('is enabled when BRAIN_PM_SESSION is set', () => {
    expect(sessionCommitHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(true);
  });

  it('returns early when BRAIN_PM_SESSION is not set', () => {
    delete process.env.BRAIN_PM_SESSION;
    const result = sessionCommitHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);
    expect(mockBrainDB).not.toHaveBeenCalled();
  });

  it('skips when session already committed', () => {
    mockGetSession.mockReturnValue({ display_id: 'SNS-001' });
    const result = sessionCommitHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('skips when no events exist', () => {
    mockGetSession.mockReturnValue(null);
    mockAggregate.mockReturnValue(null);
    const result = sessionCommitHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('skips trivial sessions', () => {
    mockGetSession.mockReturnValue(null);
    mockAggregate.mockReturnValue({ userTurns: 1, toolCalls: [] });
    const result = sessionCommitHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('spawns brain session commit when conditions are met', () => {
    mockGetSession.mockReturnValue(null);
    mockAggregate.mockReturnValue({ userTurns: 5, toolCalls: [{ toolName: 'Read' }] });
    const result = sessionCommitHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);
    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/local/bin/brain',
      ['session', 'commit', 'test-session-id'],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    );
  });

  it('does not spawn when brain binary not found', () => {
    mockGetSession.mockReturnValue(null);
    mockAggregate.mockReturnValue({ userTurns: 5, toolCalls: [{ toolName: 'Read' }] });
    mockFindBinary.mockReturnValue(null);
    const result = sessionCommitHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
