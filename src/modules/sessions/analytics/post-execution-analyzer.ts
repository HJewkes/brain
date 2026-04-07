import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainService } from '../../../services/brain-service.js';
import type { SessionMetadata } from '../types.js';
import type { AgentGpaScore, GpaDimensions, GpaScoringInput } from './gpa-scorer.js';
import { scoreGpa } from './gpa-scorer.js';
import { getSkillCounter, updateSkillCounter } from './skill-counters.js';
import { getSessionBySessionId } from '../data/session-ops.js';
import { aggregateSessionEvents } from '../engine/aggregate.js';
import type { NoteRecord } from '../../../types.js';

export type { AgentGpaScore, GpaDimensions };

export interface PostExecutionResult {
  score: AgentGpaScore;
  notePath: string | null;
  skipped: boolean;
  skipReason?: string;
}

function findExistingAnalysisNote(db: BrainDB, sessionId: string): string | null {
  const noteIds = db.getModuleNoteIds({ module: 'sessions', type: 'analysis' });
  if (noteIds.length === 0) return null;
  const notes = db.getNotesByIds(noteIds);
  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.session_id === sessionId) {
      return note.filePath;
    }
  }
  return null;
}

function buildAnalysisNoteBody(
  score: AgentGpaScore,
  frictionSignals: Array<{ type: string }>,
  addEvolutionSuggestions: boolean
): string {
  const cappedFriction = frictionSignals.slice(0, 5); // NF-02

  const lines: string[] = [
    '## GPA Score',
    '',
    `- Goal: ${score.dimensions.goal != null ? score.dimensions.goal.toFixed(1) : 'N/A'}`,
    `- Plan: ${score.dimensions.plan != null ? score.dimensions.plan.toFixed(1) : 'N/A'}`,
    `- Action: ${score.dimensions.action.toFixed(1)}`,
    '',
    '## Rationale',
    '',
    `- Action: ${score.rationale.action}`,
  ];

  if (score.rationale.goal) lines.push(`- Goal: ${score.rationale.goal}`);
  if (score.rationale.plan) lines.push(`- Plan: ${score.rationale.plan}`);

  if (cappedFriction.length > 0) {
    lines.push('', '## Friction Signals (top 5)', '');
    for (const f of cappedFriction) {
      lines.push(`- ${f.type}`);
    }
  }

  if (addEvolutionSuggestions) {
    lines.push(
      '',
      '## Evolution Suggestions',
      '',
      '- Review friction patterns and address recurring error loops',
      '- Consider using more structured planning before execution',
      '- Reduce tool-call errors by validating inputs before submission'
    );
  }

  return lines.join('\n');
}

function writeAnalysisNote(
  db: BrainDB,
  sessionId: string,
  score: AgentGpaScore,
  frictionSignals: Array<{ type: string }>,
  outcome: string | null
): string {
  const slug = `session-analysis-${sessionId.replace(/[^a-z0-9]/gi, '-').slice(0, 32)}`;
  const now = new Date().toISOString().slice(0, 10);
  const addEvolution = score.dimensions.action < 6 && frictionSignals.length > 3;
  const body = buildAnalysisNoteBody(score, frictionSignals, addEvolution);
  const notePath = `__session-analysis__/${slug}.md`;

  const record: NoteRecord = {
    id: slug,
    filePath: notePath,
    title: `Session Analysis ${sessionId.slice(0, 16)}`,
    type: 'analysis',
    tier: 'fast',
    category: null,
    tags: null,
    summary: body.slice(0, 200),
    confidence: null,
    status: 'current',
    sources: null,
    createdAt: now,
    modifiedAt: now,
    lastReviewed: null,
    reviewInterval: null,
    expires: null,
    metadata: JSON.stringify({ session_id: sessionId, gpa: score.gpa, outcome }),
    module: 'sessions',
    moduleInstance: null,
    contentDir: null,
    l0Abstract: null,
    l1Overview: body,
  };

  db.upsertNote(record);
  return notePath;
}

