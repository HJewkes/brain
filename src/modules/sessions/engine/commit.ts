import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type { OllamaClient } from '../../../services/ollama.js';
import type { SessionMetadata } from '../types.js';
import type { Result } from '../errors.js';
import { ok, fail } from '../errors.js';
import { getSessionBySessionId } from '../data/session-ops.js';
import { createSession, linkSessionToTask } from '../data/session-ops.js';
import { aggregateSessionEvents, getSessionChunkContents } from './aggregate.js';
import { parseSessionFile } from './parser.js';
import { generateSummaries, generateL2Timeline } from '../ingestion/summarizer.js';
import { computeSessionAnalyticsExt } from '../analytics/metrics.js';
import { detectLinks } from '../ingestion/linker.js';
import { discoverSessions } from '../ingestion/discovery.js';

export interface CommitOptions {
  skipSummaries?: boolean;
  jsonlPath?: string;
}

export async function commitSession(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  sessionId: string,
  ollama: OllamaClient | null,
  opts?: CommitOptions
): Promise<Result<SessionMetadata>> {
  // Idempotent: if already committed, return existing
  const existing = getSessionBySessionId(db, sessionId);
  if (existing) {
    return ok(existing);
  }

  // Path A: try live events from session_events table
  const analytics = aggregateSessionEvents(db, sessionId);

  if (analytics) {
    return commitFromAnalytics(db, config, embedder, ollama, analytics, opts);
  }

  // Path B: fall back to JSONL file
  return commitFromJsonl(db, config, embedder, sessionId, ollama, opts);
}

async function commitFromAnalytics(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  ollama: OllamaClient | null,
  analytics: import('../types.js').SessionAnalytics,
  opts?: CommitOptions
): Promise<Result<SessionMetadata>> {
  const analyticsExt = computeSessionAnalyticsExt(analytics);
  const links = await detectLinks(db, analytics, config);

  let l0 = '';
  let l1 = '';
  if (!opts?.skipSummaries) {
    const summaries = await generateSummaries(analytics, ollama);
    l0 = summaries.l0;
    l1 = summaries.l1;
  }

  // If no L1 from LLM, use micro-summaries from session_chunks
  if (!l1) {
    const chunks = getSessionChunkContents(db, analytics.sessionId);
    if (chunks.length > 0) {
      l1 = chunks.join('\n\n---\n\n');
    }
  }

  const l2 = generateL2Timeline(analytics);
  const durationMinutes = Math.round(analytics.durationMs / 60000);

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
    return fail('INVALID_INPUT', result.error.message);
  }

  for (const taskId of links.tasksWorked) {
    linkSessionToTask(db, result.data.display_id, taskId);
  }

  // Return the created session metadata
  const created = getSessionBySessionId(db, analytics.sessionId);
  if (!created) {
    return fail('NOT_FOUND', 'Session was created but could not be retrieved');
  }
  return ok(created);
}

async function commitFromJsonl(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  sessionId: string,
  ollama: OllamaClient | null,
  opts?: CommitOptions
): Promise<Result<SessionMetadata>> {
  // Find the JSONL file
  let jsonlPath = opts?.jsonlPath;
  if (!jsonlPath) {
    const discovered = discoverSessions();
    const match = discovered.find((d) => d.sessionId === sessionId);
    if (!match) {
      return fail('NOT_FOUND', `No JSONL file found for session ${sessionId}`);
    }
    jsonlPath = match.filePath;
  }

  const analytics = await parseSessionFile(jsonlPath);

  // Skip trivial sessions
  if (analytics.userTurns < 2 && analytics.toolCalls.length === 0) {
    return fail('INVALID_INPUT', 'Session too trivial to commit');
  }

  return commitFromAnalytics(db, config, embedder, ollama, analytics, opts);
}
