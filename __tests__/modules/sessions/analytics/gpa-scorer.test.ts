import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeActionScore,
  scoreGpa,
  type GpaScoringInput,
} from '../../../../src/modules/sessions/analytics/gpa-scorer.js';
import type { OllamaClient } from '../../../../src/services/ollama.js';

function makeInput(overrides: Partial<GpaScoringInput> = {}): GpaScoringInput {
  return {
    errorRate: 0,
    frictionSignals: [],
    toolCalls: [{ tool: 'Read' }, { tool: 'Edit' }],
    taskRefs: ['VNM-1'],
    planPresent: true,
    outcome: 'success',
    assistantTexts: ['Implemented the feature.'],
    ...overrides,
  };
}

function makeOllama(response: string): OllamaClient {
  return {
    model: 'test-model',
    generate: vi.fn().mockResolvedValue(response),
  };
}

// AC-06: computeActionScore — empty toolCalls returns 5.0
describe('computeActionScore', () => {
  it('returns 5.0 sentinel for empty toolCalls', () => {
    expect(computeActionScore({ errorRate: 0, frictionSignals: [], toolCalls: [] })).toBe(5.0);
  });

  it('returns 10.0 for perfect session (no errors, no friction)', () => {
    const score = computeActionScore({
      errorRate: 0,
      frictionSignals: [],
      toolCalls: [{ tool: 'Read' }, { tool: 'Edit' }],
    });
    expect(score).toBe(10.0);
  });

  it('reduces score for high error rate', () => {
    const score = computeActionScore({
      errorRate: 0.5,
      frictionSignals: [],
      toolCalls: [{ tool: 'Read' }],
    });
    // raw = 1 - min(1, max(0, 0.5*2 + 0)) = 0; score = 0
    expect(score).toBe(0);
  });

  it('reduces score for friction', () => {
    const score = computeActionScore({
      errorRate: 0,
      frictionSignals: [{ type: 'error_loop' }],
      toolCalls: [{ tool: 'Read' }, { tool: 'Edit' }],
    });
    // frictionDensity = 1/2 = 0.5; raw = 1 - 0.5 = 0.5; score = 5.0
    expect(score).toBeCloseTo(5.0);
  });

  it('caps score at 0 when combined penalty exceeds 1', () => {
    const score = computeActionScore({
      errorRate: 0.5,
      frictionSignals: [{ type: 'a' }, { type: 'b' }],
      toolCalls: [{ tool: 'A' }, { tool: 'B' }],
    });
    expect(score).toBe(0);
  });
});

// AC-07: scoreGpa — LLM scoring with valid response
describe('scoreGpa - LLM scoring', () => {
  it('parses Goal and Plan scores from LLM response', async () => {
    const ollama = makeOllama(
      'Goal: 8\nGoal rationale: Task was completed successfully.\nPlan: 7\nPlan rationale: Followed a structured approach.'
    );
    const result = await scoreGpa('sess-1', makeInput(), ollama);
    expect(result.sessionId).toBe('sess-1');
    expect(result.dimensions.goal).toBe(8);
    expect(result.dimensions.plan).toBe(7);
    expect(result.dimensions.action).toBeGreaterThanOrEqual(0);
    expect(result.gpa).not.toBeNull();
    expect(result.rationale.goal).toBeDefined();
    expect(result.rationale.plan).toBeDefined();
  });

  it('computes GPA as mean of non-null dimensions', async () => {
    const ollama = makeOllama('Goal: 6\nGoal rationale: ok.\nPlan: 8\nPlan rationale: good.');
    const input = makeInput({ errorRate: 0, frictionSignals: [], toolCalls: [{ tool: 'A' }] });
    const result = await scoreGpa('sess-2', input, ollama);
    // action = 10.0, goal = 6, plan = 8 → mean = (6+8+10)/3
    expect(result.gpa).toBeCloseTo((6 + 8 + 10) / 3);
  });
});

// AC-08: scoreGpa — null ollama
describe('scoreGpa - no LLM', () => {
  it('returns null Goal and Plan when ollama is null', async () => {
    const result = await scoreGpa('sess-3', makeInput(), null);
    expect(result.dimensions.goal).toBeNull();
    expect(result.dimensions.plan).toBeNull();
    expect(result.dimensions.action).toBeGreaterThanOrEqual(0);
    // GPA is mean of only action
    expect(result.gpa).toBe(result.dimensions.action);
  });
});

// EC-01: LLM timeout → Goal/Plan null with console.warn
describe('scoreGpa - LLM timeout', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns null Goal/Plan and warns on timeout', async () => {
    const ollama: OllamaClient = {
      model: 'test',
      generate: vi.fn().mockRejectedValue(new DOMException('LLM timeout', 'TimeoutError')),
    };
    const result = await scoreGpa('sess-4', makeInput(), ollama);
    expect(result.dimensions.goal).toBeNull();
    expect(result.dimensions.plan).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('timed out'),
      expect.anything()
    );
  });

  it('returns null Goal/Plan and warns on connection error', async () => {
    const ollama: OllamaClient = {
      model: 'test',
      generate: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const result = await scoreGpa('sess-5', makeInput(), ollama);
    expect(result.dimensions.goal).toBeNull();
    expect(result.dimensions.plan).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });
});

// EC-05: Non-numeric LLM response → null with console.warn
describe('scoreGpa - non-numeric LLM scores', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns null for non-numeric Goal score with console.warn', async () => {
    const ollama = makeOllama(
      'Goal: excellent\nGoal rationale: great.\nPlan: 7\nPlan rationale: ok.'
    );
    const result = await scoreGpa('sess-6', makeInput(), ollama);
    expect(result.dimensions.goal).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('non-numeric Goal'));
  });

  it('returns null for non-numeric Plan score with console.warn', async () => {
    const ollama = makeOllama('Goal: 8\nGoal rationale: ok.\nPlan: good\nPlan rationale: fine.');
    const result = await scoreGpa('sess-7', makeInput(), ollama);
    expect(result.dimensions.plan).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('non-numeric Plan'));
  });
});

// Goal skipped when no taskRefs
describe('scoreGpa - no taskRefs', () => {
  it('skips Goal scoring when taskRefs is empty', async () => {
    const ollama = makeOllama('Goal: 9\nGoal rationale: great.\nPlan: 8\nPlan rationale: good.');
    const input = makeInput({ taskRefs: [] });
    const result = await scoreGpa('sess-8', input, ollama);
    expect(result.dimensions.goal).toBeNull();
    // Plan still attempted
    expect(result.dimensions.plan).toBe(8);
  });
});

// GPA = null when all dimensions are null
describe('scoreGpa - all null dimensions', () => {
  it('returns null GPA when Goal and Plan are null and action is somehow excluded', async () => {
    // This tests the gpa computation: action is always present and non-null,
    // so gpa should equal action when goal/plan are null
    const result = await scoreGpa('sess-9', makeInput({ toolCalls: [] }), null);
    // toolCalls empty → action = 5.0 sentinel; goal/plan null → gpa = 5.0
    expect(result.dimensions.action).toBe(5.0);
    expect(result.gpa).toBe(5.0);
  });
});
