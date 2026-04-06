import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HookInput } from '../../../src/hooks/types.js';

vi.mock('../../../src/services/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../../src/services/brain-db.js', () => ({
  BrainDB: vi.fn(),
}));

vi.mock('../../../src/modules/sessions/analytics/post-execution-analyzer.js', () => ({
  runPostExecutionAnalysis: vi.fn(),
}));

vi.mock('../../../src/modules/sessions/engine/aggregate.js', () => ({
  aggregateSessionEvents: vi.fn(),
}));

import { loadConfig } from '../../../src/services/config.js';
import { BrainDB } from '../../../src/services/brain-db.js';
import { runPostExecutionAnalysis } from '../../../src/modules/sessions/analytics/post-execution-analyzer.js';
import { aggregateSessionEvents } from '../../../src/modules/sessions/engine/aggregate.js';
import { sessionAnalysisHandler } from '../../../src/modules/sessions/hooks/session-analysis-handler.js';

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>;
const mockBrainDB = BrainDB as ReturnType<typeof vi.fn>;
const mockRunAnalysis = runPostExecutionAnalysis as ReturnType<typeof vi.fn>;
const mockAggregateEvents = aggregateSessionEvents as ReturnType<typeof vi.fn>;

function makeInput(parsed: Record<string, unknown> = {}): HookInput {
  return { event: 'agent-done', raw: '', parsed, cwd: '/proj' };
}

describe('sessions:analysis handler', () => {
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
    mockAggregateEvents.mockReturnValue({
      sessionId: 'test-session',
      skillUsage: new Map(),
      frictionSignals: [],
      taskRefs: ['VNM-34.86'],
      errorRate: 0,
      toolCalls: [],
    });
    mockRunAnalysis.mockResolvedValue({
      sessionId: 'test-session',
      gpa: { gpa: 7.5, dimensions: { goal: 8, plan: 7, action: 7 } },
      analysisNoteSlug: 'sessions/analysis/test-session',
      skillCountersUpdated: [],
      evolutionSuggestionSlug: null,
    });
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.BRAIN_PM_SESSION;
    else process.env.BRAIN_PM_SESSION = savedEnv;
  });

  it('has correct metadata', () => {
    expect(sessionAnalysisHandler.name).toBe('sessions:analysis');
    expect(sessionAnalysisHandler.event).toBe('agent-done');
    expect(sessionAnalysisHandler.priority).toBe(25);
  });

  it('NF-01: returns hookAllow in < 50ms regardless of Ollama availability', () => {
    process.env.BRAIN_PM_SESSION = 'test-session';
    // Make runPostExecutionAnalysis never resolve to simulate slow Ollama
    mockRunAnalysis.mockReturnValue(new Promise(() => {}));
    const input = makeInput({ exit_code: 0 });
    const start = performance.now();
    const result = sessionAnalysisHandler.run(
      input,
      {} as Parameters<typeof sessionAnalysisHandler.run>[1]
    );
    const elapsed = performance.now() - start;
    expect(result.allow).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });

  it('AC-15: returns allow immediately without awaiting analysis', () => {
    process.env.BRAIN_PM_SESSION = 'test-session';
    let _analysisStarted = false;
    mockRunAnalysis.mockImplementation(async () => {
      _analysisStarted = true;
      await new Promise((resolve) => setTimeout(resolve, 200));
      return {};
    });
    const input = makeInput({ exit_code: 0 });
    const result = sessionAnalysisHandler.run(
      input,
      {} as Parameters<typeof sessionAnalysisHandler.run>[1]
    );
    // Hook must have returned already — analysis runs in background
    expect(result.allow).toBe(true);
    // analysisStarted may or may not be true here depending on microtask timing — the key is the hook returned
  });

  it('skips analysis when BRAIN_PM_SESSION is not set', () => {
    delete process.env.BRAIN_PM_SESSION;
    const input = makeInput({ exit_code: 0 });
    const result = sessionAnalysisHandler.run(
      input,
      {} as Parameters<typeof sessionAnalysisHandler.run>[1]
    );
    expect(result.allow).toBe(true);
    expect(mockRunAnalysis).not.toHaveBeenCalled();
  });
});
