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

import { loadConfig } from '../../../src/services/config.js';
import { BrainDB } from '../../../src/services/brain-db.js';
import { captureSessionEvent } from '../../../src/modules/sessions/hooks/capture-event.js';
import { sessionCaptureHandler } from '../../../src/modules/sessions/hooks/session-capture-handler.js';

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>;
const mockBrainDB = BrainDB as ReturnType<typeof vi.fn>;
const mockCaptureEvent = captureSessionEvent as ReturnType<typeof vi.fn>;

function makeInput(parsed: Record<string, unknown> = {}): HookInput {
  return { event: 'pre-tool-use', raw: '', parsed, cwd: '/proj' };
}

describe('sessions:capture handler', () => {
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
    if (savedEnv === undefined) {
      delete process.env.BRAIN_PM_SESSION;
    } else {
      process.env.BRAIN_PM_SESSION = savedEnv;
    }
  });

  it('has correct metadata', () => {
    expect(sessionCaptureHandler.name).toBe('sessions:capture');
    expect(sessionCaptureHandler.event).toBe('pre-tool-use');
    expect(sessionCaptureHandler.priority).toBe(90);
  });

  it('is disabled when BRAIN_PM_SESSION is not set', () => {
    delete process.env.BRAIN_PM_SESSION;
    expect(sessionCaptureHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);
  });

  it('is enabled when BRAIN_PM_SESSION is set', () => {
    process.env.BRAIN_PM_SESSION = 'test-session-123';
    expect(sessionCaptureHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(true);
  });

  it('calls captureSessionEvent with tool data', () => {
    process.env.BRAIN_PM_SESSION = 'sess-abc';
    const input = makeInput({ tool: 'Read', file_path: '/foo/bar.ts' });

    const result = sessionCaptureHandler.run(input, DEFAULT_HOOK_CONFIG);

    expect(result.exitCode).toBe(0);
    expect(mockCaptureEvent).toHaveBeenCalledOnce();

    const [_db, eventInput] = mockCaptureEvent.mock.calls[0] as [
      unknown,
      {
        session_id: string;
        event_type: string;
        category: string;
        data: Record<string, unknown>;
      },
    ];
    expect(eventInput.session_id).toBe('sess-abc');
    expect(eventInput.event_type).toBe('tool:Read');
    expect(eventInput.category).toBe('read');
    expect(eventInput.data.tool).toBe('Read');
    expect(eventInput.data.input).toEqual({ tool: 'Read', file_path: '/foo/bar.ts' });
  });

  it('categorizes write tools correctly', () => {
    process.env.BRAIN_PM_SESSION = 'sess-abc';
    sessionCaptureHandler.run(makeInput({ tool: 'Edit' }), DEFAULT_HOOK_CONFIG);

    const [, eventInput] = mockCaptureEvent.mock.calls[0] as [unknown, { category: string }];
    expect(eventInput.category).toBe('write');
  });

  it('categorizes bash/execute tools correctly', () => {
    process.env.BRAIN_PM_SESSION = 'sess-abc';
    sessionCaptureHandler.run(makeInput({ tool: 'Bash' }), DEFAULT_HOOK_CONFIG);

    const [, eventInput] = mockCaptureEvent.mock.calls[0] as [unknown, { category: string }];
    expect(eventInput.category).toBe('execute');
  });

  it('categorizes git tools correctly', () => {
    process.env.BRAIN_PM_SESSION = 'sess-abc';
    sessionCaptureHandler.run(makeInput({ tool: 'git' }), DEFAULT_HOOK_CONFIG);

    const [, eventInput] = mockCaptureEvent.mock.calls[0] as [unknown, { category: string }];
    expect(eventInput.category).toBe('vcs');
  });

  it('uses "name" field when "tool" is absent', () => {
    process.env.BRAIN_PM_SESSION = 'sess-abc';
    sessionCaptureHandler.run(makeInput({ name: 'Grep' }), DEFAULT_HOOK_CONFIG);

    const [, eventInput] = mockCaptureEvent.mock.calls[0] as [unknown, { event_type: string }];
    expect(eventInput.event_type).toBe('tool:Grep');
  });

  it('falls back to "unknown" when no tool/name field', () => {
    process.env.BRAIN_PM_SESSION = 'sess-abc';
    sessionCaptureHandler.run(makeInput({}), DEFAULT_HOOK_CONFIG);

    const [, eventInput] = mockCaptureEvent.mock.calls[0] as [unknown, { event_type: string }];
    expect(eventInput.event_type).toBe('tool:unknown');
  });

  it('truncates long string values in tool input', () => {
    process.env.BRAIN_PM_SESSION = 'sess-abc';
    const longString = 'x'.repeat(600);
    sessionCaptureHandler.run(
      makeInput({ tool: 'Write', content: longString }),
      DEFAULT_HOOK_CONFIG
    );

    const [, eventInput] = mockCaptureEvent.mock.calls[0] as [
      unknown,
      {
        data: { input: Record<string, unknown> };
      },
    ];
    const content = eventInput.data.input.content as string;
    expect(content.length).toBeLessThanOrEqual(501); // 500 + ellipsis char
    expect(content.endsWith('…')).toBe(true);
  });

  it('skips capture when BRAIN_PM_SESSION is not set', () => {
    delete process.env.BRAIN_PM_SESSION;
    const result = sessionCaptureHandler.run(makeInput({ tool: 'Read' }), DEFAULT_HOOK_CONFIG);

    expect(result.exitCode).toBe(0);
    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });

  it('returns allow on error', () => {
    process.env.BRAIN_PM_SESSION = 'sess-abc';
    mockLoadConfig.mockImplementation(() => {
      throw new Error('no config');
    });

    const result = sessionCaptureHandler.run(makeInput({ tool: 'Read' }), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('closes DB even on captureSessionEvent error', () => {
    process.env.BRAIN_PM_SESSION = 'sess-abc';
    const fakeDb = { close: vi.fn() };
    mockBrainDB.mockReturnValue(fakeDb);
    mockCaptureEvent.mockImplementation(() => {
      throw new Error('db error');
    });

    sessionCaptureHandler.run(makeInput({ tool: 'Read' }), DEFAULT_HOOK_CONFIG);
    expect(fakeDb.close).toHaveBeenCalled();
  });
});
