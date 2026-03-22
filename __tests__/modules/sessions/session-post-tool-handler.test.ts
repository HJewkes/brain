import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HookInput } from '../../../src/hooks/types.js';
import { DEFAULT_HOOK_CONFIG } from '../../../src/hooks/config.js';

vi.mock('../../../src/services/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../../src/services/brain-db.js', () => ({
  BrainDB: vi.fn(),
}));

vi.mock('../../../src/modules/sessions/hooks/capture-event.js', () => ({
  captureSessionEvent: vi.fn(),
}));

vi.mock('../../../src/modules/sessions/hooks/status-cache.js', () => ({
  writeStatusCache: vi.fn(),
}));

import { loadConfig } from '../../../src/services/config.js';
import { BrainDB } from '../../../src/services/brain-db.js';
import { captureSessionEvent } from '../../../src/modules/sessions/hooks/capture-event.js';
import { writeStatusCache } from '../../../src/modules/sessions/hooks/status-cache.js';
import { sessionPostToolHandler } from '../../../src/modules/sessions/hooks/session-post-tool-handler.js';

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>;
const mockBrainDB = BrainDB as ReturnType<typeof vi.fn>;
const mockCaptureEvent = captureSessionEvent as ReturnType<typeof vi.fn>;
const mockWriteCache = writeStatusCache as ReturnType<typeof vi.fn>;

function makeInput(parsed: Record<string, unknown> = {}): HookInput {
  return { event: 'post-tool-use', raw: '', parsed, cwd: '/proj' };
}

describe('sessions:post-tool handler', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.BRAIN_PM_SESSION;
    vi.clearAllMocks();

    const fakeDb = { close: vi.fn() };
    mockBrainDB.mockReturnValue(fakeDb);
    mockLoadConfig.mockReturnValue({
      notesDir: '/tmp',
      dbPath: '/tmp/db',
      embedder: 'local',
      fusionWeights: { bm25: 0.3, vector: 0.7 },
    });
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.BRAIN_PM_SESSION;
    else process.env.BRAIN_PM_SESSION = savedEnv;
  });

  it('has correct metadata', () => {
    expect(sessionPostToolHandler.name).toBe('sessions:post-tool');
    expect(sessionPostToolHandler.event).toBe('post-tool-use');
    expect(sessionPostToolHandler.priority).toBe(90);
  });

  it('is disabled when BRAIN_PM_SESSION is not set', () => {
    delete process.env.BRAIN_PM_SESSION;
    expect(sessionPostToolHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);
  });

  it('is enabled when BRAIN_PM_SESSION is set', () => {
    process.env.BRAIN_PM_SESSION = 'test-session';
    expect(sessionPostToolHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(true);
  });

  it('writes status cache on every post-tool event', () => {
    process.env.BRAIN_PM_SESSION = 'sess-123';

    const result = sessionPostToolHandler.run(
      makeInput({ tool_name: 'Read', tool_output: 'file contents' }),
      DEFAULT_HOOK_CONFIG
    );

    expect(result.exitCode).toBe(0);
    expect(mockWriteCache).toHaveBeenCalledOnce();
  });

  it('detects PR URL in Bash output', () => {
    process.env.BRAIN_PM_SESSION = 'sess-123';

    sessionPostToolHandler.run(
      makeInput({
        tool_name: 'Bash',
        tool_output: 'Creating pull request...\nhttps://github.com/user/repo/pull/42\nDone!',
      }),
      DEFAULT_HOOK_CONFIG
    );

    expect(mockCaptureEvent).toHaveBeenCalledOnce();
    const [, eventInput] = mockCaptureEvent.mock.calls[0] as [
      unknown,
      { event_type: string; data: { pr_url: string } },
    ];
    expect(eventInput.event_type).toBe('pr:created');
    expect(eventInput.data.pr_url).toBe('https://github.com/user/repo/pull/42');
  });

  it('does not capture PR event for non-Bash tools', () => {
    process.env.BRAIN_PM_SESSION = 'sess-123';

    sessionPostToolHandler.run(
      makeInput({
        tool_name: 'Read',
        tool_output: 'https://github.com/user/repo/pull/42',
      }),
      DEFAULT_HOOK_CONFIG
    );

    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });

  it('does not capture PR event when no URL present', () => {
    process.env.BRAIN_PM_SESSION = 'sess-123';

    sessionPostToolHandler.run(
      makeInput({ tool_name: 'Bash', tool_output: 'Build succeeded' }),
      DEFAULT_HOOK_CONFIG
    );

    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });

  it('skips when BRAIN_PM_SESSION is not set', () => {
    delete process.env.BRAIN_PM_SESSION;

    const result = sessionPostToolHandler.run(
      makeInput({ tool_name: 'Bash' }),
      DEFAULT_HOOK_CONFIG
    );

    expect(result.exitCode).toBe(0);
    expect(mockWriteCache).not.toHaveBeenCalled();
  });

  it('returns allow on error', () => {
    process.env.BRAIN_PM_SESSION = 'sess-123';
    mockLoadConfig.mockImplementation(() => {
      throw new Error('no config');
    });

    const result = sessionPostToolHandler.run(
      makeInput({ tool_name: 'Bash' }),
      DEFAULT_HOOK_CONFIG
    );
    expect(result.exitCode).toBe(0);
  });

  it('closes DB even on error', () => {
    process.env.BRAIN_PM_SESSION = 'sess-123';
    const fakeDb = { close: vi.fn() };
    mockBrainDB.mockReturnValue(fakeDb);
    mockWriteCache.mockImplementation(() => {
      throw new Error('cache error');
    });

    sessionPostToolHandler.run(makeInput({ tool_name: 'Read' }), DEFAULT_HOOK_CONFIG);
    expect(fakeDb.close).toHaveBeenCalled();
  });
});
