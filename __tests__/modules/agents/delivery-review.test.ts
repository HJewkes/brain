import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { DeliveryRecord } from '../../../src/modules/agents/delivery.js';
import {
  runDeliveryReview,
  parseRiskScore,
  type ReviewDeps,
  type ReviewRunOutput,
} from '../../../src/modules/agents/delivery-review.js';

function makeDelivery(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeDb(): Database.Database {
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
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO delivery_states (agent_id, task_id, branch, status)
      VALUES ('agent-1', 'VNM-56.29', 'agent/VNM-56/VNM-56.29', 'pr-open');
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
    const db = makeDb();
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
    const db = makeDb();
    await runDeliveryReview(db, makeDelivery(), 'ci-only', '/tmp/project', makeDeps());

    const row = db
      .prepare('SELECT review_tier FROM delivery_states WHERE agent_id = ?')
      .get('agent-1') as { review_tier: string | null };
    expect(row.review_tier).toBe('ci-only');
    db.close();
  });

  it('ai-review approves on PASS verdict with low risk', async () => {
    const db = makeDb();
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

  it('escalates when risk >= 4 even if verdict says PASS (signal priority fix)', async () => {
    const db = makeDb();
    const deps = makeDeps({
      runReview: vi.fn(async () => review('Verdict: PASS\nRisk Score: 5', { agentId: 'r1' })),
    });

    const result = await runDeliveryReview(db, makeDelivery(), 'ai-review', '/tmp/project', deps);

    expect(result.approved).toBe(false);
    expect(result.escalated).toBe(true);
    expect(result.riskScore).toBe(5);
    db.close();
  });

  it('escalates when subprocess fails (empty output must not auto-approve)', async () => {
    const db = makeDb();
    const deps = makeDeps({
      runReview: vi.fn(async () => review('', { success: false, agentId: 'failed-r1' })),
    });

    const result = await runDeliveryReview(db, makeDelivery(), 'ai-review', '/tmp/project', deps);

    expect(result.approved).toBe(false);
    expect(result.escalated).toBe(true);
    expect(result.reviewAgentId).toBe('failed-r1');
    db.close();
  });

  it('human-review tier always escalates', async () => {
    const db = makeDb();
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

    expect(result.approved).toBe(false);
    expect(result.escalated).toBe(true);
    db.close();
  });

  it('needs_fixes runs fixup loop and approves when re-review passes', async () => {
    const db = makeDb();
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

  it('fixup loop escalates after exhausting MAX_FIXUP_ITERATIONS', async () => {
    const db = makeDb();
    const runReview = vi.fn(async () => review('Verdict: NEEDS WORK\nRisk: 2', { agentId: 'r' }));
    const runFixup = vi.fn(async () => review('', { agentId: 'f' }));
    const deps: ReviewDeps = { runReview, runFixup };

    const result = await runDeliveryReview(db, makeDelivery(), 'ai-review', '/tmp/project', deps);

    expect(result.approved).toBe(false);
    expect(result.escalated).toBe(true);
    expect(result.fixupIterations).toBe(3);
    expect(runFixup).toHaveBeenCalledTimes(3);
    expect(runReview).toHaveBeenCalledTimes(4);
    db.close();
  });

  it('persists review_score from every review iteration', async () => {
    const db = makeDb();
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
    const db = makeDb();
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
