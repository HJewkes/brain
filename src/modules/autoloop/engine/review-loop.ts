import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type { OllamaClient } from '../../../services/ollama.js';
import type { AutoloopReport, AutoloopBounds } from '../types.js';
import { checkBounds, createCounters, loadBounds } from './bounds.js';
import { findUnreviewedSessions, readSessionTranscript } from './discovery.js';
import { extractInsights, type InsightSet } from './insight-extractor.js';
import { generateInsightNotes } from './note-generator.js';
import { recordAutoloopRun } from './run-tracker.js';

export interface ReviewLoopOptions {
  bounds?: Partial<AutoloopBounds>;
  maxSessions?: number;
  minAgeHours?: number;
  cwd?: string;
}

export async function runSessionReviewLoop(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  ollama: OllamaClient,
  opts?: ReviewLoopOptions
): Promise<AutoloopReport> {
  const bounds = { ...loadBounds(opts?.cwd), ...opts?.bounds };
  const counters = createCounters();
  const maxSessions = opts?.maxSessions ?? 10;
  const errors: string[] = [];
  const insightSets: InsightSet[] = [];

  const unreviewedSessions = findUnreviewedSessions(db, {
    minAgeHours: opts?.minAgeHours ?? 1,
  });

  const sessionsToReview = unreviewedSessions.slice(0, maxSessions);

  if (sessionsToReview.length === 0) {
    return buildReport(counters, 'completed', 0, 0, 0, 0, errors);
  }

  let sessionsReviewed = 0;

  for (const session of sessionsToReview) {
    const boundCheck = checkBounds(bounds, counters);
    if (boundCheck.exceeded) {
      return buildReport(
        counters,
        'partial',
        sessionsReviewed,
        insightSets.reduce((n, s) => n + s.insights.length, 0),
        0,
        counters.notesCreated,
        errors,
        boundCheck.reason
      );
    }

    try {
      const transcript = await readSessionTranscript(session.filePath, {
        maxTokenEstimate: 6000,
      });

      if (transcript.length < 3) {
        sessionsReviewed++;
        continue;
      }

      const insights = await extractInsights(
        ollama,
        transcript,
        session.sessionId,
        session.sessionId.slice(0, 8),
        counters
      );

      if (insights.insights.length > 0) {
        insightSets.push(insights);
      }

      sessionsReviewed++;
    } catch (err) {
      errors.push(
        `Session ${session.sessionId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Generate notes from accumulated insights
  let notesCreated = 0;
  if (insightSets.length > 0) {
    try {
      const generated = await generateInsightNotes(
        db,
        config,
        embedder,
        insightSets,
        counters
      );
      notesCreated = generated.length;
    } catch (err) {
      errors.push(`Note generation: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const totalInsights = insightSets.reduce((n, s) => n + s.insights.length, 0);

  // Record the run for cooldown tracking
  const report = buildReport(
    counters,
    errors.length > 0 ? 'partial' : 'completed',
    sessionsReviewed,
    totalInsights,
    0,
    notesCreated,
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
    loopType: 'session-review',
    status,
    startedAt: new Date(counters.startedAt).toISOString(),
    completedAt: new Date(now).toISOString(),
    durationMs: now - counters.startedAt,
    sessionsReviewed,
    insightsExtracted,
    tasksUpdated,
    notesCreated,
    terminationReason,
    errors,
  };
}
