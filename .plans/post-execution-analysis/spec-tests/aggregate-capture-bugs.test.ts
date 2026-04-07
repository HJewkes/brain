/**
 * Spec tests for capture bug fixes CB-01 through CB-05.
 * These tests verify that aggregateSessionEvents() correctly populates
 * fields from live session_events rows (AC-01 through AC-05, EC-02).
 *
 * Tests MUST FAIL until aggregate.ts is updated to read these event types.
 */
import { describe, it, expect, vi } from 'vitest';
import { aggregateSessionEvents } from '../../../src/modules/sessions/engine/aggregate.js';

vi.mock('../../../src/services/config.js', () => ({
  loadConfig: vi
    .fn()
    .mockReturnValue({
      notesDir: '/tmp',
      dbPath: '/tmp/db',
      embedder: 'local',
      fusionWeights: { bm25: 0.3, vector: 0.7 },
    }),
}));

/** Build a minimal mock BrainDB whose session_events return the given rows.
 *
 * aggregateSessionEvents accesses db.db.prepare(...), so we nest accordingly.
 */
function makeMockDb(
  sessionId: string,
  events: Array<{ event_type: string; data: Record<string, unknown> }>
) {
  const ts = new Date().toISOString();
  const eventRows = events.map((e, i) => ({
    id: i + 1,
    session_id: sessionId,
    event_type: e.event_type,
    data: JSON.stringify(e.data),
    timestamp: ts,
  }));

  const innerDb = {
    prepare: vi.fn((_sql: string) => ({
      all: vi.fn().mockReturnValue(eventRows),
      get: vi.fn().mockReturnValue(eventRows[0] ?? null),
    })),
  };

  return { db: innerDb } as unknown;
}

describe('aggregateSessionEvents — capture bug fixes', () => {
  const SESSION_ID = 'test-session-001';

  it('AC-01: populates taskRefs from task_ref events (CB-01)', () => {
    const db = makeMockDb(SESSION_ID, [{ event_type: 'task_ref', data: { taskId: 'VNM-34.86' } }]);
    const analytics = aggregateSessionEvents(db, SESSION_ID);
    expect(analytics).not.toBeNull();
    expect(analytics!.taskRefs).toContain('VNM-34.86');
  });

  it('EC-02: deduplicates taskRefs when same task appears twice (CB-01)', () => {
    const db = makeMockDb(SESSION_ID, [
      { event_type: 'task_ref', data: { taskId: 'VNM-34.86' } },
      { event_type: 'task_ref', data: { taskId: 'VNM-34.86' } },
    ]);
    const analytics = aggregateSessionEvents(db, SESSION_ID);
    expect(analytics!.taskRefs.filter((r) => r === 'VNM-34.86')).toHaveLength(1);
  });

  it('AC-02: populates prLinks from pr:created events (CB-02)', () => {
    const db = makeMockDb(SESSION_ID, [
      { event_type: 'pr:created', data: { pr_url: 'https://github.com/foo/bar/pull/42' } },
    ]);
    const analytics = aggregateSessionEvents(db, SESSION_ID);
    expect(analytics!.prLinks).toHaveLength(1);
    expect(analytics!.prLinks[0].number).toBe(42);
    expect(analytics!.prLinks[0].repo).toBe('foo/bar');
    expect(analytics!.prLinks[0].url).toBe('https://github.com/foo/bar/pull/42');
  });

  it('AC-03: populates filesWritten from Write tool_call events (CB-03)', () => {
    const db = makeMockDb(SESSION_ID, [
      {
        event_type: 'tool_call',
        data: { toolName: 'Write', filePath: 'src/foo.ts', outcome: 'success' },
      },
    ]);
    const analytics = aggregateSessionEvents(db, SESSION_ID);
    expect(analytics!.filesWritten).toContain('src/foo.ts');
    expect(analytics!.filesTouched.get('src/foo.ts')).toContain('Write');
  });

  it('AC-04: populates skillUsage from skill_use events (CB-04)', () => {
    const db = makeMockDb(SESSION_ID, [
      { event_type: 'skill_use', data: { skillName: 'commit', count: 2 } },
    ]);
    const analytics = aggregateSessionEvents(db, SESSION_ID);
    expect(analytics!.skillUsage.get('commit')).toBe(2);
  });

  it('AC-05: sets planPresent=true from plan_present events (CB-05)', () => {
    const db = makeMockDb(SESSION_ID, [{ event_type: 'plan_present', data: {} }]);
    const analytics = aggregateSessionEvents(db, SESSION_ID);
    expect(analytics!.planPresent).toBe(true);
  });

  it('AC-05: planPresent remains false when no plan_present event exists', () => {
    // Use a non-empty event list so aggregateSessionEvents doesn't short-circuit to null
    const db = makeMockDb(SESSION_ID, [
      { event_type: 'tool_call', data: { toolName: 'Read', toolUseId: 't1', outcome: 'success' } },
    ]);
    const analytics = aggregateSessionEvents(db, SESSION_ID);
    expect(analytics!.planPresent).toBe(false);
  });
});
