import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { loadModules } from '../../../src/modules/loader.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { pmModule } from '../../../src/modules/pm/index.js';
import { createStandardProject } from '../../fixtures/pm-project.js';
import { createDecision, supersedeDecision } from '../../../src/modules/pm/data/decision-ops.js';
import { writePrompt } from '../../../src/modules/pm/data/prompt-ops.js';
import { updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';
import {
  runConsistencyCheck,
  findOrphanedDecisions,
  findBlockedWithoutCause,
  findCancelledDependencies,
  findStalePrompts,
  computeDecisionPairs,
  computeSupersessionGaps,
} from '../../../src/modules/pm/engine/consistency.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('pm-wave11'));
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `pm-wave11-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath: '',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await loadModules({ modules: [pmModule] });
  await createStandardProject(db, config, embedder);
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('Wave 11: Consistency Checks', () => {
  describe('runConsistencyCheck', () => {
    it('returns structural report for clean project', () => {
      const report = runConsistencyCheck(db, 'TEST', false);
      expect(report.project).toBe('TEST');
      expect(report.summary.totalTasks).toBe(6);
      expect(report.structural).toBeDefined();
      expect(report.semantic).toBeUndefined();
      expect(report.sourceDocuments).toBeUndefined();
    });

    it('returns deep report with semantic section', async () => {
      // Add a decision to make semantic section interesting
      await createDecision(db, config, embedder, {
        project: 'TEST',
        name: 'Use REST',
        sourceTask: 'TEST-01.01',
        impacts: ['TEST-01.01'],
        content: 'REST API',
      });

      const report = runConsistencyCheck(db, 'TEST', true);
      expect(report.semantic).toBeDefined();
      expect(report.sourceDocuments).toBeDefined();
    });
  });

  describe('structural: orphaned decisions', () => {
    it('detects decisions with empty impacts', async () => {
      await createDecision(db, config, embedder, {
        project: 'TEST',
        name: 'Orphan',
        sourceTask: 'TEST-01.01',
        impacts: [],
        content: 'No impacts',
      });

      const orphans = findOrphanedDecisions(db, 'TEST');
      expect(orphans).toHaveLength(1);
      expect(orphans[0].id).toBe('TEST-D01');
    });
  });

  describe('structural: cancelled dependencies', () => {
    it('detects tasks depending on cancelled tasks', async () => {
      // TEST-01.02 depends on TEST-01.01
      await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'cancelled');

      const cancelled = findCancelledDependencies(db, 'TEST');
      expect(cancelled.length).toBeGreaterThanOrEqual(1);
      const match = cancelled.find((c) => c.task === 'TEST-01.02');
      expect(match).toBeDefined();
      expect(match!.dependsOnStatus).toBe('cancelled');
    });
  });

  describe('structural: blocked without cause', () => {
    it('detects blocked tasks with all deps done', async () => {
      // Complete TEST-01.01, then block TEST-01.02
      await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
      await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
      await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done');
      await updateTaskStatus(db, config, embedder, 'TEST-01.02', 'blocked');

      const blocked = findBlockedWithoutCause(db, 'TEST');
      expect(blocked).toHaveLength(1);
      expect(blocked[0].id).toBe('TEST-01.02');
    });
  });

  describe('semantic: decision pairs', () => {
    it('finds decisions with overlapping impacts', async () => {
      await createDecision(db, config, embedder, {
        project: 'TEST',
        name: 'Approach A',
        sourceTask: 'TEST-01.01',
        impacts: ['TEST-01.01', 'TEST-01.02'],
        content: 'First approach',
      });
      await createDecision(db, config, embedder, {
        project: 'TEST',
        name: 'Approach B',
        sourceTask: 'TEST-01.01',
        impacts: ['TEST-01.01'],
        content: 'Second approach',
      });

      const pairs = computeDecisionPairs(db, 'TEST');
      expect(pairs).toHaveLength(1);
      expect(pairs[0].sharedImpacts).toContain('TEST-01.01');
    });
  });

  describe('semantic: supersession gaps', () => {
    it('detects decisions on same source task without formal supersession', async () => {
      await createDecision(db, config, embedder, {
        project: 'TEST',
        name: 'V1 Approach',
        sourceTask: 'TEST-01.01',
        impacts: ['TEST-01.01'],
        content: 'Version 1',
      });
      await new Promise((r) => setTimeout(r, 50));
      await createDecision(db, config, embedder, {
        project: 'TEST',
        name: 'V2 Approach',
        sourceTask: 'TEST-01.01',
        impacts: ['TEST-01.01'],
        content: 'Version 2',
      });

      const gaps = computeSupersessionGaps(db, 'TEST');
      expect(gaps).toHaveLength(1);
      expect(gaps[0].older.id).toBe('TEST-D01');
      expect(gaps[0].newer.id).toBe('TEST-D02');
    });

    it('excludes formally superseded decisions', async () => {
      await createDecision(db, config, embedder, {
        project: 'TEST',
        name: 'Old Approach',
        sourceTask: 'TEST-01.01',
        impacts: ['TEST-01.01'],
        content: 'Old way',
      });
      await new Promise((r) => setTimeout(r, 50));
      // Use the proper supersede flow
      await supersedeDecision(db, config, embedder, 'TEST-D01', {
        project: 'TEST',
        name: 'New Approach',
        sourceTask: 'TEST-01.01',
        impacts: ['TEST-01.01'],
        content: 'New way',
      });

      const gaps = computeSupersessionGaps(db, 'TEST');
      expect(gaps).toHaveLength(0);
    });
  });

  describe('stale prompts', () => {
    it('detects prompts older than impacting decisions', async () => {
      await writePrompt(db, config, embedder, {
        project: 'TEST',
        task: 'TEST-01.01',
        content: 'Original prompt',
      });
      await new Promise((r) => setTimeout(r, 50));
      await createDecision(db, config, embedder, {
        project: 'TEST',
        name: 'Changes everything',
        sourceTask: 'TEST-01.01',
        impacts: ['TEST-01.01'],
        content: 'Major change',
      });

      const stale = findStalePrompts(db, 'TEST');
      expect(stale).toHaveLength(1);
      expect(stale[0].newerDecisions).toHaveLength(1);
    });
  });

  describe('full report JSON shape', () => {
    it('produces valid JSON with all expected sections', async () => {
      // Create a scenario with multiple issue types
      await createDecision(db, config, embedder, {
        project: 'TEST',
        name: 'Orphan',
        sourceTask: 'TEST-01.01',
        impacts: [],
        content: 'Orphaned',
      });

      const report = runConsistencyCheck(db, 'TEST', true);

      // Verify JSON shape
      expect(report.project).toBe('TEST');
      expect(report.timestamp).toBeTruthy();
      expect(report.summary).toBeDefined();
      expect(report.summary.totalTasks).toBeGreaterThan(0);
      expect(report.summary.issuesFound).toBeGreaterThanOrEqual(1);
      expect(report.structural.orphanedDecisions).toHaveLength(1);
      expect(report.semantic).toBeDefined();

      // Verify it serializes cleanly
      const json = JSON.stringify(report);
      expect(() => JSON.parse(json)).not.toThrow();
    });
  });
});
