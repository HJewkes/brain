import { describe, it, expect } from 'vitest';
import {
  categorizeEvents,
  computeImpact,
  generateSteps,
  buildSuggestions,
  filterByCategory,
  formatSuggestions,
  buildJsonSuggestions,
} from '../../../../src/modules/workflow/commands/improve.js';
import type {
  Suggestion,
  ImprovementCategory,
} from '../../../../src/modules/workflow/commands/improve.js';
import type {
  FrictionEvent,
  FrictionAnalysis,
} from '../../../../src/modules/workflow/engine/friction-types.js';

function makeEvent(overrides: Partial<FrictionEvent> = {}): FrictionEvent {
  return {
    type: 'repeated_tool_failure',
    severity: 'medium',
    description: 'Test friction event',
    timestamp: '2026-03-14T10:30:00Z',
    context: {},
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<FrictionAnalysis> = {}): FrictionAnalysis {
  return {
    sessionId: 'test-session',
    events: [],
    score: 0,
    summary: 'No friction detected',
    ...overrides,
  };
}

describe('categorizeEvents', () => {
  it('groups events by improvement category', () => {
    const events = [
      makeEvent({ type: 'permission_denial' }),
      makeEvent({ type: 'hook_prevention' }),
      makeEvent({ type: 'repeated_tool_failure' }),
      makeEvent({ type: 'context_pressure' }),
    ];

    const grouped = categorizeEvents(events);

    expect(grouped.get('hooks')).toHaveLength(2);
    expect(grouped.get('infrastructure')).toHaveLength(1);
    expect(grouped.get('workflow')).toHaveLength(1);
  });

  it('returns empty map for no events', () => {
    const grouped = categorizeEvents([]);
    expect(grouped.size).toBe(0);
  });

  it('maps excessive_retry to prompts', () => {
    const events = [makeEvent({ type: 'excessive_retry' })];
    const grouped = categorizeEvents(events);
    expect(grouped.get('prompts')).toHaveLength(1);
  });

  it('maps error_loop to prompts', () => {
    const events = [makeEvent({ type: 'error_loop' })];
    const grouped = categorizeEvents(events);
    expect(grouped.get('prompts')).toHaveLength(1);
  });

  it('maps progress_stall to workflow', () => {
    const events = [makeEvent({ type: 'progress_stall' })];
    const grouped = categorizeEvents(events);
    expect(grouped.get('workflow')).toHaveLength(1);
  });

  it('maps agent_spawn_failure to infrastructure', () => {
    const events = [makeEvent({ type: 'agent_spawn_failure' })];
    const grouped = categorizeEvents(events);
    expect(grouped.get('infrastructure')).toHaveLength(1);
  });
});

describe('computeImpact', () => {
  it('returns high for critical events', () => {
    const events = [makeEvent({ severity: 'critical' })];
    expect(computeImpact(events)).toBe('high');
  });

  it('returns high for 5 or more events', () => {
    const events = Array.from({ length: 5 }, () => makeEvent({ severity: 'low' }));
    expect(computeImpact(events)).toBe('high');
  });

  it('returns medium for high-severity events', () => {
    const events = [makeEvent({ severity: 'high' })];
    expect(computeImpact(events)).toBe('medium');
  });

  it('returns medium for 3 or more events', () => {
    const events = Array.from({ length: 3 }, () => makeEvent({ severity: 'low' }));
    expect(computeImpact(events)).toBe('medium');
  });

  it('returns low for few low-severity events', () => {
    const events = [makeEvent({ severity: 'low' })];
    expect(computeImpact(events)).toBe('low');
  });
});

describe('generateSteps', () => {
  it('generates hook steps for permission denials', () => {
    const events = [makeEvent({ type: 'permission_denial' })];
    const steps = generateSteps('hooks', events);

    expect(steps.some((s) => s.includes('ownership'))).toBe(true);
    expect(steps.some((s) => s.includes('allowed-writes'))).toBe(true);
  });

  it('generates hook steps for hook preventions', () => {
    const events = [makeEvent({ type: 'hook_prevention' })];
    const steps = generateSteps('hooks', events);

    expect(steps.some((s) => s.includes('prevention'))).toBe(true);
  });

  it('generates prompt steps for excessive retries', () => {
    const events = [makeEvent({ type: 'excessive_retry' })];
    const steps = generateSteps('prompts', events);

    expect(steps.some((s) => s.includes('error messages'))).toBe(true);
  });

  it('generates prompt steps for error loops', () => {
    const events = [makeEvent({ type: 'error_loop' })];
    const steps = generateSteps('prompts', events);

    expect(steps.some((s) => s.includes('loop-breaking'))).toBe(true);
  });

  it('generates workflow steps for context pressure', () => {
    const events = [makeEvent({ type: 'context_pressure' })];
    const steps = generateSteps('workflow', events);

    expect(steps.some((s) => s.includes('sub-tasks'))).toBe(true);
  });

  it('generates workflow steps for progress stalls', () => {
    const events = [makeEvent({ type: 'progress_stall' })];
    const steps = generateSteps('workflow', events);

    expect(steps.some((s) => s.includes('progress tracking'))).toBe(true);
  });

  it('generates infrastructure steps for tool failures', () => {
    const events = [makeEvent({ type: 'repeated_tool_failure' })];
    const steps = generateSteps('infrastructure', events);

    expect(steps.some((s) => s.includes('health checks'))).toBe(true);
  });

  it('generates infrastructure steps for spawn failures', () => {
    const events = [makeEvent({ type: 'agent_spawn_failure' })];
    const steps = generateSteps('infrastructure', events);

    expect(steps.some((s) => s.includes('spawn prerequisites'))).toBe(true);
  });

  it('generates fallback steps when no specific patterns match', () => {
    const steps = generateSteps('hooks', []);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toContain('Review hook configuration');
  });
});

describe('buildSuggestions', () => {
  it('returns empty array for analysis with no events', () => {
    const analysis = makeAnalysis();
    expect(buildSuggestions(analysis)).toEqual([]);
  });

  it('generates suggestions grouped by category', () => {
    const analysis = makeAnalysis({
      events: [
        makeEvent({ type: 'permission_denial', severity: 'high' }),
        makeEvent({ type: 'repeated_tool_failure', severity: 'medium' }),
      ],
      score: 45,
    });

    const suggestions = buildSuggestions(analysis);

    expect(suggestions).toHaveLength(2);
    const categories = suggestions.map((s) => s.category);
    expect(categories).toContain('hooks');
    expect(categories).toContain('infrastructure');
  });

  it('sorts suggestions by impact descending', () => {
    const analysis = makeAnalysis({
      events: [
        makeEvent({ type: 'excessive_retry', severity: 'low' }),
        makeEvent({ type: 'permission_denial', severity: 'critical' }),
      ],
      score: 55,
    });

    const suggestions = buildSuggestions(analysis);

    expect(suggestions[0].impact).toBe('high');
    expect(suggestions[0].category).toBe('hooks');
  });

  it('includes source event count', () => {
    const analysis = makeAnalysis({
      events: [makeEvent({ type: 'permission_denial' }), makeEvent({ type: 'hook_prevention' })],
      score: 30,
    });

    const suggestions = buildSuggestions(analysis);
    const hookSuggestion = suggestions.find((s) => s.category === 'hooks');

    expect(hookSuggestion?.sourceEvents).toBe(2);
  });

  it('includes description with event type labels', () => {
    const analysis = makeAnalysis({
      events: [makeEvent({ type: 'context_pressure' })],
      score: 15,
    });

    const suggestions = buildSuggestions(analysis);

    expect(suggestions[0].description).toContain('context pressure');
    expect(suggestions[0].description).toContain('Workflow');
  });
});

describe('filterByCategory', () => {
  const suggestions: Suggestion[] = [
    {
      category: 'hooks',
      impact: 'high',
      description: 'Hook improvements',
      steps: ['Step 1'],
      sourceEvents: 2,
    },
    {
      category: 'prompts',
      impact: 'medium',
      description: 'Prompt improvements',
      steps: ['Step 1'],
      sourceEvents: 1,
    },
    {
      category: 'workflow',
      impact: 'low',
      description: 'Workflow improvements',
      steps: ['Step 1'],
      sourceEvents: 1,
    },
  ];

  it('filters to only matching category', () => {
    const filtered = filterByCategory(suggestions, 'hooks');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].category).toBe('hooks');
  });

  it('returns empty when no match', () => {
    const filtered = filterByCategory(suggestions, 'infrastructure');
    expect(filtered).toHaveLength(0);
  });

  it('returns all matching for a given category', () => {
    const withTwoHooks = [
      ...suggestions,
      {
        category: 'hooks' as ImprovementCategory,
        impact: 'low' as const,
        description: 'Another hook',
        steps: ['Step'],
        sourceEvents: 1,
      },
    ];
    const filtered = filterByCategory(withTwoHooks, 'hooks');
    expect(filtered).toHaveLength(2);
  });
});

