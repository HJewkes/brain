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

vi.mock('../../../src/modules/sessions/data/session-ops.js', () => ({
  updateSessionNoteMeta: vi.fn(),
}));

vi.mock('../../../src/modules/sessions/engine/aggregate.js', () => ({
  aggregateSessionEvents: vi.fn(),
}));

import { loadConfig, resolveInstance } from '../../../src/services/config.js';
import { BrainDB } from '../../../src/services/brain-db.js';
import { updateSessionNoteMeta } from '../../../src/modules/sessions/data/session-ops.js';
import { aggregateSessionEvents } from '../../../src/modules/sessions/engine/aggregate.js';
import {
  sessionEndHandler,
  classifyOutcome,
} from '../../../src/modules/sessions/hooks/session-end-handler.js';

const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>;
const mockResolveInstance = resolveInstance as ReturnType<typeof vi.fn>;
const mockBrainDB = BrainDB as ReturnType<typeof vi.fn>;
const mockAggregateSessionEvents = aggregateSessionEvents as ReturnType<typeof vi.fn>;
const mockUpdateSessionNoteMeta = updateSessionNoteMeta as ReturnType<typeof vi.fn>;

function makeInput(cwd = '/proj'): HookInput {
  return {
    event: 'agent-done',
    raw: '{}',
    parsed: {},
    cwd,
  };
}

