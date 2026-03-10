import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { createMockEmbedder, makeActivity, createTestDb } from '../../../helpers.js';
import type { BrainConfig } from '../../../../src/types.js';
import { createAuditCommands } from '../../../../src/modules/pm/commands/audit.js';

let db: BrainDB;
const embedder = createMockEmbedder();
let config: BrainConfig;

vi.mock('../../../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(async (fn) => fn({ db, embedder, config, modules: {}, close: () => {} })),
}));

let stdoutChunks: string[];
let stderrChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

function stderr(): string {
  return stderrChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await createAuditCommands().parseAsync(['node', 'audit', ...args], { from: 'node' });
}

function seedActivities(): void {
  db.addActivity(
    makeActivity({
      id: 'act-1',
      module: 'pm',
      moduleInstance: 'TEST',
      activityType: 'task-create',
      outcome: 'success',
      startedAt: '2026-02-20T10:00:00Z',
      completedAt: '2026-02-20T10:00:05Z',
      metadata: JSON.stringify({ tokens: 1000, model: 'sonnet' }),
    })
  );
  db.addActivity(
    makeActivity({
      id: 'act-2',
      module: 'pm',
      moduleInstance: 'TEST',
      activityType: 'task-update',
      outcome: 'failure',
      startedAt: '2026-02-21T10:00:00Z',
      completedAt: '2026-02-21T10:00:03Z',
      metadata: JSON.stringify({ tokens: 500, model: 'haiku' }),
    })
  );
  db.addActivity(
    makeActivity({
      id: 'act-3',
      module: 'pm',
      moduleInstance: 'TEST',
      activityType: 'task-create',
      outcome: 'success',
      startedAt: '2026-02-25T10:00:00Z',
      completedAt: '2026-02-25T10:00:10Z',
      metadata: JSON.stringify({ tokens: 2000, model: 'opus' }),
    })
  );
}

