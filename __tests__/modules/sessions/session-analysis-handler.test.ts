import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HookInput } from '../../../src/hooks/types.js';
import { DEFAULT_HOOK_CONFIG } from '../../../src/hooks/config.js';

vi.mock('../../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(),
}));

vi.mock('../../../src/modules/sessions/analytics/post-execution-analyzer.js', () => ({
  runPostExecutionAnalysis: vi.fn(),
}));

import { withBrain } from '../../../src/services/brain-service.js';
import { runPostExecutionAnalysis } from '../../../src/modules/sessions/analytics/post-execution-analyzer.js';
import { sessionAnalysisHandler } from '../../../src/modules/sessions/hooks/session-analysis-handler.js';

const mockWithBrain = withBrain as ReturnType<typeof vi.fn>;
const mockRunAnalysis = runPostExecutionAnalysis as ReturnType<typeof vi.fn>;

function makeInput(cwd = '/proj'): HookInput {
  return { event: 'agent-done', raw: '', parsed: {}, cwd };
}

describe('sessions:analysis handler', () => {
  const origSession = process.env.BRAIN_PM_SESSION;
  const origTask = process.env.BRAIN_PM_TASK;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRAIN_PM_SESSION = 'test-session-id';
    delete process.env.BRAIN_PM_TASK;
    mockWithBrain.mockResolvedValue({ score: {}, notePath: null, skipped: false });
  });

  afterEach(() => {
    if (origSession !== undefined) {
      process.env.BRAIN_PM_SESSION = origSession;
    } else {
      delete process.env.BRAIN_PM_SESSION;
    }
    if (origTask !== undefined) {
      process.env.BRAIN_PM_TASK = origTask;
    } else {
      delete process.env.BRAIN_PM_TASK;
    }
  });

  it('is named sessions:analysis at priority 25 on agent-done', () => {
    expect(sessionAnalysisHandler.name).toBe('sessions:analysis');
    expect(sessionAnalysisHandler.priority).toBe(25);
    expect(sessionAnalysisHandler.event).toBe('agent-done');
  });

  it('is disabled when BRAIN_PM_SESSION is not set', () => {
    delete process.env.BRAIN_PM_SESSION;
    expect(sessionAnalysisHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);
  });

  it('is enabled when BRAIN_PM_SESSION is set', () => {
    expect(sessionAnalysisHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(true);
  });

  it('returns hookAllow immediately (exitCode 0)', () => {
    const result = sessionAnalysisHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);
  });

  it('returns hookAllow when BRAIN_PM_SESSION is not set', () => {
    delete process.env.BRAIN_PM_SESSION;
    const result = sessionAnalysisHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);
    expect(mockWithBrain).not.toHaveBeenCalled();
  });

  it('dispatches analysis asynchronously via setImmediate (NF-01)', async () => {
    // Drain any setImmediate callbacks queued by previous tests
    await new Promise<void>((resolve) => setImmediate(resolve));
    vi.clearAllMocks();

    const result = sessionAnalysisHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    expect(result.exitCode).toBe(0);
    // withBrain not called synchronously
    expect(mockWithBrain).not.toHaveBeenCalled();

    // Flush setImmediate
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mockWithBrain).toHaveBeenCalledOnce();
  });

  it('passes sessionId and taskDescription to runPostExecutionAnalysis', async () => {
    process.env.BRAIN_PM_TASK = 'VNM-34.114';
    mockWithBrain.mockImplementation(async (fn: (svc: unknown) => unknown) => {
      const fakeSvc = {};
      return fn(fakeSvc);
    });
    mockRunAnalysis.mockResolvedValue({ score: {}, notePath: null, skipped: false });

    sessionAnalysisHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(mockRunAnalysis).toHaveBeenCalledWith({}, 'test-session-id', 'VNM-34.114');
  });

  it('suppresses errors from async analysis (fire-and-forget)', async () => {
    mockWithBrain.mockRejectedValue(new Error('db unavailable'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    sessionAnalysisHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(warnSpy).toHaveBeenCalledWith('[sessions:analysis] analysis failed:', expect.any(Error));
    warnSpy.mockRestore();
  });
});
