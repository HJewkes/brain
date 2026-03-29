import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type { AutoloopReport, AutoloopBounds } from '../types.js';
import { checkBounds, createCounters, loadBounds } from './bounds.js';
import { scanTaskQuality } from './quality-scanner.js';
import { enrichUnderSpecifiedTasks } from './task-enricher.js';
import { recordAutoloopRun } from './run-tracker.js';

export interface ConsolidationLoopOptions {
  bounds?: Partial<AutoloopBounds>;
  project?: string;
  workstream?: number;
  cwd?: string;
}

export async function runTaskConsolidationLoop(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  opts?: ConsolidationLoopOptions
): Promise<AutoloopReport> {
  const bounds = { ...loadBounds(opts?.cwd), ...opts?.bounds };
  const counters = createCounters();
  const errors: string[] = [];
  const project = opts?.project ?? process.env.BRAIN_PM_PROJECT ?? 'VNM';

  // Phase 1: Scan task quality
  const qualityReport = scanTaskQuality(db, {
    project,
    workstream: opts?.workstream,
    status: 'pending',
  });

  if (qualityReport.totalScanned === 0) {
    return buildReport(counters, 'completed', 0, 0, 0, 0, errors);
  }

  const boundCheck = checkBounds(bounds, counters);
  if (boundCheck.exceeded) {
    return buildReport(counters, 'partial', 0, 0, 0, 0, errors, boundCheck.reason);
  }

  // Phase 2: Enrich under-specified tasks
  let tasksEnriched = 0;
  if (qualityReport.underSpecified.length > 0) {
    try {
      const enrichment = await enrichUnderSpecifiedTasks(
        db,
        embedder,
        qualityReport.underSpecified,
        { maxTasks: bounds.maxTaskModifications }
      );
      tasksEnriched = enrichment.tasksEnriched;
      counters.taskModifications += tasksEnriched;
    } catch (err) {
      errors.push(`Enrichment: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const report = buildReport(
    counters,
    errors.length > 0 ? 'partial' : 'completed',
    qualityReport.totalScanned,
    0,
    tasksEnriched,
    0,
    errors
  );

  recordAutoloopRun(db, report);

  return report;
}

function buildReport(
  counters: { startedAt: number; notesCreated: number },
  status: AutoloopReport['status'],
  sessionsReviewed: number,
  insightsExtracted: number,
  tasksUpdated: number,
  notesCreated: number,
  errors: string[],
  terminationReason?: string
): AutoloopReport {
  const now = Date.now();
  return {
    loopType: 'task-consolidation',
    status,
    startedAt: new Date(counters.startedAt).toISOString(),
    completedAt: new Date(now).toISOString(),
    durationMs: now - counters.startedAt,
    sessionsReviewed,
    insightsExtracted,
    tasksUpdated,
    notesCreated: counters.notesCreated,
    terminationReason,
    errors,
  };
}