/**
 * Build a GpaScoringInput from session note metadata (no live events required).
 * Used in --all mode for sessions that only have metadata available.
 */
export function sessionNoteMetaToScoringInput(meta: SessionMetadata): GpaScoringInput {
  const toolCallCount = meta.tool_calls ?? 0;
  const errorCount = meta.error_count ?? 0;
  const errorRate =
    meta.error_rate != null ? meta.error_rate : toolCallCount > 0 ? errorCount / toolCallCount : 0;

  // Reconstruct toolCalls array from count only (tool names not stored in metadata)
  const toolCalls = Array.from({ length: toolCallCount }, () => ({ tool: 'unknown' }));

  return {
    errorRate,
    frictionSignals: [],
    toolCalls,
    taskRefs: meta.tasks_worked ?? [],
    planPresent: meta.plan_id != null,
    outcome: meta.outcome ?? null,
    assistantTexts: meta.summary ? [meta.summary] : [],
  };
}

/**
 * Run the GPA post-execution analysis pipeline for a session.
 * Scores the session on Goal/Plan/Action dimensions, persists an analysis note,
 * updates skill counters, and returns the result.
 * Pass `force: true` to overwrite an existing analysis.
 */
export async function runPostExecutionAnalysis(
  svc: BrainService,
  sessionId: string,
  taskDescription?: string,
  opts?: { force?: boolean }
): Promise<PostExecutionResult> {
  // EC-03: Idempotency — skip if analysis note already exists
  const existing = findExistingAnalysisNote(svc.db, sessionId);
  if (existing && !opts?.force) {
    const placeholderScore: AgentGpaScore = {
      sessionId,
      gpa: null,
      dimensions: { goal: null, plan: null, action: 5 },
      rationale: { action: 'skipped — already analyzed' },
      scoredAt: new Date().toISOString(),
    };
    return {
      score: placeholderScore,
      notePath: existing,
      skipped: true,
      skipReason: 'already analyzed',
    };
  }

  // Attempt live event aggregation; fall back to stored metadata
  const analytics = aggregateSessionEvents(svc.db, sessionId);
  let input: GpaScoringInput;
  let frictionSignals: Array<{ type: string }> = [];
  let skillUsage: Map<string, number> = new Map();
  let outcome: string | null = null;

  if (analytics) {
    frictionSignals = analytics.frictionSignals.slice(0, 5).map((f) => ({ type: f.kind }));
    skillUsage = analytics.skillUsage;
    input = {
      errorRate: analytics.errorRate,
      frictionSignals: analytics.frictionSignals.map((f) => ({ type: f.kind })),
      toolCalls: analytics.toolCalls.slice(0, 50).map((t) => ({ tool: t.toolName })), // NF-02
      taskRefs: analytics.taskRefs,
      planPresent: analytics.planPresent,
      outcome,
      assistantTexts: analytics.assistantTexts.slice(0, 5),
    };
  } else {
    const meta = getSessionBySessionId(svc.db, sessionId);
    if (!meta) {
      throw new Error(`Session ${sessionId} not found`);
    }
    outcome = meta.outcome ?? null;
    input = sessionNoteMetaToScoringInput(meta);
  }

  // Inject taskDescription into taskRefs if provided and not already present
  if (taskDescription && !input.taskRefs.includes(taskDescription)) {
    input = { ...input, taskRefs: [taskDescription, ...input.taskRefs] };
  }

  const score = await scoreGpa(sessionId, input, null);

  const notePath = writeAnalysisNote(svc.db, sessionId, score, frictionSignals, outcome);

  // Update skill counters (one increment per skill used this session)
  const success = score.dimensions.action >= 5;
  for (const [skillName] of skillUsage) {
    const counter = getSkillCounter(svc.db, skillName);
    updateSkillCounter(svc.db, skillName, counter.version, { success, gpa: score.gpa });
  }

  return { score, notePath, skipped: false };
}