describe('sessions:end handler', () => {
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
    it('has name sessions:end', () => {
      expect(sessionEndHandler.name).toBe('sessions:end');
    });

    it('has event agent-done', () => {
      expect(sessionEndHandler.event).toBe('agent-done');
    });

    it('has priority 15', () => {
      expect(sessionEndHandler.priority).toBe(15);
    });
  });

  describe('enabled()', () => {
    it('returns false when BRAIN_PM_SESSION is not set', () => {
      delete process.env.BRAIN_PM_SESSION;
      expect(sessionEndHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);
    });

    it('returns true when BRAIN_PM_SESSION is set', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';
      expect(sessionEndHandler.enabled(DEFAULT_HOOK_CONFIG)).toBe(true);
    });
  });

  describe('classifyOutcome()', () => {
    it('returns unknown when no tools and fewer than 2 turns', () => {
      expect(classifyOutcome({ toolCalls: { length: 0 }, errorRate: 0, userTurns: 1 })).toBe(
        'unknown'
      );
    });

    it('returns abandoned when few tool calls', () => {
      expect(classifyOutcome({ toolCalls: { length: 3 }, errorRate: 0, userTurns: 5 })).toBe(
        'abandoned'
      );
    });

    it('returns abandoned when error rate exceeds 30%', () => {
      expect(classifyOutcome({ toolCalls: { length: 20 }, errorRate: 0.35, userTurns: 5 })).toBe(
        'abandoned'
      );
    });

    it('returns success when error rate is below 10%', () => {
      expect(classifyOutcome({ toolCalls: { length: 20 }, errorRate: 0.05, userTurns: 5 })).toBe(
        'success'
      );
    });

    it('returns partial when many tools but moderate error rate', () => {
      expect(classifyOutcome({ toolCalls: { length: 15 }, errorRate: 0.15, userTurns: 5 })).toBe(
        'partial'
      );
    });

    it('returns unknown when moderate tools and moderate error rate with few tools', () => {
      expect(classifyOutcome({ toolCalls: { length: 8 }, errorRate: 0.15, userTurns: 5 })).toBe(
        'unknown'
      );
    });

    it('returns abandoned at exactly 4 tool calls', () => {
      expect(classifyOutcome({ toolCalls: { length: 4 }, errorRate: 0, userTurns: 5 })).toBe(
        'abandoned'
      );
    });

    it('returns success at exactly 5 tool calls with low error rate', () => {
      expect(classifyOutcome({ toolCalls: { length: 5 }, errorRate: 0, userTurns: 5 })).toBe(
        'success'
      );
    });
  });

  describe('run()', () => {
    it('skips when BRAIN_PM_SESSION is not set', () => {
      delete process.env.BRAIN_PM_SESSION;

      const result = sessionEndHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);

      expect(result.exitCode).toBe(0);
      expect(mockAggregateSessionEvents).not.toHaveBeenCalled();
    });

    it('skips trivial sessions with fewer than 2 turns and no tools', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';
      mockAggregateSessionEvents.mockReturnValue({
        userTurns: 1,
        toolCalls: [],
        errorRate: 0,
      });

      const result = sessionEndHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);

      expect(result.exitCode).toBe(0);
      expect(mockUpdateSessionNoteMeta).not.toHaveBeenCalled();
    });

    it('skips when no analytics available', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';
      mockAggregateSessionEvents.mockReturnValue(null);

      const result = sessionEndHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);

      expect(result.exitCode).toBe(0);
      expect(mockUpdateSessionNoteMeta).not.toHaveBeenCalled();
    });

    it('updates session note with ended_at and outcome for successful session', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';
      mockAggregateSessionEvents.mockReturnValue({
        userTurns: 5,
        toolCalls: new Array(20),
        errorRate: 0.02,
      });

      const result = sessionEndHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);

      expect(result.exitCode).toBe(0);
      expect(mockUpdateSessionNoteMeta).toHaveBeenCalledOnce();

      const updater = mockUpdateSessionNoteMeta.mock.calls[0][2] as (
        meta: Record<string, unknown>
      ) => void;
      const meta: Record<string, unknown> = { status: 'active' };
      updater(meta);

      expect(meta.ended_at).toBeDefined();
      expect(meta.outcome).toBe('success');
      expect(meta.status).toBe('completed');
    });

    it('sets status to abandoned for abandoned sessions', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';
      mockAggregateSessionEvents.mockReturnValue({
        userTurns: 3,
        toolCalls: new Array(2),
        errorRate: 0,
      });

      sessionEndHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);

      const updater = mockUpdateSessionNoteMeta.mock.calls[0][2] as (
        meta: Record<string, unknown>
      ) => void;
      const meta: Record<string, unknown> = { status: 'active' };
      updater(meta);

      expect(meta.outcome).toBe('abandoned');
      expect(meta.status).toBe('abandoned');
    });

    it('sets status to completed for partial sessions', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';
      mockAggregateSessionEvents.mockReturnValue({
        userTurns: 5,
        toolCalls: new Array(30),
        errorRate: 0.2,
      });

      sessionEndHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);

      const updater = mockUpdateSessionNoteMeta.mock.calls[0][2] as (
        meta: Record<string, unknown>
      ) => void;
      const meta: Record<string, unknown> = { status: 'active' };
      updater(meta);

      expect(meta.outcome).toBe('partial');
      expect(meta.status).toBe('completed');
    });

    it('does not overwrite existing ended_at or outcome', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';
      mockAggregateSessionEvents.mockReturnValue({
        userTurns: 5,
        toolCalls: new Array(20),
        errorRate: 0.02,
      });

      sessionEndHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);

      const updater = mockUpdateSessionNoteMeta.mock.calls[0][2] as (
        meta: Record<string, unknown>
      ) => void;
      const meta: Record<string, unknown> = {
        status: 'completed',
        ended_at: '2026-03-29T00:00:00Z',
        outcome: 'success',
      };
      updater(meta);

      expect(meta.ended_at).toBe('2026-03-29T00:00:00Z');
      expect(meta.outcome).toBe('success');
      expect(meta.status).toBe('completed');
    });

    it('returns allow on error', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';
      mockLoadConfig.mockImplementation(() => {
        throw new Error('no config');
      });

      const result = sessionEndHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);

      expect(result.exitCode).toBe(0);
    });

    it('closes DB even on error', () => {
      process.env.BRAIN_PM_SESSION = 'sess-abc123';
      const fakeDb = { close: vi.fn() };
      mockBrainDB.mockReturnValue(fakeDb);
      mockAggregateSessionEvents.mockImplementation(() => {
        throw new Error('db fail');
      });

      sessionEndHandler.run(makeInput(), DEFAULT_HOOK_CONFIG);

      expect(fakeDb.close).toHaveBeenCalled();
    });
  });
});
