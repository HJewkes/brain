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

vi.mock('../../../src/modules/sessions/hooks/capture-event.js', () => ({
  captureSessionChunk: vi.fn(),
}));

vi.mock('../../../src/modules/sessions/data/session-ops.js', () => ({
  updateSessionNoteMeta: vi.fn(),
}));

import { loadConfig, resolveInstance } from '../../../src/services/config.js';
import { BrainDB } from '../../../src/services/brain-db.js';
import { captureSessionChunk } from '../../../src/modules/sessions/hooks/capture-event.js';
import { updateSessionNoteMeta } from '../../../src/modules/sessions/data/session-ops.js';
import { sessionPreCompactHandler } from '../../../src/modules/sessions/hooks/session-pre-compact-handler.js';

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>;
const mockResolveInstance = resolveInstance as ReturnType<typeof vi.fn>;
const mockBrainDB = BrainDB as ReturnType<typeof vi.fn>;
const mockCaptureChunk = captureSessionChunk as ReturnType<typeof vi.fn>;
const mockUpdateMeta = updateSessionNoteMeta as ReturnType<typeof vi.fn>;

function makeInput(summary: string, cwd = '/proj'): HookInput {
  return {
    event: 'pre-compact',
    raw: JSON.stringify({ summary }),
    parsed: { summary },
    cwd,
  };
}

describe('sessions:pre-compact handler', () => {
  const origEnv = process.env.BRAIN_PM_SESSION;
  let fakeDb: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRAIN_PM_SESSION = 'test-session-id';

    fakeDb = { close: vi.fn() };
    mockBrainDB.mockReturnValue(fakeDb);
    mockResolveInstance.mockReturnValue({ root: '/tmp' });
    mockLoadConfig.mockReturnValue({ dbPath: '/tmp/db' });
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.BRAIN_PM_SESSION = origEnv;
    } else {
      delete process.env.BRAIN_PM_SESSION;
    }
  });

  describe('metadata', () => {
    it('has name sessions:pre-compact', () => {
      expect(sessionPreCompactHandler.name).toBe('sessions:pre-compact');
    });

    it('has event pre-compact', () => {
      expect(sessionPreCompactHandler.event).toBe('pre-compact');
    });

    it('has priority 5', () => {
      expect(sessionPreCompactHandler.priority).toBe(5);
    });
  });

  describe('enabled()', () => {
    it('returns false when BRAIN_PM_SESSION is not set', () => {
      delete process.env.BRAIN_PM_SESSION;
      expect(sessionPreCompactHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);
    });

    it('returns true when BRAIN_PM_SESSION is set', () => {
      expect(sessionPreCompactHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(true);
    });
  });

  describe('run()', () => {
    it('captures summary as compaction chunk', () => {
      const result = sessionPreCompactHandler.run(
        makeInput('User was implementing PreCompact hook for session continuity'),
        DEFAULT_HOOK_CONFIG
      );

      expect(result.exitCode).toBe(0);
      expect(mockCaptureChunk).toHaveBeenCalledWith(
        fakeDb,
        'test-session-id',
        'User was implementing PreCompact hook for session continuity',
        'compaction'
      );
    });

    it('skips when BRAIN_PM_SESSION is not set', () => {
      delete process.env.BRAIN_PM_SESSION;

      const result = sessionPreCompactHandler.run(makeInput('some summary'), DEFAULT_HOOK_CONFIG);

      expect(result.exitCode).toBe(0);
      expect(mockBrainDB).not.toHaveBeenCalled();
      expect(mockCaptureChunk).not.toHaveBeenCalled();
    });

    it('skips when summary is empty', () => {
      const result = sessionPreCompactHandler.run(makeInput(''), DEFAULT_HOOK_CONFIG);

      expect(result.exitCode).toBe(0);
      expect(mockBrainDB).not.toHaveBeenCalled();
      expect(mockCaptureChunk).not.toHaveBeenCalled();
    });

    it('skips when summary is whitespace-only', () => {
      const result = sessionPreCompactHandler.run(makeInput('   '), DEFAULT_HOOK_CONFIG);

      expect(result.exitCode).toBe(0);
      expect(mockCaptureChunk).not.toHaveBeenCalled();
    });

    it('extracts summary from content field as fallback', () => {
      const input: HookInput = {
        event: 'pre-compact',
        raw: '',
        parsed: { content: 'Fallback content summary' },
        cwd: '/proj',
      };

      sessionPreCompactHandler.run(input, DEFAULT_HOOK_CONFIG);

      expect(mockCaptureChunk).toHaveBeenCalledWith(
        fakeDb,
        'test-session-id',
        'Fallback content summary',
        'compaction'
      );
    });

    it('calls updateSessionNoteMeta to increment micro_summary_count', () => {
      sessionPreCompactHandler.run(makeInput('A summary'), DEFAULT_HOOK_CONFIG);

      expect(mockUpdateMeta).toHaveBeenCalledWith(fakeDb, 'test-session-id', expect.any(Function));

      // Verify the updater function increments correctly
      const updater = mockUpdateMeta.mock.calls[0][2] as (m: Record<string, unknown>) => void;
      const meta: Record<string, unknown> = {};
      updater(meta);
      expect(meta.micro_summary_count).toBe(1);
      expect(meta.last_captured_at).toBeDefined();
    });

    it('returns allow on error', () => {
      mockResolveInstance.mockImplementation(() => {
        throw new Error('no instance');
      });

      const result = sessionPreCompactHandler.run(makeInput('A summary'), DEFAULT_HOOK_CONFIG);

      expect(result.exitCode).toBe(0);
    });

    it('closes DB even on error', () => {
      mockCaptureChunk.mockImplementation(() => {
        throw new Error('db fail');
      });

      sessionPreCompactHandler.run(makeInput('A summary'), DEFAULT_HOOK_CONFIG);

      expect(fakeDb.close).toHaveBeenCalled();
    });
  });
});
