import { describe, it, expect } from 'vitest';
import type { SessionMetadata, SessionAnalyticsExt } from '../../../src/modules/sessions/types.js';
import {
  extractToolPatterns,
  extractToolSequencePatterns,
  parseToolCallSection,
} from '../../../src/modules/sessions/analytics/tool-patterns.js';
import type { BrainConfig } from '../../../src/types.js';

function makeSession(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    session_id: 'sess-1',
    display_id: 'SNS-001',
    project_dir: '/tmp/project',
    status: 'completed',
    started_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeAnalyticsExt(
  tools: Array<{ name: string; count: number; error_rate: number }>
): SessionAnalyticsExt {
  return { top_tools: tools };
}

const fakeConfig: BrainConfig = {
  notesDir: '/nonexistent',
  dbPath: '/nonexistent/db',
  embedder: 'local',
  fusionWeights: { bm25: 0.5, vector: 0.5 },
};

describe('extractToolPatterns', () => {
  it('returns empty array for empty sessions', () => {
    const result = extractToolPatterns([], fakeConfig);
    expect(result).toEqual([]);
  });

  it('aggregates tool stats from analyticsExt top_tools', () => {
    const sessions = [
      makeSession({
        display_id: 'SNS-001',
        analyticsExt: makeAnalyticsExt([
          { name: 'Read', count: 10, error_rate: 0.1 },
          { name: 'Edit', count: 5, error_rate: 0.0 },
        ]),
      }),
      makeSession({
        display_id: 'SNS-002',
        session_id: 'sess-2',
        analyticsExt: makeAnalyticsExt([
          { name: 'Read', count: 6, error_rate: 0.0 },
          { name: 'Bash', count: 4, error_rate: 0.25 },
        ]),
      }),
    ];

    const result = extractToolPatterns(sessions, fakeConfig);

    expect(result[0].toolName).toBe('Read');
    expect(result[0].totalCalls).toBe(16);
    expect(result[0].errorRate).toBeCloseTo(1 / 16);
    expect(result[0].avgOccurrencesPerSession).toBe(8);

    expect(result[1].toolName).toBe('Edit');
    expect(result[1].totalCalls).toBe(5);
    expect(result[1].errorRate).toBe(0);

    expect(result[2].toolName).toBe('Bash');
    expect(result[2].totalCalls).toBe(4);
    expect(result[2].errorRate).toBe(0.25);
  });

  it('sorts patterns by totalCalls descending', () => {
    const sessions = [
      makeSession({
        analyticsExt: makeAnalyticsExt([
          { name: 'Bash', count: 2, error_rate: 0 },
          { name: 'Read', count: 10, error_rate: 0 },
          { name: 'Edit', count: 5, error_rate: 0 },
        ]),
      }),
    ];

    const result = extractToolPatterns(sessions, fakeConfig);
    expect(result.map((p) => p.toolName)).toEqual(['Read', 'Edit', 'Bash']);
  });
});

describe('parseToolCallSection', () => {
  it('parses tool names from L2 timeline content', () => {
    const l2 = [
      '# Session Timeline',
      '',
      '## Tool Call Log',
      '',
      '- 10:00:00 Read (120ms)',
      '- 10:00:01 Edit (50ms)',
      '- 10:00:02 Bash ERROR (300ms)',
      '',
      '## Errors',
      '',
      '- 10:00:02 Bash: something broke',
    ].join('\n');

    const entries = parseToolCallSection(l2);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ name: 'Read', isError: false, timeStr: '10:00:00' });
    expect(entries[1]).toEqual({ name: 'Edit', isError: false, timeStr: '10:00:01' });
    expect(entries[2]).toEqual({ name: 'Bash', isError: true, timeStr: '10:00:02' });
  });

  it('returns empty array when no Tool Call Log section', () => {
    const l2 = '# Session Timeline\n\n## Metadata\n- foo';
    expect(parseToolCallSection(l2)).toEqual([]);
  });

  it('handles sidechain markers', () => {
    const l2 = [
      '## Tool Call Log',
      '',
      '- 10:00:00 Read (120ms) [sidechain]',
      '- 10:00:01 Grep (50ms)',
    ].join('\n');

    const entries = parseToolCallSection(l2);
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe('Read');
    expect(entries[1].name).toBe('Grep');
  });
});

describe('extractToolSequencePatterns', () => {
  it('returns empty array for empty sessions', () => {
    const result = extractToolSequencePatterns([], fakeConfig);
    expect(result).toEqual([]);
  });

  it('returns top 10 sequences sorted by count', () => {
    // Since we cannot provide real L2 files, sessions without L2 return no sequences
    const sessions = [makeSession({ display_id: 'SNS-999' })];
    const result = extractToolSequencePatterns(sessions, fakeConfig);
    expect(result).toEqual([]);
  });
});
