import { describe, it, expect, vi } from 'vitest';
import type { RunRecord } from '../../../src/modules/autoloop/engine/run-tracker.js';
import { formatRunHistory } from '../../../src/modules/autoloop/engine/history-formatter.js';
import type { BrainDB } from '../../../src/services/brain-db.js';

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 1,
    loopType: 'session-review',
    status: 'completed',
    startedAt: '2026-04-11T10:00:00.000Z',
    completedAt: '2026-04-11T10:05:00.000Z',
    durationMs: 300_000,
    reportNoteId: null,
    ...overrides,
  };
}

describe('history-formatter', () => {
  const mockDb = {
    getNoteById: vi.fn().mockReturnValue(null),
  } as unknown as BrainDB;

  describe('formatRunHistory', () => {
    it('shows empty message when no runs exist', () => {
      const output = formatRunHistory([], { detail: false, db: mockDb });
      expect(output).toContain('No autoloop runs recorded yet');
    });

    it('formats summary view with one-liner per run', () => {
      const runs = [
        makeRun({ loopType: 'session-review', status: 'completed', durationMs: 300_000 }),
        makeRun({
          id: 2,
          loopType: 'task-consolidation',
          status: 'partial',
          startedAt: '2026-04-10T08:00:00.000Z',
          durationMs: 120_000,
        }),
      ];

      const output = formatRunHistory(runs, { detail: false, db: mockDb });
      expect(output).toContain('Autoloop Run History');
      expect(output).toContain('review');
      expect(output).toContain('completed');
      expect(output).toContain('5m');
      expect(output).toContain('consolidate');
      expect(output).toContain('partial');
      expect(output).toContain('2m');
      expect(output).toContain('2 run(s) shown');
      expect(output).toContain('--detail');
    });

    it('formats date as YYYY-MM-DD HH:MM in summary', () => {
      const runs = [makeRun({ startedAt: '2026-04-11T10:30:00.000Z' })];
      const output = formatRunHistory(runs, { detail: false, db: mockDb });
      expect(output).toContain('2026-04-11 10:30');
    });

    it('shows ? for missing duration in summary', () => {
      const runs = [makeRun({ durationMs: null })];
      const output = formatRunHistory(runs, { detail: false, db: mockDb });
      expect(output).toContain('?');
    });

    it('formats detail view with run metadata', () => {
      const runs = [
        makeRun({
          loopType: 'session-review',
          status: 'completed',
          startedAt: '2026-04-11T10:00:00.000Z',
          completedAt: '2026-04-11T10:05:00.000Z',
          durationMs: 300_000,
        }),
      ];

      const output = formatRunHistory(runs, { detail: true, db: mockDb });
      expect(output).toContain('Session Review');
      expect(output).toContain('Started:');
      expect(output).toContain('2026-04-11T10:00:00.000Z');
      expect(output).toContain('Finished:');
      expect(output).toContain('Status:   completed');
      expect(output).toContain('Duration: 5m');
    });

    it('omits finished line when completedAt is null', () => {
      const runs = [makeRun({ completedAt: null })];
      const output = formatRunHistory(runs, { detail: true, db: mockDb });
      expect(output).not.toContain('Finished:');
    });

    it('omits duration line when durationMs is null', () => {
      const runs = [makeRun({ durationMs: null })];
      const output = formatRunHistory(runs, { detail: true, db: mockDb });
      expect(output).not.toContain('Duration:');
    });
  });
});