beforeEach(async () => {
  ({ db } = createTestDb());
  config = {
    notesDir: '/tmp/test-audit-cmd',
    dbPath: ':memory:',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  stdoutChunks = [];
  stderrChunks = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  });
  process.exitCode = undefined;
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('audit summary', () => {
  it('shows activity summary as text', async () => {
    seedActivities();

    await run('summary');

    const out = stdout();
    expect(out).toContain('Total: 3');
    expect(out).toContain('Completed: 3');
    expect(out).toContain('Failed: 1');
    expect(out).toContain('task-create: 2');
    expect(out).toContain('task-update: 1');
  });

  it('--since filters by time range', async () => {
    seedActivities();

    await run('summary', '--since', '2026-02-24', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.total).toBe(1);
  });

  it('--json returns structured data', async () => {
    seedActivities();

    await run('summary', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.total).toBe(3);
    expect(parsed.completed).toBe(3);
    expect(parsed.failed).toBe(1);
    expect(parsed.byType).toHaveProperty('task-create');
    expect(parsed.byType['task-create']).toBe(2);
  });

  it('empty state shows zero totals', async () => {
    await run('summary');

    const out = stdout();
    expect(out).toContain('Total: 0');
    expect(out).toContain('Completed: 0');
    expect(out).toContain('Failed: 0');
  });
});

describe('audit cost', () => {
  it('shows cost breakdown as text', async () => {
    seedActivities();

    await run('cost');

    const out = stdout();
    expect(out).toContain('Total tokens: 3500');
    expect(out).toContain('Estimated cost:');
    expect(out).toContain('sonnet');
    expect(out).toContain('haiku');
    expect(out).toContain('opus');
  });

  it('--json returns structured cost data', async () => {
    seedActivities();

    await run('cost', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.totalTokens).toBe(3500);
    expect(parsed.estimatedCost).toBeGreaterThan(0);
    expect(parsed.byModel).toHaveProperty('sonnet');
    expect(parsed.byModel).toHaveProperty('haiku');
    expect(parsed.byModel).toHaveProperty('opus');
    expect(parsed.byModel.sonnet.tokens).toBe(1000);
    expect(parsed.byModel.opus.tokens).toBe(2000);
  });

  it('empty state shows zero tokens', async () => {
    await run('cost');

    const out = stdout();
    expect(out).toContain('Total tokens: 0');
    expect(out).toContain('Estimated cost: $0.0000');
  });
});

describe('audit executions', () => {
  it('lists execution history as text', async () => {
    seedActivities();

    await run('executions');

    const out = stdout();
    expect(out).toContain('act-1');
    expect(out).toContain('act-2');
    expect(out).toContain('act-3');
    expect(out).toContain('task-create');
    expect(out).toContain('success');
    expect(out).toContain('failure');
  });

  it('--json returns array', async () => {
    seedActivities();

    await run('executions', '--json');

    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(3);
    expect(parsed[0]).toHaveProperty('id');
    expect(parsed[0]).toHaveProperty('activityType');
  });

  it('--limit truncates results', async () => {
    seedActivities();

    await run('executions', '--limit', '2', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.length).toBe(2);
  });

  it('empty state shows no-executions message', async () => {
    await run('executions');

    const out = stdout();
    expect(out).toContain('No executions found');
  });
});

describe('audit performance', () => {
  it('shows performance metrics as text', async () => {
    seedActivities();

    await run('performance');

    const out = stdout();
    expect(out).toContain('Total: 3');
    expect(out).toContain('Completed: 3');
    expect(out).toContain('Completion rate: 100%');
    expect(out).toContain('Avg duration:');
  });

  it('--json returns structured performance data', async () => {
    seedActivities();

    await run('performance', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.total).toBe(3);
    expect(parsed.completed).toBe(3);
    expect(parsed.completionRate).toBe(1);
    expect(parsed.avgDurationMs).toBeGreaterThan(0);
  });

  it('--project filters by project', async () => {
    seedActivities();
    db.addActivity(
      makeActivity({
        id: 'act-other',
        module: 'pm',
        moduleInstance: 'OTHER',
        activityType: 'task-create',
        outcome: 'success',
        startedAt: '2026-02-20T10:00:00Z',
        completedAt: '2026-02-20T10:00:05Z',
      })
    );

    await run('performance', '--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.total).toBe(3);
    expect(parsed.completed).toBe(3);
  });

  it('empty state shows zero metrics', async () => {
    await run('performance', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.total).toBe(0);
    expect(parsed.completionRate).toBe(0);
    expect(parsed.avgDurationMs).toBe(0);
  });

  it('handles activities without completedAt in duration calc', async () => {
    db.addActivity(
      makeActivity({
        id: 'act-noend',
        module: 'pm',
        activityType: 'task-create',
        startedAt: '2026-02-20T10:00:00Z',
        completedAt: null,
      })
    );

    await run('performance', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.total).toBe(1);
    expect(parsed.completed).toBe(0);
  });

  it('text mode with mixed durations shows avg duration', async () => {
    seedActivities();

    await run('performance');

    const out = stdout();
    expect(out).toContain('Avg duration:');
    expect(out).toContain('ms');
  });
});

describe('audit enrich', () => {
  it('enriches an activity with token metadata', async () => {
    seedActivities();

    await run('enrich', 'act-1', '--tokens', '5000', '--model', 'opus');

    const out = stdout();
    expect(out).toContain('Enriched activity act-1');
    expect(out).toContain('5000 tokens');
    expect(out).toContain('opus');
  });

  it('--json returns updated activity', async () => {
    seedActivities();

    await run('enrich', 'act-1', '--tokens', '5000', '--model', 'opus', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.id).toBe('act-1');
    const meta = JSON.parse(parsed.metadata);
    expect(meta.tokens).toBe(5000);
    expect(meta.model).toBe('opus');
  });

  it('not-found sets exitCode=1', async () => {
    await run('enrich', 'nonexistent-id', '--tokens', '100', '--model', 'haiku');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('NOT_FOUND');
  });
});
