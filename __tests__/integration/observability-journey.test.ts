/**
 * Observability journey integration tests (AC-16, AC-17).
 *
 * AC-16: Session quality scoring pipeline — events captured in DB flow through
 *   aggregation and produce a meaningful quality score without mocks.
 *
 * AC-17: Reference session regression detection — sessions marked as reference
 *   build a distribution; a degraded candidate session is flagged as regressed.
 *
 * Both tests exercise the real DB and real scoring functions end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../src/services/brain-db.js';
import { loadModules, runModuleMigrations } from '../../src/modules/loader.js';
import { createTestDb, createMockEmbedder } from '../helpers.js';
import { sessionsModule } from '../../src/modules/sessions/index.js';
import { captureSessionEvent } from '../../src/modules/sessions/hooks/capture-event.js';
import { aggregateSessionEvents } from '../../src/modules/sessions/engine/aggregate.js';
import {
  scoreSessionQuality,
  computeReferenceDistribution,
  compareToReference,
} from '../../src/modules/sessions/analytics/scorer.js';
import { listSessions, markSessionReference } from '../../src/modules/sessions/data/session-ops.js';

let db: BrainDB;
let notesDir: string;
const embedder = createMockEmbedder();

beforeEach(async () => {
  ({ db } = createTestDb());
  db.setEmbeddingModel(embedder.model, embedder.dimensions);

  notesDir = join(tmpdir(), `obs-journey-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });

  const { registry } = await loadModules({ modules: [sessionsModule] });
  runModuleMigrations(registry, db.rawDb, new Map());
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSessionId(): string {
  return randomUUID();
}

function insertToolCall(
  db: BrainDB,
  sessionId: string,
  outcome: 'success' | 'error',
  timestamp: string
): void {
  captureSessionEvent(db, {
    session_id: sessionId,
    event_type: 'tool_call',
    data: {
      toolName: 'Read',
      toolUseId: randomUUID(),
      outcome,
      isSidechain: false,
    },
    timestamp,
  });
}

function insertError(db: BrainDB, sessionId: string, timestamp: string): void {
  captureSessionEvent(db, {
    session_id: sessionId,
    event_type: 'error',
    data: { message: `error-${randomUUID()}`, toolName: 'Read' },
    timestamp,
  });
}

function insertFriction(
  db: BrainDB,
  sessionId: string,
  kind: 'error_loop' | 'consecutive_identical_tool',
  timestamp: string
): void {
  captureSessionEvent(db, {
    session_id: sessionId,
    event_type: 'friction',
    data: { kind, detail: `friction-${randomUUID()}` },
    timestamp,
  });
}

/**
 * Insert a minimal session note directly into the DB.
 * Bypasses the file-system-based `createSession` (which has a shared module-level
 * counter that persists between test cases) to guarantee unique display IDs.
 */
/**
 * Insert a minimal session note directly into the DB.
 * Bypasses the file-system-based `createSession` (which has a shared module-level
 * counter that persists between test cases) to guarantee unique display IDs.
 */
function insertSessionNote(db: BrainDB, sessionId: string, displayId: string): void {
  const noteId = `note-sess-${displayId.toLowerCase()}`;
  const now = new Date().toISOString().slice(0, 10);
  db.upsertNote({
    id: noteId,
    filePath: join(notesDir, 'modules', 'sessions', `${displayId}.md`),
    title: `Session ${displayId}`,
    type: 'session',
    tier: 'slow',
    category: null,
    tags: null,
    summary: null,
    confidence: null,
    status: null,
    sources: null,
    createdAt: now,
    modifiedAt: now,
    lastReviewed: null,
    reviewInterval: null,
    expires: null,
    module: 'sessions',
    moduleInstance: null,
    contentDir: null,
    l0Abstract: null,
    l1Overview: null,
    metadata: JSON.stringify({
      session_id: sessionId,
      display_id: displayId,
      project_dir: notesDir,
      status: 'completed',
      started_at: new Date().toISOString(),
    }),
  });
}

// ---------------------------------------------------------------------------
// AC-16: Session quality scoring end-to-end
// ---------------------------------------------------------------------------

