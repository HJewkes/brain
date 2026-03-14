import { describe, it, expect } from 'vitest';
import {
  buildReport,
  computeTopPatterns,
  computeTrend,
  formatReport,
} from '../../../../src/modules/workflow/commands/report.js';
import type {
  FrictionAnalysis,
  FrictionEvent,
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

describe('buildReport', () => {
  it('generates report from multiple sessions', () => {
    const analyses = [
      makeAnalysis({ sessionId: 's1', score: 20, events: [makeEvent()] }),
      makeAnalysis({ sessionId: 's2', score: 40, events: [makeEvent({ severity: 'high' })] }),
      makeAnalysis({ sessionId: 's3', score: 10, events: [] }),
    ];

    const report = buildReport(analyses, '7d');

    expect(report.sessionsAnalyzed).toBe(3);
    expect(report.avgFrictionScore).toBe(23);
    expect(report.periodLabel).toBe('7d');
    expect(report.topPatterns.length).toBeGreaterThan(0);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it('handles empty data', () => {
    const report = buildReport([], '7d');

    expect(report.sessionsAnalyzed).toBe(0);
    expect(report.avgFrictionScore).toBe(0);
    expect(report.trend).toBe('insufficient_data');
    expect(report.topPatterns).toEqual([]);
    expect(report.recommendations).toContain(
      'No session data available. Run some sessions to generate observations.'
    );
  });

  it('generates high friction recommendation when score >= 50', () => {
    const analyses = [
      makeAnalysis({
        score: 80,
        events: [makeEvent({ severity: 'critical' }), makeEvent({ severity: 'high' })],
      }),
    ];

    const report = buildReport(analyses, '1d');

    expect(report.avgFrictionScore).toBe(80);
    expect(report.recommendations).toContain(
      'High friction detected. Consider reviewing workflow patterns.'
    );
  });
});

describe('computeTopPatterns', () => {
  it('groups events by type and sorts by frequency', () => {
    const analyses = [
      makeAnalysis({
        events: [
          makeEvent({ type: 'repeated_tool_failure' }),
          makeEvent({ type: 'repeated_tool_failure' }),
          makeEvent({ type: 'permission_denial', severity: 'high' }),
        ],
      }),
    ];

    const patterns = computeTopPatterns(analyses);

    expect(patterns[0].type).toBe('repeated_tool_failure');
    expect(patterns[0].count).toBe(2);
    expect(patterns[1].type).toBe('permission_denial');
    expect(patterns[1].count).toBe(1);
  });

  it('limits to top 5 patterns', () => {
    const events: FrictionEvent[] = [
      makeEvent({ type: 'repeated_tool_failure' }),
      makeEvent({ type: 'permission_denial' }),
      makeEvent({ type: 'excessive_retry' }),
      makeEvent({ type: 'context_pressure' }),
      makeEvent({ type: 'progress_stall' }),
      makeEvent({ type: 'agent_spawn_failure' }),
      makeEvent({ type: 'hook_prevention' }),
    ];
    const analyses = [makeAnalysis({ events })];

    const patterns = computeTopPatterns(analyses);

    expect(patterns.length).toBe(5);
  });

  it('returns empty array for no events', () => {
    const analyses = [makeAnalysis({ events: [] })];
    const patterns = computeTopPatterns(analyses);
    expect(patterns).toEqual([]);
  });
});

describe('computeTrend', () => {
  it('returns insufficient_data for fewer than 4 sessions', () => {
    const analyses = [
      makeAnalysis({ score: 10 }),
      makeAnalysis({ score: 20 }),
      makeAnalysis({ score: 30 }),
    ];

    expect(computeTrend(analyses)).toBe('insufficient_data');
  });

  it('detects improving trend when second half scores lower', () => {
    const analyses = [
      makeAnalysis({ score: 40 }),
      makeAnalysis({ score: 50 }),
      makeAnalysis({ score: 20 }),
      makeAnalysis({ score: 10 }),
    ];

    expect(computeTrend(analyses)).toBe('improving');
  });

  it('detects worsening trend when second half scores higher', () => {
    const analyses = [
      makeAnalysis({ score: 10 }),
      makeAnalysis({ score: 15 }),
      makeAnalysis({ score: 40 }),
      makeAnalysis({ score: 50 }),
    ];

    expect(computeTrend(analyses)).toBe('worsening');
  });

  it('detects stable trend when scores are similar', () => {
    const analyses = [
      makeAnalysis({ score: 20 }),
      makeAnalysis({ score: 22 }),
      makeAnalysis({ score: 21 }),
      makeAnalysis({ score: 23 }),
    ];

    expect(computeTrend(analyses)).toBe('stable');
  });
});

describe('formatReport', () => {
  it('formats text output with all sections', () => {
    const report = buildReport(
      [
        makeAnalysis({
          score: 30,
          events: [makeEvent(), makeEvent({ type: 'permission_denial', severity: 'high' })],
        }),
      ],
      '7d'
    );

    const output = formatReport(report);

    expect(output).toContain('Workflow Report (7d)');
    expect(output).toContain('Sessions analyzed: 1');
    expect(output).toContain('Average friction score: 30/100');
    expect(output).toContain('Trend:');
    expect(output).toContain('Top Friction Patterns:');
    expect(output).toContain('Recommendations:');
  });

  it('formats empty report without patterns section', () => {
    const report = buildReport([], '7d');
    const output = formatReport(report);

    expect(output).toContain('Sessions analyzed: 0');
    expect(output).toContain('Average friction score: 0/100');
    expect(output).not.toContain('Top Friction Patterns:');
    expect(output).toContain('Recommendations:');
  });
});

describe('JSON output', () => {
  it('produces valid JSON structure', () => {
    const analyses = [
      makeAnalysis({ score: 25, events: [makeEvent()] }),
      makeAnalysis({ score: 35, events: [makeEvent({ severity: 'high' })] }),
    ];

    const report = buildReport(analyses, '7d');
    const json = JSON.stringify(report);
    const parsed = JSON.parse(json);

    expect(parsed.sessionsAnalyzed).toBe(2);
    expect(parsed.avgFrictionScore).toBe(30);
    expect(parsed.periodLabel).toBe('7d');
    expect(parsed.topPatterns).toBeInstanceOf(Array);
    expect(parsed.trend).toBeDefined();
    expect(parsed.recommendations).toBeInstanceOf(Array);
  });
});
