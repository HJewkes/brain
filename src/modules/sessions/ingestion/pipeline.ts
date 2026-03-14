import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type { OllamaClient } from '../../../services/ollama.js';
import { parseSessionFile } from '../engine/parser.js';
import { generateSummaries, generateL2Timeline } from './summarizer.js';
import { computeSessionAnalyticsExt } from '../analytics/metrics.js';
import { detectLinks } from './linker.js';
import { createSession, linkSessionToTask } from '../data/session-ops.js';
import { IngestionState } from './state.js';
import { discoverSessions } from './discovery.js';
import type { DiscoveredSession, DiscoveryOptions } from './discovery.js';
import { sessionFileHash } from '../utils.js';
import { openSync, readSync, closeSync } from 'node:fs';

export interface IngestOptions {
  projectDir?: string;
  since?: Date;
  dryRun?: boolean;
  skipSummaries?: boolean;
  verbose?: boolean;
  claudeProjectsDir?: string;
}

export interface IngestReport {
  discovered: number;
  skipped: number;
  ingested: number;
  errors: Array<{ sessionId: string; error: string }>;
}

export async function runIngestionPipeline(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  ollama: OllamaClient | null,
  opts: IngestOptions
): Promise<IngestReport> {
  const report: IngestReport = { discovered: 0, skipped: 0, ingested: 0, errors: [] };
  const state = new IngestionState(db);

  const discoveryOpts: DiscoveryOptions = {
    projectDir: opts.projectDir,
    since: opts.since,
    claudeProjectsDir: opts.claudeProjectsDir,
  };

  const discovered = discoverSessions(discoveryOpts);
  report.discovered = discovered.length;

  for (const session of discovered) {
    if (state.hasSession(session.sessionId)) {
      report.skipped++;
      continue;
    }

    try {
      const wasIngested = await ingestOne(db, config, embedder, ollama, session, state, opts);
      if (wasIngested) report.ingested++;
      else report.skipped++;
    } catch (err) {
      report.errors.push({
        sessionId: session.sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return report;
}

async function ingestOne(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  ollama: OllamaClient | null,
  discovered: DiscoveredSession,
  state: IngestionState,
  opts: IngestOptions
): Promise<boolean> {
  // Parse
  const analytics = await parseSessionFile(discovered.filePath);

  // Skip trivial sessions
  if (analytics.userTurns < 2 && analytics.toolCalls.length === 0) return false;

  // Summarize
  let l0 = '';
  let l1 = '';
  if (!opts.skipSummaries) {
    const summaries = await generateSummaries(analytics, ollama);
    l0 = summaries.l0;
    l1 = summaries.l1;
  }

  // L2 generation (deterministic, always)
  const l2 = generateL2Timeline(analytics);

  // Analytics ext
  const analyticsExt = computeSessionAnalyticsExt(analytics);

  // Link detection
  const links = await detectLinks(db, analytics, config);

  // Compute duration
  const durationMinutes = Math.round(analytics.durationMs / 60000);

  // Create session note
  if (opts.dryRun) return true;

  const result = await createSession(db, config, embedder, {
    session_id: analytics.sessionId,
    project_dir: analytics.projectDir,
    status: 'completed',
    started_at: analytics.startTime,
    completed_at: analytics.endTime,
    duration_minutes: durationMinutes,
    branch: analytics.gitBranch ?? undefined,
    agent_model: analytics.model ?? undefined,
    compact_count: analytics.compactionCount,
    summary: l0,
    analytics: {
      total_turns: analytics.userTurns + analytics.assistantTurns,
      tool_calls: analytics.toolCalls.length,
      error_count: analytics.errorCount,
      tokens_input: analytics.tokens.inputTokens,
      tokens_output: analytics.tokens.outputTokens,
    },
    analyticsExt,
    tasks_worked: links.tasksWorked,
    tasks_completed: links.tasksCompleted,
    notes_created: links.notesCreated,
    commits: links.commits,
    l1Content: l1 || undefined,
    l2Content: l2 || undefined,
  });

  if (!result.ok) {
    // Record state even on duplicate so we don't retry
    if (result.error.code === 'DUPLICATE_SESSION') {
      state.upsertRecord({
        sessionId: analytics.sessionId,
        displayId: 'existing',
        ingestedAt: new Date().toISOString(),
        filePath: discovered.filePath,
        fileHash: 'duplicate',
        l2Indexed: false,
      });
    }
    return false;
  }

  // Create task relations
  for (const taskId of links.tasksWorked) {
    linkSessionToTask(db, result.data.display_id, taskId);
  }

  // Record ingestion state — read only first 4KB for hash
  const fd = openSync(discovered.filePath, 'r');
  const buf = Buffer.alloc(4096);
  const bytesRead = readSync(fd, buf, 0, 4096, 0);
  closeSync(fd);
  const hash = sessionFileHash(buf.subarray(0, bytesRead).toString('utf-8'));
  state.upsertRecord({
    sessionId: analytics.sessionId,
    displayId: result.data.display_id,
    ingestedAt: new Date().toISOString(),
    filePath: discovered.filePath,
    fileHash: hash,
    l2Indexed: discovered.fileSizeBytes < 2_000_000,
  });
  return true;
}
