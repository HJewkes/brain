import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_HOOK_CONFIG } from '../../../src/hooks/config.js';
import type { HookInput } from '../../../src/hooks/types.js';

vi.mock('../../../src/services/config.js', () => ({
  loadConfig: vi.fn(),
  resolveInstance: vi.fn(),
}));

vi.mock('../../../src/services/brain-db.js', () => ({
  BrainDB: vi.fn(),
}));

vi.mock('../../../src/modules/sessions/engine/session-resume.js', () => ({
  generateResumeContext: vi.fn(),
  renderResumeXml: vi.fn(),
  renderResumePlain: vi.fn(),
}));

vi.mock('../../../src/modules/sessions/data/session-ops.js', () => ({
  updateSessionNoteMeta: vi.fn(),
}));

import { loadConfig, resolveInstance } from '../../../src/services/config.js';
import { BrainDB } from '../../../src/services/brain-db.js';
import {
  generateResumeContext,
  renderResumeXml,
  renderResumePlain,
} from '../../../src/modules/sessions/engine/session-resume.js';
import { sessionCompactHandler } from '../../../src/modules/sessions/hooks/session-compact-handler.js';

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>;
const mockResolveInstance = resolveInstance as ReturnType<typeof vi.fn>;
const mockBrainDB = BrainDB as ReturnType<typeof vi.fn>;
const mockGenerateResumeContext = generateResumeContext as ReturnType<typeof vi.fn>;
const mockRenderResumeXml = renderResumeXml as ReturnType<typeof vi.fn>;
const _mockRenderResumePlain = renderResumePlain as ReturnType<typeof vi.fn>;

function makeInput(message: string, cwd = '/proj'): HookInput {
  return {
    event: 'notification',
    raw: JSON.stringify({ message }),
    parsed: { message },
    cwd,
  };
}

