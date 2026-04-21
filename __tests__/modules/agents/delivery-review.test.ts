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
  db.prepare(
    `INSERT INTO agents (id, name, parent, status, created_at, context)
     VALUES (?, ?, 'orchestrator', 'active', ?, '{}')`
  ).run(agentId, `agent-for-${taskId}`, new Date().toISOString());
  recordDelivery(db, agentId, {
    status: 'pr-open',
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

  it('writes approve signal and returns the delivery', () => {
    const delivery = makeDelivery(db);
    const updated = signalDelivery(db, 'VNM-56.30', 'approve');
    expect(updated).not.toBeNull();
    expect(updated!.agent_id).toBe(delivery.agent_id);
    expect(updated!.human_signal).toBe('approve');

    const reloaded = getDeliveryForTask(db, 'VNM-56.30');
    expect(reloaded!.human_signal).toBe('approve');
  });

  it('writes needs_fixes signal', () => {
    makeDelivery(db);
    const updated = signalDelivery(db, 'VNM-56.30', 'needs_fixes');
    expect(updated!.human_signal).toBe('needs_fixes');
  });

  it('returns null when no delivery exists for taskId', () => {
    const result = signalDelivery(db, 'NOPE-99.99', 'approve');
    expect(result).toBeNull();
  });

  it('rejects invalid signals', () => {
    makeDelivery(db);
    expect(() => signalDelivery(db, 'VNM-56.30', 'maybe' as unknown as 'approve')).toThrow(
      /Invalid human signal/
    );
  });

  it('readAndClearHumanSignal returns null when no signal is set', () => {
    const delivery = makeDelivery(db);
    expect(readAndClearHumanSignal(db, delivery.agent_id)).toBeNull();
  });

  it('readAndClearHumanSignal returns the signal and clears it', () => {
    const delivery = makeDelivery(db);
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
    const delivery = makeDelivery(db);
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

  it('returns not approved after two rejections with no fixup agent available', async () => {
    const delivery = makeDelivery(db);
    const { runHumanReviewGate } = await import('../../../src/modules/agents/delivery-review.js');

    // Drive the poll: first cycle rejects, fixup/re-review fails softly,
    // second cycle rejects again. We'll queue signals via a timer that fires
    // between sleep() ticks (sleep is stubbed to resolve immediately).
    let pollCount = 0;
    const originalSleep = await import('../../../src/utils/db.js');
    vi.mocked(originalSleep.sleep).mockImplementation(async () => {
      pollCount++;
      if (pollCount === 1) signalDelivery(db, delivery.task_id!, 'needs_fixes');
      else if (pollCount >= 2) signalDelivery(db, delivery.task_id!, 'needs_fixes');
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
    // Delivery remains paused since the user rejected both cycles.
    const final = getDeliveryForTask(db, delivery.task_id!);
    expect(final!.status).toBe('review-paused');

    // Two inbox notifications — one per cycle.
    const rows = db.prepare(`SELECT source_meta FROM inbox ORDER BY created_at`).all() as Array<{
      source_meta: string;
    }>;
    expect(rows).toHaveLength(2);
    const actions = rows.map((r) => (JSON.parse(r.source_meta) as { action: string }).action);
    expect(actions).toEqual(['review-requested', 'review-re-requested']);
  });
});
