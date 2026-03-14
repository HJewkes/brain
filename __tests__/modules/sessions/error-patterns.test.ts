import { describe, it, expect } from 'vitest';
import type { SessionMetadata } from '../../../src/modules/sessions/types.js';
import {
  extractErrorPatterns,
  extractCorrectionPatterns,
  parseErrorsFromL2,
  parseFrictionsFromL2,
} from '../../../src/modules/sessions/analytics/error-patterns.js';
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

const fakeConfig: BrainConfig = {
  notesDir: '/nonexistent',
  dbPath: '/nonexistent/db',
  embedder: 'local',
  fusionWeights: { bm25: 0.5, vector: 0.5 },
};

describe('parseErrorsFromL2', () => {
  it('parses error entries from L2 content', () => {
    const l2 = [
      '## Tool Call Log',
      '',
      '- 10:00:00 Read (120ms)',
      '',
      '## Errors',
      '',
      '- 10:00:02 Bash: Command failed with exit code 1',
      '- 10:00:05 Edit: File not found: /tmp/missing.ts',
      '',
      '## Friction Signals',
      '',
      '- error_loop: Repeated Bash failures',
    ].join('\n');

    const errors = parseErrorsFromL2(l2);
    expect(errors).toHaveLength(2);
    expect(errors[0].toolName).toBe('Bash');
    expect(errors[0].messagePrefix).toBe('Command failed with exit code 1');
    expect(errors[1].toolName).toBe('Edit');
    expect(errors[1].messagePrefix).toBe('File not found: /tmp/missing.ts');
  });

  it('returns empty array when no Errors section', () => {
    const l2 = '## Tool Call Log\n\n- 10:00:00 Read\n\n## Metadata\n';
    expect(parseErrorsFromL2(l2)).toEqual([]);
  });

  it('truncates message prefix to 100 chars', () => {
    const longMsg = 'x'.repeat(200);
    const l2 = `## Errors\n\n- 10:00:00 Bash: ${longMsg}\n`;
    const errors = parseErrorsFromL2(l2);
    expect(errors[0].messagePrefix).toHaveLength(100);
  });
});

describe('parseFrictionsFromL2', () => {
  it('parses friction kinds from L2 content', () => {
    const l2 = [
      '## Friction Signals',
      '',
      '- error_loop: Repeated Bash failures',
      '- user_correction: User redirected approach',
      '- error_loop: Another loop detected',
    ].join('\n');

    const kinds = parseFrictionsFromL2(l2);
    expect(kinds).toEqual(['error_loop', 'user_correction', 'error_loop']);
  });

  it('returns empty array when no Friction Signals section', () => {
    const l2 = '## Tool Call Log\n\n## Metadata\n';
    expect(parseFrictionsFromL2(l2)).toEqual([]);
  });
});

describe('extractErrorPatterns', () => {
  it('returns empty array for empty sessions', () => {
    const result = extractErrorPatterns([], fakeConfig);
    expect(result).toEqual([]);
  });

  it('returns empty when L2 files do not exist', () => {
    const sessions = [makeSession({ display_id: 'SNS-999' })];
    const result = extractErrorPatterns(sessions, fakeConfig);
    expect(result).toEqual([]);
  });
});

describe('extractCorrectionPatterns', () => {
  it('returns empty array for empty sessions', () => {
    const result = extractCorrectionPatterns([], fakeConfig);
    expect(result).toEqual([]);
  });

  it('falls back to analyticsExt friction_categories when no L2 file', () => {
    const sessions = [
      makeSession({
        display_id: 'SNS-999',
        analyticsExt: {
          friction_categories: [
            { category: 'error_loop', count: 3 },
            { category: 'user_correction', count: 1 },
          ],
        },
      }),
      makeSession({
        display_id: 'SNS-998',
        session_id: 'sess-2',
        analyticsExt: {
          friction_categories: [{ category: 'error_loop', count: 2 }],
        },
      }),
    ];

    const result = extractCorrectionPatterns(sessions, fakeConfig);

    const errorLoop = result.find((p) => p.kind === 'error_loop');
    expect(errorLoop).toBeDefined();
    expect(errorLoop!.occurrences).toBe(5);
    expect(errorLoop!.sessionCount).toBe(2);

    const correction = result.find((p) => p.kind === 'user_correction');
    expect(correction).toBeDefined();
    expect(correction!.occurrences).toBe(1);
    expect(correction!.sessionCount).toBe(1);
  });

  it('sorts by occurrences descending', () => {
    const sessions = [
      makeSession({
        display_id: 'SNS-999',
        analyticsExt: {
          friction_categories: [
            { category: 'user_correction', count: 1 },
            { category: 'error_loop', count: 5 },
          ],
        },
      }),
    ];

    const result = extractCorrectionPatterns(sessions, fakeConfig);
    expect(result[0].kind).toBe('error_loop');
    expect(result[1].kind).toBe('user_correction');
  });
});