describe('sessions:compact handler', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.BRAIN_PM_SESSION;
    vi.clearAllMocks();

    const fakeDb = { close: vi.fn() };
    mockBrainDB.mockReturnValue(fakeDb);
    mockResolveInstance.mockReturnValue({ root: '/tmp' });
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

  describe('metadata', () => {
    it('has name sessions:compact', () => {
      expect(sessionCompactHandler.name).toBe('sessions:compact');
    });

    it('has event notification', () => {
      expect(sessionCompactHandler.event).toBe('notification');
    });

    it('has priority 5', () => {
      expect(sessionCompactHandler.priority).toBe(5);
    });
  });

  describe('enabled()', () => {
    it('returns false when BRAIN_PM_SESSION is not set', () => {
      delete process.env.BRAIN_PM_SESSION;
      expect(sessionCompactHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);
    });

    it('returns true when BRAIN_PM_SESSION is set', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';
      expect(sessionCompactHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(true);
    });
  });

  describe('run()', () => {
    it('returns empty result for non-compaction notifications', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';

      const result = sessionCompactHandler.run(makeInput('Build succeeded'), DEFAULT_HOOK_CONFIG);

      expect(result.exitCode).toBe(0);
      expect(mockGenerateResumeContext).not.toHaveBeenCalled();
    });

    it('returns resume context in stdout for notifications containing "context was compacted"', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';
      mockGenerateResumeContext.mockReturnValue({
        sessionId: 'sess-abc123',
        displayId: 'SNS-042',
        project: 'VNM',
        startedAt: '2026-03-14T10:00:00Z',
        compactCount: 1,
        filesWritten: [],
        tasksWorked: [],
        tasksCompleted: [],
        commits: [],
        microSummaries: [],
        activeConstraints: {},
      });
      mockRenderResumeXml.mockReturnValue('<session-resume>...</session-resume>');

      const result = sessionCompactHandler.run(
        makeInput('Context was compacted due to length'),
        DEFAULT_HOOK_CONFIG
      );

      expect(result.exitCode).toBe(0);
      expect(mockGenerateResumeContext).toHaveBeenCalledOnce();
      expect(result.stdout).toContain('session-resume');
    });

    it('detects compaction from notification containing "context has been compacted"', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';
      mockGenerateResumeContext.mockReturnValue({
        sessionId: 'sess-abc123',
        displayId: 'SNS-042',
        project: 'VNM',
        startedAt: '2026-03-14T10:00:00Z',
        compactCount: 0,
        filesWritten: [],
        tasksWorked: [],
        tasksCompleted: [],
        commits: [],
        microSummaries: [],
        activeConstraints: {},
      });
      mockRenderResumeXml.mockReturnValue('<session-resume>ctx</session-resume>');

      const result = sessionCompactHandler.run(
        makeInput('Context has been compacted to reduce size'),
        DEFAULT_HOOK_CONFIG
      );

      expect(mockGenerateResumeContext).toHaveBeenCalledOnce();
      expect(result.exitCode).toBe(0);
    });

    it('detects compaction from notification subtype "compact_boundary"', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';
      mockGenerateResumeContext.mockReturnValue({
        sessionId: 'sess-abc123',
        displayId: 'SNS-042',
        project: 'VNM',
        startedAt: '2026-03-14T10:00:00Z',
        compactCount: 0,
        filesWritten: [],
        tasksWorked: [],
        tasksCompleted: [],
        commits: [],
        microSummaries: [],
        activeConstraints: {},
      });
      mockRenderResumeXml.mockReturnValue('<session-resume>ctx</session-resume>');

      const input: HookInput = {
        event: 'notification',
        raw: '',
        parsed: { message: '', subtype: 'compact_boundary' },
        cwd: '/proj',
      };

      const result = sessionCompactHandler.run(input, DEFAULT_HOOK_CONFIG);
      expect(mockGenerateResumeContext).toHaveBeenCalledOnce();
      expect(result.exitCode).toBe(0);
    });

    it('increments compact_count in session metadata on compaction', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';
      const fakeDb = { close: vi.fn() };
      mockBrainDB.mockReturnValue(fakeDb);
      mockGenerateResumeContext.mockReturnValue({
        sessionId: 'sess-abc123',
        displayId: 'SNS-042',
        project: 'VNM',
        startedAt: '2026-03-14T10:00:00Z',
        compactCount: 1,
        filesWritten: [],
        tasksWorked: [],
        tasksCompleted: [],
        commits: [],
        microSummaries: [],
        activeConstraints: {},
      });
      mockRenderResumeXml.mockReturnValue('<session-resume>data</session-resume>');

      sessionCompactHandler.run(makeInput('Context was compacted'), DEFAULT_HOOK_CONFIG);

      // DB was opened and generateResumeContext was called to build the context
      expect(mockGenerateResumeContext).toHaveBeenCalledOnce();
    });

    it('returns allow on error', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';
      mockLoadConfig.mockImplementation(() => {
        throw new Error('no config');
      });

      const result = sessionCompactHandler.run(
        makeInput('Context was compacted'),
        DEFAULT_HOOK_CONFIG
      );

      expect(result.exitCode).toBe(0);
    });

    it('closes DB even on error', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';
      const fakeDb = { close: vi.fn() };
      mockBrainDB.mockReturnValue(fakeDb);
      mockGenerateResumeContext.mockImplementation(() => {
        throw new Error('db fail');
      });

      sessionCompactHandler.run(makeInput('Context was compacted'), DEFAULT_HOOK_CONFIG);

      expect(fakeDb.close).toHaveBeenCalled();
    });

    it('skips processing when BRAIN_PM_SESSION is not set', () => {
      delete process.env.BRAIN_PM_SESSION;

      const result = sessionCompactHandler.run(
        makeInput('Context was compacted'),
        DEFAULT_HOOK_CONFIG
      );

      expect(result.exitCode).toBe(0);
      expect(mockGenerateResumeContext).not.toHaveBeenCalled();
    });

    it('does not trigger for ambiguous messages that do not match compaction phrases', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';

      const result = sessionCompactHandler.run(
        makeInput('Task complete — all tests passed'),
        DEFAULT_HOOK_CONFIG
      );

      expect(result.exitCode).toBe(0);
      expect(mockGenerateResumeContext).not.toHaveBeenCalled();
    });

    it('stdout contains additionalContext field when compaction detected', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';
      mockGenerateResumeContext.mockReturnValue({
        sessionId: 'sess-abc123',
        displayId: 'SNS-042',
        project: 'VNM',
        startedAt: '2026-03-14T10:00:00Z',
        compactCount: 1,
        filesWritten: [],
        tasksWorked: [],
        tasksCompleted: [],
        commits: [],
        microSummaries: [],
        activeConstraints: {},
      });
      mockRenderResumeXml.mockReturnValue('<session-resume>data</session-resume>');

      const result = sessionCompactHandler.run(
        makeInput('Context was compacted'),
        DEFAULT_HOOK_CONFIG
      );

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as { additionalContext: string };
      expect(parsed.additionalContext).toContain('session-resume');
    });
  });
});
