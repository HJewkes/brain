import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  agentsMigrationV1,
  agentsMigrationV2,
  agentsMigrationV3,
  agentsMigrationV4,
} from '../../../src/modules/agents/schema.js';
import {
  recordDelivery,
  signalDelivery,
  readAndClearHumanSignal,
  getDeliveryForTask,
  type DeliveryRecord,
} from '../../../src/modules/agents/delivery.js';

// Avoid pulling in real spawn/template machinery; we stub every agent call.
vi.mock('../../../src/modules/workflow/engine/templates.js', () => ({
  renderTemplate: vi.fn(() => ({ ok: false, error: new Error('no template') })),
}));

vi.mock('../../../src/utils/db.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/utils/db.js')>(
    '../../../src/utils/db.js'
  );
  return { ...actual, sleep: vi.fn(() => Promise.resolve()) };
});

// Stub out child_process.spawn so the review/fixup agent helpers never
// actually launch the `claude` binary. Each stub child exits immediately
// with an empty stdout payload. execFileSync is left intact — it's only
// used by review-agent helpers inside try/catch fallbacks.
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: vi.fn(() => {
      const child = {
        stdin: { write: vi.fn(), end: vi.fn() },
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
          if (event === 'exit') queueMicrotask(() => cb(0));
          return child;
        }),
      };
      return child as unknown as ReturnType<typeof actual.spawn>;
    }),
  };
});

// Helper: build a bare delivery row with only the fields the gate cares about.
function makeDelivery(
  db: Database.Database,
  overrides: Partial<DeliveryRecord> = {}
): DeliveryRecord {
  const agentId = overrides.agent_id ?? 'agent-human-1';
  const taskId = overrides.task_id ?? 'VNM-56.30';
  const branch = overrides.branch ?? 'agent/VNM-56/VNM-56.30';
  const status = (overrides.status ?? 'pr-open') as DeliveryRecord['status'];
  db.prepare(
    `INSERT INTO agents (id, name, parent, status, created_at, context)
     VALUES (?, ?, 'orchestrator', 'active', ?, '{}')`
  ).run(agentId, `agent-for-${taskId}`, new Date().toISOString());
  recordDelivery(db, agentId, {
    status,
    task_id: taskId,
    branch,
    pr_number: 101,
    pr_url: `https://github.com/example/repo/pull/101`,
  });
  return getDeliveryForTask(db, taskId)!;
}

describe('signalDelivery / readAndClearHumanSignal', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    agentsMigrationV1.up(db);
    agentsMigrationV2.up(db);
    agentsMigrationV3.up(db);
    agentsMigrationV4.up(db);
  });

  afterEach(() => {
    db.close();
  });

  it('writes approve signal and returns ok result when delivery is review-paused', () => {
    const delivery = makeDelivery(db, { status: 'review-paused' });
    const result = signalDelivery(db, 'VNM-56.30', 'approve');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.delivery.agent_id).toBe(delivery.agent_id);
    expect(result.delivery.human_signal).toBe('approve');

    const reloaded = getDeliveryForTask(db, 'VNM-56.30');
    expect(reloaded!.human_signal).toBe('approve');
  });

  it('writes needs_fixes signal when delivery is review-paused', () => {
    makeDelivery(db, { status: 'review-paused' });
    const result = signalDelivery(db, 'VNM-56.30', 'needs_fixes');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.delivery.human_signal).toBe('needs_fixes');
  });

  it('returns not-found when no delivery exists for taskId', () => {
    const result = signalDelivery(db, 'NOPE-99.99', 'approve');
    expect(result).toEqual({ ok: false, reason: 'not-found' });
  });

  it('returns not-paused and does not write when delivery is not review-paused', () => {
    const delivery = makeDelivery(db); // defaults to pr-open
    const result = signalDelivery(db, 'VNM-56.30', 'approve');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('not-paused');
    if (result.reason !== 'not-paused') throw new Error('expected not-paused');
    expect(result.delivery.agent_id).toBe(delivery.agent_id);
    expect(result.delivery.status).toBe('pr-open');

    const reloaded = getDeliveryForTask(db, 'VNM-56.30');
    expect(reloaded!.human_signal).toBeNull();
  });

  it('rejects invalid signals', () => {
    makeDelivery(db, { status: 'review-paused' });
    expect(() => signalDelivery(db, 'VNM-56.30', 'maybe' as unknown as 'approve')).toThrow(
      /Invalid human signal/
    );
  });

  it('readAndClearHumanSignal returns null when no signal is set', () => {
    const delivery = makeDelivery(db, { status: 'review-paused' });
    expect(readAndClearHumanSignal(db, delivery.agent_id)).toBeNull();
  });

  it('readAndClearHumanSignal returns the signal and clears it', () => {
    const delivery = makeDelivery(db, { status: 'review-paused' });
    signalDelivery(db, 'VNM-56.30', 'approve');

    const first = readAndClearHumanSignal(db, delivery.agent_id);
    expect(first).toBe('approve');

    const second = readAndClearHumanSignal(db, delivery.agent_id);
    expect(second).toBeNull();
  });
});

