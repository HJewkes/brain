import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectRecurringErrors } from '../../../src/modules/sessions/analytics/recurring-errors.js';
import type { SessionMetadata } from '../../../src/modules/sessions/types.js';
import type { BrainDB } from '../../../src/services/brain-db.js';
import type { BrainConfig } from '../../../src/types.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from 'node:fs';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

function makeSession(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    session_id: `sess-${Math.random().toString(36).slice(2, 8)}`,
    display_id: 'SNS-001',
    project_dir: '/tmp/project',
    status: 'completed',
    started_at: '2026-03-01T10:00:00Z',
    ...overrides,
  };
}

const mockDb = {} as BrainDB;
const mockConfig: BrainConfig = {
  notesDir: '/tmp/brain',
  dbPath: '/tmp/brain.db',
  embedder: 'ollama',
  fusionWeights: { bm25: 0.5, vector: 0.5 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('detectRecurringErrors', () => {
  it('returns empty for no sessions', () => {
    const result = detectRecurringErrors([], mockDb, mockConfig);

    expect(result).toEqual([]);
  });

  it('returns empty when no L2 files exist', () => {
    const sessions = [makeSession({ display_id: 'SNS-001' })];
    mockExistsSync.mockReturnValue(false);

    const result = detectRecurringErrors(sessions, mockDb, mockConfig);

    expect(result).toEqual([]);
  });

  it('returns empty for errors in only one session', () => {
    const sessions = [makeSession({ display_id: 'SNS-001' })];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      '## Errors\n- 10:00:00 Bash: Command failed with exit code 1\n'
    );

    const result = detectRecurringErrors(sessions, mockDb, mockConfig);

    expect(result).toEqual([]);
  });

  it('detects errors recurring across 2+ sessions', () => {
    const sessions = [
      makeSession({ display_id: 'SNS-001', started_at: '2026-03-01T10:00:00Z' }),
      makeSession({ display_id: 'SNS-002', started_at: '2026-03-02T10:00:00Z' }),
    ];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path) => {
      const p = path as string;
      if (p.includes('SNS-001')) {
        return '## Errors\n- 10:00:00 Bash: Command failed with exit code 1\n';
      }
      return '## Errors\n- 14:30:00 Bash: Command failed with exit code 1\n';
    });

    const result = detectRecurringErrors(sessions, mockDb, mockConfig);

    expect(result).toHaveLength(1);
    expect(result[0].toolName).toBe('Bash');
    expect(result[0].occurrences).toBe(2);
    expect(result[0].sessionIds).toContain('SNS-001');
    expect(result[0].sessionIds).toContain('SNS-002');
    expect(result[0].suggestion).toContain('Bash');
    expect(result[0].suggestion).toContain('2 sessions');
  });

  it('groups by tool name and normalized message', () => {
    const sessions = [
      makeSession({ display_id: 'SNS-001', started_at: '2026-03-01T10:00:00Z' }),
      makeSession({ display_id: 'SNS-002', started_at: '2026-03-02T10:00:00Z' }),
    ];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path) => {
      const p = path as string;
      if (p.includes('SNS-001')) {
        return [
          '## Errors',
          '- 10:00:00 Bash: Command failed with exit code 1',
          '- 10:05:00 Read: File not found: /tmp/foo.ts',
        ].join('\n');
      }
      return [
        '## Errors',
        '- 14:30:00 Bash: Command failed with exit code 1',
        '- 14:35:00 Edit: old_string not found in file',
      ].join('\n');
    });

    const result = detectRecurringErrors(sessions, mockDb, mockConfig);

    // Only Bash error recurs across sessions
    expect(result).toHaveLength(1);
    expect(result[0].toolName).toBe('Bash');
  });

  it('normalizes message to lowercase and first 80 chars', () => {
    const longMsg = 'A'.repeat(100);
    const sessions = [
      makeSession({ display_id: 'SNS-001', started_at: '2026-03-01T10:00:00Z' }),
      makeSession({ display_id: 'SNS-002', started_at: '2026-03-02T10:00:00Z' }),
    ];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path) => {
      const p = path as string;
      if (p.includes('SNS-001')) {
        return `## Errors\n- 10:00:00 Bash: ${longMsg}\n`;
      }
      // Same first 80 chars but different casing and suffix
      return `## Errors\n- 14:30:00 Bash: ${'a'.repeat(80)}DIFFERENT_SUFFIX\n`;
    });

    const result = detectRecurringErrors(sessions, mockDb, mockConfig);

    expect(result).toHaveLength(1);
    expect(result[0].pattern).toHaveLength(80);
  });

  it('stops parsing at next section heading', () => {
    const sessions = [
      makeSession({ display_id: 'SNS-001', started_at: '2026-03-01T10:00:00Z' }),
      makeSession({ display_id: 'SNS-002', started_at: '2026-03-02T10:00:00Z' }),
    ];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      [
        '## Errors',
        '- 10:00:00 Bash: real error',
        '## Tool Log',
        '- 10:05:00 Bash: this is not an error line',
      ].join('\n')
    );

    const result = detectRecurringErrors(sessions, mockDb, mockConfig);

    // "real error" recurs in both sessions
    expect(result).toHaveLength(1);
    expect(result[0].pattern).toContain('real error');
  });

  it('sorts results by occurrence count descending', () => {
    const sessions = [
      makeSession({ display_id: 'SNS-001', started_at: '2026-03-01T10:00:00Z' }),
      makeSession({ display_id: 'SNS-002', started_at: '2026-03-02T10:00:00Z' }),
      makeSession({ display_id: 'SNS-003', started_at: '2026-03-03T10:00:00Z' }),
    ];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path) => {
      const p = path as string;
      if (p.includes('SNS-001')) {
        return [
          '## Errors',
          '- 10:00:00 Read: File not found',
          '- 10:01:00 Bash: Command failed',
          '- 10:02:00 Bash: Command failed',
        ].join('\n');
      }
      if (p.includes('SNS-002')) {
        return [
          '## Errors',
          '- 10:00:00 Read: File not found',
          '- 10:01:00 Bash: Command failed',
        ].join('\n');
      }
      return [
        '## Errors',
        '- 10:00:00 Bash: Command failed',
        '- 10:01:00 Bash: Command failed',
      ].join('\n');
    });

    const result = detectRecurringErrors(sessions, mockDb, mockConfig);

    // Bash: Command failed has more occurrences (5) than Read: File not found (2)
    expect(result[0].toolName).toBe('Bash');
    expect(result[0].occurrences).toBe(5);
    expect(result[1].toolName).toBe('Read');
    expect(result[1].occurrences).toBe(2);
  });

  it('tracks firstSeen and lastSeen correctly', () => {
    const sessions = [
      makeSession({ display_id: 'SNS-001', started_at: '2026-03-01T10:00:00Z' }),
      makeSession({ display_id: 'SNS-002', started_at: '2026-03-05T10:00:00Z' }),
    ];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('## Errors\n- 10:00:00 Bash: oops\n');

    const result = detectRecurringErrors(sessions, mockDb, mockConfig);

    expect(result[0].firstSeen).toBe('2026-03-01T10:00:00Z');
    expect(result[0].lastSeen).toBe('2026-03-05T10:00:00Z');
  });
});
