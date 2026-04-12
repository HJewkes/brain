import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AutoloopReport } from '../../../src/modules/autoloop/types.js';

vi.mock('../../../src/services/indexing.js', () => ({
  indexSingleFile: vi.fn().mockResolvedValue('mock-note-id'),
}));

import { generateReportNote } from '../../../src/modules/autoloop/engine/report-generator.js';
import type { BrainDB } from '../../../src/services/brain-db.js';
import type { BrainConfig } from '../../../src/types.js';
import type { Embedder } from '../../../src/types.js';

function makeReport(overrides: Partial<AutoloopReport> = {}): AutoloopReport {
  return {
    loopType: 'session-review',
    status: 'completed',
    startedAt: '2026-04-11T10:00:00.000Z',
    completedAt: '2026-04-11T10:05:00.000Z',
    durationMs: 300_000,
    sessionsReviewed: 3,
    insightsExtracted: 5,
    tasksUpdated: 0,
    notesCreated: 5,
    errors: [],
    ...overrides,
  };
}

describe('report-generator', () => {
  const testDir = join(tmpdir(), 'autoloop-report-gen-test');
  const mockDb = {} as BrainDB;
  const mockEmbedder = {} as Embedder;
  const mockConfig = { notesDir: testDir } as BrainConfig;

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    vi.clearAllMocks();
  });

  describe('generateReportNote', () => {
    it('creates a markdown report file', async () => {
      const report = makeReport();
      const result = await generateReportNote(mockDb, mockConfig, mockEmbedder, report);

      expect(result.noteId).toBe('mock-note-id');
      expect(result.filePath).toContain('report-session-review-2026-04-11');
      expect(result.filePath).toMatch(/\.md$/);

      const content = readFileSync(result.filePath, 'utf-8');
      expect(content).toContain('type: autoloop-report');
      expect(content).toContain('module: autoloop');
      expect(content).toContain('loop_type: session-review');
      expect(content).toContain('status: completed');
    });

    it('includes summary section with metrics', async () => {
      const report = makeReport({
        sessionsReviewed: 7,
        insightsExtracted: 12,
        tasksUpdated: 3,
        notesCreated: 10,
      });
      const result = await generateReportNote(mockDb, mockConfig, mockEmbedder, report);
      const content = readFileSync(result.filePath, 'utf-8');

      expect(content).toContain('**Sessions reviewed:** 7');
      expect(content).toContain('**Insights extracted:** 12');
      expect(content).toContain('**Tasks updated:** 3');
      expect(content).toContain('**Notes created:** 10');
    });

    it('includes termination reason when present', async () => {
      const report = makeReport({ terminationReason: 'Time limit exceeded' });
      const result = await generateReportNote(mockDb, mockConfig, mockEmbedder, report);
      const content = readFileSync(result.filePath, 'utf-8');

      expect(content).toContain('termination_reason: "Time limit exceeded"');
      expect(content).toContain('**Terminated:** Time limit exceeded');
    });

    it('includes details sections when provided', async () => {
      const report = makeReport({
        details: {
          sessionIds: ['s1', 's2'],
          sessionDisplayIds: ['session-001', 'session-002'],
          insightsByCategory: { pattern: 3, friction: 2 },
          frictionPatterns: ['retry loops', 'missing imports'],
          duplicatesFound: 1,
          duplicatePairs: [{ taskA: 'VNM-1.01', taskB: 'VNM-1.02', similarity: 0.92 }],
          enrichmentsSuggested: 2,
          enrichedTaskIds: ['VNM-2.01', 'VNM-2.02'],
        },
      });
      const result = await generateReportNote(mockDb, mockConfig, mockEmbedder, report);
      const content = readFileSync(result.filePath, 'utf-8');

      expect(content).toContain('## Sessions Reviewed');
      expect(content).toContain('- session-001');
      expect(content).toContain('- session-002');
      expect(content).toContain('## Insights by Category');
      expect(content).toContain('**pattern:** 3');
      expect(content).toContain('**friction:** 2');
      expect(content).toContain('## Friction Patterns');
      expect(content).toContain('- retry loops');
      expect(content).toContain('## Duplicates Found');
      expect(content).toContain('VNM-1.01 ↔ VNM-1.02');
      expect(content).toContain('## Enrichments');
      expect(content).toContain('- VNM-2.01');
    });

    it('includes errors section when present', async () => {
      const report = makeReport({ errors: ['Failed to parse session.jsonl', 'LLM timeout'] });
      const result = await generateReportNote(mockDb, mockConfig, mockEmbedder, report);
      const content = readFileSync(result.filePath, 'utf-8');

      expect(content).toContain('## Errors');
      expect(content).toContain('- Failed to parse session.jsonl');
      expect(content).toContain('- LLM timeout');
    });

    it('handles task-consolidation loop type', async () => {
      const report = makeReport({ loopType: 'task-consolidation' });
      const result = await generateReportNote(mockDb, mockConfig, mockEmbedder, report);
      const content = readFileSync(result.filePath, 'utf-8');

      expect(result.filePath).toContain('report-task-consolidation');
      expect(content).toContain('loop_type: task-consolidation');
      expect(content).toContain('Task Consolidation');
    });

    it('sets visibility to private', async () => {
      const result = await generateReportNote(mockDb, mockConfig, mockEmbedder, makeReport());
      const content = readFileSync(result.filePath, 'utf-8');

      expect(content).toContain('visibility: private');
    });
  });
});