describe('runHumanReviewGate', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    agentsMigrationV1.up(db);
    agentsMigrationV2.up(db);
    agentsMigrationV3.up(db);
    agentsMigrationV4.up(db);
    // Inbox table — minimal schema matching what delivery-review's INSERT expects.
    db.exec(`
      CREATE TABLE inbox (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        title TEXT,
        source TEXT NOT NULL,
        source_url TEXT,
        source_meta TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        processed_at TEXT
      )
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('approves on first human signal, returns approved result and resumes to pr-open', async () => {
    const delivery = makeDelivery(db, { status: 'review-paused' });
    const { runHumanReviewGate } = await import('../../../src/modules/agents/delivery-review.js');

    // Pre-seed the approve signal so the poll returns immediately.
    signalDelivery(db, delivery.task_id!, 'approve');

    const result = await runHumanReviewGate(
      db,
      delivery,
      'reviewer-agent-1',
      3,
      'Verdict: NEEDS WORK\nRisk: 3\n\n## Key Findings\nAuth flow is risky.\n\n## Files of Interest\nsrc/auth/token.ts\n',
      '/tmp/project',
      0
    );

    expect(result.approved).toBe(true);
    expect(result.escalated).toBe(true);
    expect(result.reviewAgentId).toBe('reviewer-agent-1');

    // Delivery should be back to pr-open for the monitor to handle.
    const final = getDeliveryForTask(db, delivery.task_id!);
    expect(final!.status).toBe('pr-open');
    expect(final!.review_agent_id).toBe('reviewer-agent-1');

    // Inbox item should have been created.
    const inbox = db.prepare('SELECT * FROM inbox').all() as Array<{
      content: string;
      source: string;
      source_meta: string;
      status: string;
    }>;
    expect(inbox).toHaveLength(1);
    expect(inbox[0].source).toBe('api');
    expect(inbox[0].content).toMatch(/Review Required/);
    expect(inbox[0].content).toMatch(/Risk Score.*3/);
    expect(inbox[0].content).toMatch(/brain agent approve VNM-56.30/);
    const meta = JSON.parse(inbox[0].source_meta) as Record<string, unknown>;
    expect(meta.action).toBe('review-requested');
    expect(meta.taskId).toBe('VNM-56.30');
  });

  it('transitions to stalled with review-rejected after two rejections', async () => {
    const delivery = makeDelivery(db);
    const { runHumanReviewGate } = await import('../../../src/modules/agents/delivery-review.js');

    // Drive the poll: on each sleep tick, write a needs_fixes signal directly
    // via SQL (bypasses the status guard so the test doesn't depend on the
    // internal transition order).
    const originalSleep = await import('../../../src/utils/db.js');
    vi.mocked(originalSleep.sleep).mockImplementation(async () => {
      db.prepare('UPDATE delivery_states SET human_signal = ? WHERE agent_id = ?').run(
        'needs_fixes',
        delivery.agent_id
      );
    });

    const result = await runHumanReviewGate(
      db,
      delivery,
      'reviewer-agent-1',
      4,
      '## Key Findings\nNeeds work.',
      '/tmp/project',
      0
    );

    expect(result.approved).toBe(false);
    expect(result.escalated).toBe(true);
    // After two rejections the gate stalls the delivery so crash recovery
    // doesn't re-process it.
    const final = getDeliveryForTask(db, delivery.task_id!);
    expect(final!.status).toBe('stalled');
    expect(final!.stall_reason).toBe('review-rejected');

    // Two inbox notifications — one per cycle.
    const rows = db.prepare(`SELECT source_meta FROM inbox ORDER BY created_at`).all() as Array<{
      source_meta: string;
    }>;
    expect(rows).toHaveLength(2);
    const actions = rows.map((r) => (JSON.parse(r.source_meta) as { action: string }).action);
    expect(actions).toEqual(['review-requested', 'review-re-requested']);
  });

  it('transitions to stalled with review-timeout when no signal arrives before deadline', async () => {
    const delivery = makeDelivery(db);
    const { runHumanReviewGate } = await import('../../../src/modules/agents/delivery-review.js');

    // Freeze Date.now via a spy so we can deterministically march past the
    // 7-day deadline. Each sleep() tick advances the clock by 8 days, which
    // exceeds the gate's timeout on the first poll.
    let fakeNow = new Date('2026-04-22T00:00:00Z').getTime();
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);

    const originalSleep = await import('../../../src/utils/db.js');
    vi.mocked(originalSleep.sleep).mockImplementation(async () => {
      fakeNow += 8 * 24 * 60 * 60 * 1000;
    });

    const result = await runHumanReviewGate(
      db,
      delivery,
      'reviewer-agent-1',
      2,
      '## Key Findings\nMinor.',
      '/tmp/project',
      0
    );

    expect(result.approved).toBe(false);
    expect(result.escalated).toBe(true);

    const final = getDeliveryForTask(db, delivery.task_id!);
    expect(final!.status).toBe('stalled');
    expect(final!.stall_reason).toBe('review-timeout');
  });
});
