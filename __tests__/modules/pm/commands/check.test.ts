import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../../helpers.js';
import { createStandardProject } from '../../../fixtures/pm-project.js';
import type { BrainConfig } from '../../../../src/types.js';
import { createCheckCommand } from '../../../../src/modules/pm/commands/check.js';
import { createDecision } from '../../../../src/modules/pm/data/decision-ops.js';
import { createTask, updateTaskStatus } from '../../../../src/modules/pm/data/task-ops.js';

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
  await createCheckCommand().parseAsync(['node', 'check', ...args], { from: 'node' });
}

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('check-cmd'));
  config = {
    notesDir: '/tmp/test-check-cmd',
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

  await createStandardProject(db, config, embedder);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('check command', () => {
  it('clean state shows "No issues found"', async () => {
    await run('--project', 'TEST');

    const out = stdout();
    expect(out).toContain('No issues found');
  });

  it('--json returns structured results', async () => {
    await run('--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('project', 'TEST');
    expect(parsed).toHaveProperty('summary');
    expect(parsed).toHaveProperty('structural');
    expect(parsed.summary).toHaveProperty('totalTasks');
    expect(parsed.summary).toHaveProperty('issuesFound');
  });

  it('detects orphaned decisions', async () => {
    // Create a decision referencing a non-existent task as impact
    // The orphaned detection looks for decisions whose source_task no longer exists
    // We need to create a decision, then somehow orphan it
    // Actually, let's create a decision with a valid source task, then check
    // Orphaned decisions = decisions whose source task is done or cancelled
    await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Orphan decision',
      sourceTask: 'TEST-01.01',
      content: 'This will become orphaned',
    });

    // Cancel the source task to orphan the decision
    // pending -> cancelled requires going through the state machine
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'cancelled');

    await run('--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.structural.orphanedDecisions.length).toBeGreaterThanOrEqual(1);
  });

  it('detects cancelled dependencies', async () => {
    // TEST-01.02 depends on TEST-01.01. Cancel TEST-01.01
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'cancelled');

    await run('--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.structural.cancelledDependencies.length).toBeGreaterThanOrEqual(1);
  });

  it('detects blocked without cause', async () => {
    // Create a task with blocked status but no actual blocking dependencies
    const t = await createTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Blocked task no cause',
    });
    if (!t.ok) throw new Error('Failed to create task');

    await updateTaskStatus(db, config, embedder, t.data.display_id, 'blocked');

    await run('--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.structural.blockedWithoutCause.length).toBeGreaterThanOrEqual(1);
  });

  it('--project filter scopes to project', async () => {
    await run('--project', 'TEST');

    const out = stdout();
    expect(out).toContain('Project TEST');
  });

  it('error when no project specified and no active project', async () => {
    db.close();
    db = new BrainDB(tmpDbPath('check-cmd-empty'));

    await run();

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('No project specified');
  });

  it('reports task and decision counts in summary', async () => {
    await run('--project', 'TEST');

    const out = stdout();
    expect(out).toContain('6 tasks');
  });
});
