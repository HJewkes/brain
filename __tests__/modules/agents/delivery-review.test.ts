import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { DeliveryRecord } from '../../../src/modules/agents/delivery.js';
import {
  runDeliveryReview,
  parseRiskScore,
  runHumanReviewGate,
  type ReviewDeps,
  type ReviewRunOutput,
} from '../../../src/modules/agents/delivery-review.js';
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
// with an empty stdout payload.
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

function makeDelivery(_overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    agent_id: 'agent-1',
    task_id: 'VNM-56.29',
    branch: 'agent/VNM-56/VNM-56.29',
    status: 'pr-open',
    pr_number: 42,
    pr_url: 'https://github.com/owner/repo/pull/42',
    pr_merged_at: null,
    delivered_at: null,
    retry_count: 0,
    session_id: null,
    review_tier: null,
    review_score: null,
    fix_attempts: 0,
    review_agent_id: null,
    stall_reason: null,
    human_signal: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeSimpleDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE delivery_states (
      agent_id     TEXT PRIMARY KEY,
      task_id      TEXT NOT NULL,
      branch       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'in-progress',
      pr_number    INTEGER,
      pr_url       TEXT,
      pr_merged_at TEXT,
      delivered_at TEXT,
      retry_count  INTEGER NOT NULL DEFAULT 0,
      session_id   TEXT,
      review_tier  TEXT,
      review_score INTEGER,
      review_agent_id TEXT,
      stall_reason TEXT,
      human_signal TEXT,
      fix_attempts INTEGER DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO delivery_states (agent_id, task_id, branch, status)
      VALUES ('agent-1', 'VNM-56.29', 'agent/VNM-56/VNM-56.29', 'pr-open');
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
    );
  `);
  return db;
}

function makeDeps(overrides: Partial<ReviewDeps> = {}): ReviewDeps {
  return {
    runReview: vi.fn(
      async () => ({ agentId: 'review-agent', output: '', success: true }) as ReviewRunOutput
    ),
    runFixup: vi.fn(
      async () => ({ agentId: 'fixup-agent', output: '', success: true }) as ReviewRunOutput
    ),
    ...overrides,
  };
}

function review(
  output: string,
  opts: { success?: boolean; agentId?: string } = {}
): ReviewRunOutput {
  return {
    agentId: opts.agentId ?? 'review-agent',
    output,
    success: opts.success ?? true,
  };
}

// Seed an approve signal so the human gate returns immediately for escalation tests.
function seedApproveSignal(db: Database.Database, agentId: string): void {
  db.prepare('UPDATE delivery_states SET human_signal = ? WHERE agent_id = ?').run(
    'approve',
    agentId
  );
}

describe('parseRiskScore', () => {
  it('extracts risk score from agent output', () => {
    expect(parseRiskScore('### Risk: 3')).toBe(3);
    expect(parseRiskScore('Risk Score: 5')).toBe(5);
    expect(parseRiskScore('Risk Level: 1\nOther text')).toBe(1);
  });

  it('returns 0 when no risk score is present', () => {
    expect(parseRiskScore('No risk info here')).toBe(0);
    expect(parseRiskScore('')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(parseRiskScore('risk: 4')).toBe(4);
    expect(parseRiskScore('RISK SCORE: 2')).toBe(2);
  });
});

describe('runDeliveryReview', () => {
  it('ci-only returns approved immediately without dispatching agents', async () => {
    const db = makeSimpleDb();
    const deps = makeDeps();

    const result = await runDeliveryReview(db, makeDelivery(), 'ci-only', '/tmp/project', deps);

    expect(result).toEqual({
      approved: true,
      riskScore: 0,
      escalated: false,
      fixupIterations: 0,
      reviewAgentId: '',
    });
    expect(deps.runReview).not.toHaveBeenCalled();
    expect(deps.runFixup).not.toHaveBeenCalled();
    db.close();
  });

  it('ci-only persists review_tier', async () => {
    const db = makeSimpleDb();
    await runDeliveryReview(db, makeDelivery(), 'ci-only', '/tmp/project', makeDeps());

    const row = db
      .prepare('SELECT review_tier FROM delivery_states WHERE agent_id = ?')
      .get('agent-1') as { review_tier: string | null };
    expect(row.review_tier).toBe('ci-only');
    db.close();
  });

  it('ai-review approves on PASS verdict with low risk', async () => {
    const db = makeSimpleDb();
    const deps = makeDeps({
      runReview: vi.fn(async () => review('Verdict: PASS\nRisk: 2', { agentId: 'r1' })),
    });

    const result = await runDeliveryReview(db, makeDelivery(), 'ai-review', '/tmp/project', deps);

    expect(result.approved).toBe(true);
    expect(result.escalated).toBe(false);
    expect(result.riskScore).toBe(2);
    expect(result.reviewAgentId).toBe('r1');
    db.close();
  });

  it('escalates to human gate when risk >= 4 even if verdict says PASS', async () => {
    const db = makeSimpleDb();
    seedApproveSignal(db, 'agent-1');
    const deps = makeDeps({
      runReview: vi.fn(async () => review('Verdict: PASS\nRisk Score: 5', { agentId: 'r1' })),
    });

    const result = await runDeliveryReview(db, makeDelivery(), 'ai-review', '/tmp/project', deps);

    expect(result.riskScore).toBe(5);
    expect(result.escalated).toBe(true);
    // Approved because we seeded the approve signal
    expect(result.approved).toBe(true);
    db.close();
  });

  it('escalates to human gate when subprocess fails', async () => {
    const db = makeSimpleDb();
    seedApproveSignal(db, 'agent-1');
    const deps = makeDeps({
      runReview: vi.fn(async () => review('', { success: false, agentId: 'failed-r1' })),
    });

    const result = await runDeliveryReview(db, makeDelivery(), 'ai-review', '/tmp/project', deps);

    expect(result.escalated).toBe(true);
    expect(result.reviewAgentId).toBe('failed-r1');
    db.close();
  });

  it('human-review tier always routes to human gate', async () => {
    const db = makeSimpleDb();
    seedApproveSignal(db, 'agent-1');
    const deps = makeDeps({
      runReview: vi.fn(async () => review('Verdict: PASS\nRisk: 1', { agentId: 'r1' })),
    });

    const result = await runDeliveryReview(
      db,
      makeDelivery(),
      'human-review',
      '/tmp/project',
      deps
    );

    expect(result.escalated).toBe(true);
    db.close();
  });

  it('needs_fixes runs fixup loop and approves when re-review passes', async () => {
    const db = makeSimpleDb();
    const runReview = vi
      .fn()
      .mockResolvedValueOnce(review('Verdict: NEEDS WORK\nRisk: 2', { agentId: 'r1' }))
      .mockResolvedValueOnce(review('Verdict: PASS\nRisk: 2', { agentId: 'r2' }));
    const runFixup = vi.fn(async () => review('', { agentId: 'f1' }));
    const deps: ReviewDeps = { runReview, runFixup };

    const result = await runDeliveryReview(db, makeDelivery(), 'ai-review', '/tmp/project', deps);

    expect(result.approved).toBe(true);
    expect(result.fixupIterations).toBe(1);
    expect(result.reviewAgentId).toBe('r2');
    expect(runFixup).toHaveBeenCalledTimes(1);
    expect(runReview).toHaveBeenCalledTimes(2);
    db.close();
  });

  it('fixup loop escalates to human gate after exhausting MAX_FIXUP_ITERATIONS', async () => {
    const db = makeSimpleDb();
    seedApproveSignal(db, 'agent-1');
    const runReview = vi.fn(async () => review('Verdict: NEEDS WORK\nRisk: 2', { agentId: 'r' }));
    const runFixup = vi.fn(async () => review('', { agentId: 'f' }));
    const deps: ReviewDeps = { runReview, runFixup };

    const result = await runDeliveryReview(db, makeDelivery(), 'ai-review', '/tmp/project', deps);

    expect(result.escalated).toBe(true);
    expect(result.fixupIterations).toBe(3);
    expect(runFixup).toHaveBeenCalledTimes(3);
    expect(runReview).toHaveBeenCalledTimes(4);
    db.close();
  });

  it('persists review_score from every review iteration', async () => {
    const db = makeSimpleDb();
    const runReview = vi
      .fn()
      .mockResolvedValueOnce(review('Verdict: NEEDS WORK\nRisk: 2', { agentId: 'r1' }))
      .mockResolvedValueOnce(review('Verdict: PASS\nRisk: 3', { agentId: 'r2' }));
    const runFixup = vi.fn(async () => review('', { agentId: 'f' }));
    const deps: ReviewDeps = { runReview, runFixup };

    await runDeliveryReview(db, makeDelivery(), 'ai-review', '/tmp/project', deps);

    const row = db
      .prepare('SELECT review_score FROM delivery_states WHERE agent_id = ?')
      .get('agent-1') as { review_score: number | null };
    expect(row.review_score).toBe(3);
    db.close();
  });

  it('persists review_tier, review_score, and review_agent_id on approval', async () => {
    const db = makeSimpleDb();
    const deps = makeDeps({
      runReview: vi.fn(async () => review('Verdict: PASS\nRisk: 2', { agentId: 'reviewer-42' })),
    });

    await runDeliveryReview(db, makeDelivery(), 'ai-review', '/tmp/project', deps);

    const row = db
      .prepare(
        'SELECT review_tier, review_score, review_agent_id FROM delivery_states WHERE agent_id = ?'
      )
      .get('agent-1') as {
      review_tier: string | null;
      review_score: number | null;
      review_agent_id: string | null;
    };
    expect(row.review_tier).toBe('ai-review');
    expect(row.review_score).toBe(2);
    expect(row.review_agent_id).toBe('reviewer-42');
    db.close();
  });

  it('tolerates missing review columns (pre-V4 schema)', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE delivery_states (
        agent_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        status TEXT NOT NULL
      );
      INSERT INTO delivery_states VALUES ('agent-1', 'VNM-56.29', 'branch', 'pr-open');
    `);

    const result = await runDeliveryReview(
      db,
      makeDelivery(),
      'ci-only',
      '/tmp/project',
      makeDeps()
    );

    expect(result.approved).toBe(true);
    db.close();
  });
});