describe('AC-16: session quality scoring pipeline', () => {
  it('aggregates tool_call events and produces a quality score', () => {
    const sessionId = makeSessionId();
    const base = '2026-01-01T00:00:';

    // 10 successful tool calls, 0 errors
    for (let i = 0; i < 10; i++) {
      insertToolCall(db, sessionId, 'success', `${base}${String(i).padStart(2, '0')}Z`);
    }
    captureSessionEvent(db, {
      session_id: sessionId,
      event_type: 'user_turn',
      data: { index: 0 },
      timestamp: `${base}00Z`,
    });
    captureSessionEvent(db, {
      session_id: sessionId,
      event_type: 'user_turn',
      data: { index: 1 },
      timestamp: `${base}01Z`,
    });

    const analytics = aggregateSessionEvents(db, sessionId);
    expect(analytics).not.toBeNull();
    expect(analytics!.toolCalls).toHaveLength(10);
    expect(analytics!.errorRate).toBe(0);
    expect(analytics!.userTurns).toBe(2);

    const score = scoreSessionQuality(analytics!);
    expect(score.overall).toBeGreaterThanOrEqual(0);
    expect(score.overall).toBeLessThanOrEqual(100);
    // Zero errors → perfect reliability
    expect(score.reliability).toBe(1);
    // No friction → perfect assurance
    expect(score.assurance).toBe(1);
    // No retries → perfect steadiness
    expect(score.steadiness).toBe(1);
  });

  it('error_loop friction lowers the steadiness dimension', () => {
    const sessionId = makeSessionId();
    const base = '2026-01-01T00:01:';

    for (let i = 0; i < 10; i++) {
      insertToolCall(db, sessionId, 'success', `${base}${String(i).padStart(2, '0')}Z`);
    }
    // 3 friction events of kind error_loop
    for (let i = 0; i < 3; i++) {
      insertFriction(db, sessionId, 'error_loop', `${base}${String(i + 10).padStart(2, '0')}Z`);
    }

    const analytics = aggregateSessionEvents(db, sessionId);
    expect(analytics!.frictionSignals).toHaveLength(3);

    const score = scoreSessionQuality(analytics!);
    // Retry density = 3/10 = 0.3; steadiness = 1 - 0.3*5 = max(0, -0.5) = 0
    expect(score.steadiness).toBe(0);
    // Assurance is also affected: frictionDensity = 3/10 = 0.3; 1 - 0.3*5 = -0.5 → 0
    expect(score.assurance).toBe(0);
  });

  it('high error rate lowers the reliability dimension', () => {
    const sessionId = makeSessionId();
    const base = '2026-01-01T00:02:';

    // 10 tool calls, 5 error events → errorRate = 5/10 = 0.5
    for (let i = 0; i < 10; i++) {
      insertToolCall(db, sessionId, 'success', `${base}${String(i).padStart(2, '0')}Z`);
    }
    for (let i = 10; i < 15; i++) {
      insertError(db, sessionId, `${base}${String(i).padStart(2, '0')}Z`);
    }

    const analytics = aggregateSessionEvents(db, sessionId);
    expect(analytics!.errorRate).toBe(0.5);

    const score = scoreSessionQuality(analytics!);
    expect(score.reliability).toBe(0.5);
  });

  it('returns null when no events exist for the session', () => {
    const result = aggregateSessionEvents(db, makeSessionId());
    expect(result).toBeNull();
  });

  it('exposes raw signals in the quality score', () => {
    const sessionId = makeSessionId();
    const base = '2026-01-01T00:03:';

    for (let i = 0; i < 20; i++) {
      insertToolCall(db, sessionId, 'success', `${base}${String(i).padStart(2, '0')}Z`);
    }

    const analytics = aggregateSessionEvents(db, sessionId)!;
    const score = scoreSessionQuality(analytics);

    expect(score.raw.toolCallCount).toBe(20);
    expect(score.raw.errorRate).toBe(0);
    expect(score.raw.frictionSignalCount).toBe(0);
    expect(score.raw.retryCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-17: Reference session regression detection end-to-end
// ---------------------------------------------------------------------------

describe('AC-17: reference session regression detection', () => {
  it('markSessionReference sets is_reference flag and listSessions filters correctly', () => {
    const sessionId = makeSessionId();
    const displayId = 'SNS-T01';
    insertSessionNote(db, sessionId, displayId);

    // Initially not a reference session
    const before = listSessions(db, { reference: true });
    expect(before.find((s) => s.display_id === displayId)).toBeUndefined();

    // Mark as reference
    const markResult = markSessionReference(db, displayId, true);
    expect(markResult.ok).toBe(true);
    expect(markResult.data?.is_reference).toBe(true);

    // Now shows up in reference list
    const after = listSessions(db, { reference: true });
    expect(after.find((s) => s.display_id === displayId)).toBeDefined();
  });

  it('unmark removes reference status', () => {
    const sessionId = makeSessionId();
    const displayId = 'SNS-T02';
    insertSessionNote(db, sessionId, displayId);

    markSessionReference(db, displayId, true);
    expect(listSessions(db, { reference: true })).toHaveLength(1);

    const unmarkResult = markSessionReference(db, displayId, false);
    expect(unmarkResult.ok).toBe(true);
    expect(unmarkResult.data?.is_reference).toBeUndefined();
    expect(listSessions(db, { reference: true })).toHaveLength(0);
  });

  it('markSessionReference fails for unknown display_id', () => {
    const result = markSessionReference(db, 'SNS-999', true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('flags a degraded session against good reference sessions (full pipeline)', () => {
    // Create 3 "good" reference sessions with events
    const refSessionIds: string[] = [];
    for (let r = 0; r < 3; r++) {
      const sessionId = makeSessionId();
      const displayId = `SNS-R0${r + 1}`;
      insertSessionNote(db, sessionId, displayId);
      markSessionReference(db, displayId, true);
      refSessionIds.push(sessionId);

      // Insert 20 clean tool calls per reference session
      const base = `2026-01-01T0${r}:00:`;
      for (let i = 0; i < 20; i++) {
        insertToolCall(db, sessionId, 'success', `${base}${String(i).padStart(2, '0')}Z`);
      }
    }

    // Score the reference sessions from their events
    const referenceSessions = listSessions(db, { reference: true });
    expect(referenceSessions).toHaveLength(3);

    const refScores = referenceSessions
      .map((s) => {
        const a = aggregateSessionEvents(db, s.session_id);
        return a ? scoreSessionQuality(a) : null;
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    expect(refScores).toHaveLength(3);

    const distribution = computeReferenceDistribution(refScores);
    expect(distribution).not.toBeNull();
    expect(distribution!.sampleSize).toBe(3);

    // Create a degraded candidate session: 50 calls, all errors, 10 friction events
    const badSessionId = makeSessionId();
    const badBase = '2026-01-01T10:00:';
    for (let i = 0; i < 50; i++) {
      insertToolCall(db, badSessionId, 'error', `${badBase}${String(i).padStart(2, '0')}Z`);
    }
    for (let i = 0; i < 10; i++) {
      insertFriction(
        db,
        badSessionId,
        'error_loop',
        `${badBase}${String(i + 50).padStart(2, '0')}Z`
      );
    }

    const badAnalytics = aggregateSessionEvents(db, badSessionId)!;
    const badScore = scoreSessionQuality(badAnalytics);
    const report = compareToReference(badScore, distribution!);

    expect(report.regressed).toBe(true);
    expect(report.zScore).toBeLessThan(-1.5);
    expect(report.message).toContain('regressed');
  });

  it('does not flag a comparable session against reference sessions', () => {
    // Create 3 reference sessions
    for (let r = 0; r < 3; r++) {
      const sessionId = makeSessionId();
      const displayId = `SNS-G0${r + 1}`;
      insertSessionNote(db, sessionId, displayId);
      markSessionReference(db, displayId, true);

      const base = `2026-01-01T0${r}:00:`;
      for (let i = 0; i < 15; i++) {
        insertToolCall(db, sessionId, 'success', `${base}${String(i).padStart(2, '0')}Z`);
      }
      // One error to give non-trivial but acceptable error rate
      insertToolCall(db, sessionId, 'error', `${base}15Z`);
    }

    const referenceSessions = listSessions(db, { reference: true });
    const refScores = referenceSessions
      .map((s) => {
        const a = aggregateSessionEvents(db, s.session_id);
        return a ? scoreSessionQuality(a) : null;
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    const distribution = computeReferenceDistribution(refScores)!;

    // Good candidate: similar profile to reference sessions
    const goodSessionId = makeSessionId();
    const goodBase = '2026-01-01T09:00:';
    for (let i = 0; i < 15; i++) {
      insertToolCall(db, goodSessionId, 'success', `${goodBase}${String(i).padStart(2, '0')}Z`);
    }
    insertToolCall(db, goodSessionId, 'error', `${goodBase}15Z`);

    const goodAnalytics = aggregateSessionEvents(db, goodSessionId)!;
    const goodScore = scoreSessionQuality(goodAnalytics);
    const report = compareToReference(goodScore, distribution);

    expect(report.regressed).toBe(false);
    expect(report.message).toContain('within reference bounds');
  });

  it('computeReferenceDistribution returns null with fewer than 2 scored sessions', () => {
    const sessionId = makeSessionId();
    insertSessionNote(db, sessionId, 'SNS-X01');
    const a = aggregateSessionEvents(db, sessionId);
    // No events → null analytics → empty scores array
    expect(a).toBeNull();

    const result = computeReferenceDistribution([]);
    expect(result).toBeNull();
  });
});