describe('formatSuggestions', () => {
  it('shows no-suggestions message for empty input', () => {
    const output = formatSuggestions([]);
    expect(output).toContain('No improvement suggestions');
  });

  it('formats suggestions with numbered list', () => {
    const suggestions: Suggestion[] = [
      {
        category: 'hooks',
        impact: 'high',
        description: 'Hook improvements needed',
        steps: ['Review rules', 'Update config'],
        sourceEvents: 3,
      },
    ];

    const output = formatSuggestions(suggestions);

    expect(output).toContain('Improvement Suggestions (1)');
    expect(output).toContain('1. [HIGH] Hook improvements needed');
    expect(output).toContain('Category: hooks');
    expect(output).toContain('- Review rules');
    expect(output).toContain('- Update config');
  });

  it('formats multiple suggestions with correct numbering', () => {
    const suggestions: Suggestion[] = [
      {
        category: 'hooks',
        impact: 'high',
        description: 'First',
        steps: ['Step A'],
        sourceEvents: 1,
      },
      {
        category: 'prompts',
        impact: 'medium',
        description: 'Second',
        steps: ['Step B'],
        sourceEvents: 1,
      },
    ];

    const output = formatSuggestions(suggestions);

    expect(output).toContain('1. [HIGH] First');
    expect(output).toContain('2. [MEDIUM] Second');
  });
});

describe('buildJsonSuggestions', () => {
  it('returns structured JSON with friction score', () => {
    const analysis = makeAnalysis({ score: 42 });
    const suggestions: Suggestion[] = [
      {
        category: 'workflow',
        impact: 'medium',
        description: 'Workflow fix',
        steps: ['Do thing'],
        sourceEvents: 2,
      },
    ];

    const json = buildJsonSuggestions(suggestions, analysis);

    expect(json.frictionScore).toBe(42);
    expect(json.suggestionCount).toBe(1);
    expect(json.suggestions).toEqual(suggestions);
  });

  it('returns zero counts for empty suggestions', () => {
    const analysis = makeAnalysis({ score: 0 });
    const json = buildJsonSuggestions([], analysis);

    expect(json.frictionScore).toBe(0);
    expect(json.suggestionCount).toBe(0);
    expect(json.suggestions).toEqual([]);
  });
});