// ── signalDelivery / readAndClearHumanSignal ─────────────────────────────────

describe('signalDelivery / readAndClearHumanSignal', () => {
  let db: Database.Database;

  function makeDeliveryWithMigrations(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
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
    const delivery = makeDeliveryWithMigrations({ status: 'review-paused' });
    const result = signalDelivery(db, 'VNM-56.30', 'approve');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.delivery.agent_id).toBe(delivery.agent_id);
    expect(result.delivery.human_signal).toBe('approve');

    const reloaded = getDeliveryForTask(db, 'VNM-56.30');
    expect(reloaded!.human_signal).toBe('approve');
  });

  it('writes needs_fixes signal when delivery is review-paused', () => {
    makeDeliveryWithMigrations({ status: 'review-paused' });
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
    const delivery = makeDeliveryWithMigrations(); // defaults to pr-open
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
    makeDeliveryWithMigrations({ status: 'review-paused' });
    expect(() => signalDelivery(db, 'VNM-56.30', 'maybe' as unknown as 'approve')).toThrow(
      /Invalid human signal/
    );
  });

  it('readAndClearHumanSignal returns null when no signal is set', () => {
    const delivery = makeDeliveryWithMigrations({ status: 'review-paused' });
    expect(readAndClearHumanSignal(db, delivery.agent_id)).toBeNull();
  });

  it('readAndClearHumanSignal returns the signal and clears it', () => {
    const delivery = makeDeliveryWithMigrations({ status: 'review-paused' });
    signalDelivery(db, 'VNM-56.30', 'approve');

    const first = readAndClearHumanSignal(db, delivery.agent_id);
    expect(first).toBe('approve');

    const second = readAndClearHumanSignal(db, delivery.agent_id);
    expect(second).toBeNull();
  });
});

// ── runHumanReviewGate ──────────────────────────────────────────────────────

describe('runHumanReviewGate', () => {
  let db: Database.Database;

  function makeDeliveryWithMigrations(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
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

  beforeEach(() => {
    db = new Database(':memory:');
    agentsMigrationV1.up(db);
    agentsMigrationV2.up(db);
    agentsMigrationV3.up(db);
    agentsMigrationV4.up(db);
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
    const delivery = makeDeliveryWithMigrations({ status: 'review-paused' });

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
    const delivery = makeDeliveryWithMigrations();

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
    const delivery = makeDeliveryWithMigrations();

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
