import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../../helpers.js';
import { createStandardProject } from '../../../fixtures/pm-project.js';
import type { BrainConfig } from '../../../../src/types.js';
import { createTaskCommands } from '../../../../src/modules/pm/commands/task.js';
import { createTask } from '../../../../src/modules/pm/data/task-ops.js';

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
  await createTaskCommands().parseAsync(['node', 'task', ...args], { from: 'node' });
}

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('task-cmd'));
  config = {
    notesDir: '/tmp/test-task-cmd',
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

describe('task list', () => {
  it('returns all tasks as text lines', async () => {
    await run('list', '--project', 'TEST');

    const out = stdout();
    expect(out).toContain('TEST-01.01');
    expect(out).toContain('TEST-01.02');
    expect(out).toContain('TEST-02.01');
  });

  it('--json returns valid JSON array with correct fields', async () => {
    await run('list', '--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(6);
    for (const task of parsed) {
      expect(task).toHaveProperty('display_id');
      expect(task).toHaveProperty('status');
      expect(task).toHaveProperty('priority');
      expect(task).toHaveProperty('workstream');
    }
  });

  it('--status pending filters correctly', async () => {
    await run('list', '--project', 'TEST', '--status', 'pending', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.length).toBe(6);
    for (const task of parsed) {
      expect(task.status).toBe('pending');
    }
  });

  it('--priority high filters correctly', async () => {
    // Create a high-priority task
    await createTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'High priority task',
      priority: 'high',
    });

    await run('list', '--project', 'TEST', '--priority', 'high', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.length).toBe(1);
    expect(parsed[0].priority).toBe('high');
  });

  it('--workstream 1 filters correctly', async () => {
    await run('list', '--project', 'TEST', '--workstream', '1', '--json');

    const parsed = JSON.parse(stdout());
    for (const task of parsed) {
      expect(task.workstream).toBe(1);
    }
    expect(parsed.length).toBe(3);
  });

  it('--search filters by title', async () => {
    await run('list', '--project', 'TEST', '--search', '02.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.length).toBe(1);
    expect(parsed[0].display_id).toBe('TEST-02.01');
  });

  it('--sort priority orders critical > high > medium > low', async () => {
    await createTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Critical task',
      priority: 'critical',
    });
    await createTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Low task',
      priority: 'low',
    });
    await createTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'High task',
      priority: 'high',
    });

    await run('list', '--project', 'TEST', '--workstream', '1', '--sort', 'priority', '--json');

    const parsed = JSON.parse(stdout());
    const priorities = parsed.map((t: { priority: string }) => t.priority);
    const critIdx = priorities.indexOf('critical');
    const highIdx = priorities.indexOf('high');
    const lastMedIdx = priorities.lastIndexOf('medium');
    const lowIdx = priorities.indexOf('low');
    expect(critIdx).toBeLessThan(highIdx);
    expect(highIdx).toBeLessThan(lastMedIdx);
    expect(lastMedIdx).toBeLessThan(lowIdx);
  });

  it('--limit 2 truncates results', async () => {
    await run('list', '--project', 'TEST', '--limit', '2', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.length).toBe(2);
  });

  it('--sort priority --limit 1 combines both', async () => {
    await createTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Critical task',
      priority: 'critical',
    });

    await run('list', '--project', 'TEST', '--sort', 'priority', '--limit', '1', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.length).toBe(1);
    expect(parsed[0].priority).toBe('critical');
  });

  it('empty result shows "0 tasks found" message', async () => {
    await run('list', '--project', 'TEST', '--priority', 'critical');

    const out = stdout();
    expect(out).toContain('0 tasks found');
  });

  it('error when no project: exitCode=1, stderr has error', async () => {
    // Use a fresh DB with no project
    db.close();
    db = new BrainDB(tmpDbPath('task-cmd-empty'));

    await run('list');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('Error');
  });
});

describe('task add', () => {
  it('creates task with required fields', async () => {
    await run('add', 'New task', '--project', 'TEST', '--workstream', '1');

    const out = stdout();
    expect(out).toContain('TEST-01.04');
    expect(out).toContain('pending');
  });

  it('--depends-on sets dependency', async () => {
    await run('add', 'Dep task', '--project', 'TEST', '--workstream', '1', '--depends-on', 'TEST-01.01');

    const out = stdout();
    expect(out).toContain('TEST-01.04');
  });

  it('--json outputs created task', async () => {
    await run('add', 'Json task', '--project', 'TEST', '--workstream', '1', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.display_id).toBe('TEST-01.04');
    expect(parsed.status).toBe('pending');
    expect(parsed.priority).toBe('medium');
  });

  it('missing --workstream shows error', async () => {
    // Commander will throw/exit for missing required options.
    // We need to catch the error Commander throws.
    const cmd = createTaskCommands();
    cmd.exitOverride();

    try {
      await cmd.parseAsync(['node', 'task', 'add', 'No ws', '--project', 'TEST'], { from: 'node' });
    } catch {
      // Commander throws on missing required option
    }

    // The command should have failed due to missing --workstream
    expect(stderr().length > 0 || process.exitCode === 1).toBe(true);
  });
});

describe('task show', () => {
  it('shows task detail as text', async () => {
    await run('show', 'TEST-01.01');

    const out = stdout();
    expect(out).toContain('TEST-01.01');
    expect(out).toContain('Task 01.01');
    expect(out).toContain('Status:');
    expect(out).toContain('Priority:');
  });

  it('--json outputs full task object', async () => {
    await run('show', 'TEST-01.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.display_id).toBe('TEST-01.01');
    expect(parsed.status).toBe('pending');
    expect(parsed).toHaveProperty('body');
  });

  it('not-found sets exitCode=1', async () => {
    await run('show', 'TEST-99.99');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('NOT_FOUND');
  });
});

describe('task update', () => {
  it('update --priority critical changes priority', async () => {
    await run('update', 'TEST-01.01', '--priority', 'critical', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.priority).toBe('critical');
  });
});

describe('task done', () => {
  it('transitions pending task through claim to done', async () => {
    // Must go pending -> claimed -> in-progress -> done
    // First claim
    await run('claim', 'TEST-01.01', '--start', '--json');
    const claimOut = JSON.parse(stdout());
    expect(claimOut.status).toBe('in-progress');

    stdoutChunks = [];
    stderrChunks = [];

    // Then done
    await run('done', 'TEST-01.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.status).toBe('done');
  });

  it('invalid transition from pending to done shows error', async () => {
    await run('done', 'TEST-01.01');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('INVALID_TRANSITION');
  });
});

describe('task claim', () => {
  it('claim --json returns claim token', async () => {
    await run('claim', 'TEST-01.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('token');
    expect(parsed.token).toBeTruthy();
    expect(parsed.status).toBe('claimed');
  });

  it('claim already claimed task shows error', async () => {
    await run('claim', 'TEST-01.01');
    stdoutChunks = [];
    stderrChunks = [];
    process.exitCode = undefined;

    await run('claim', 'TEST-01.01');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('ALREADY_CLAIMED');
  });
});

describe('task start', () => {
  it('transitions claimed task to in-progress', async () => {
    // First claim to get the token
    await run('claim', 'TEST-01.01', '--json');
    const claimOut = JSON.parse(stdout());
    const token = claimOut.token;

    stdoutChunks = [];
    stderrChunks = [];

    await run('start', 'TEST-01.01', '--token', token, '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.status).toBe('in-progress');
  });

  it('start without valid token shows error', async () => {
    // First claim
    await run('claim', 'TEST-01.01');
    stdoutChunks = [];
    stderrChunks = [];
    process.exitCode = undefined;

    await run('start', 'TEST-01.01', '--token', 'bad-token');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('INVALID_CLAIM_TOKEN');
  });
});

describe('task delete', () => {
  it('deletes a task without dependents', async () => {
    // TEST-01.03 has no dependents (nothing depends on it except TEST-02.03)
    // Actually TEST-02.03 depends on TEST-01.03. Use a fresh task instead.
    await createTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Deletable task',
    });

    await run('delete', 'TEST-01.04');

    const out = stdout();
    expect(out).toContain('Deleted');
    expect(out).toContain('TEST-01.04');
  });

  it('delete on not-found sets exitCode=1', async () => {
    await run('delete', 'TEST-99.99');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('NOT_FOUND');
  });

  it('delete task with dependents shows error without --force', async () => {
    // TEST-01.01 has dependents (01.02, 02.02 depend on it)
    await run('delete', 'TEST-01.01');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('HAS_DEPENDENTS');
  });

  it('delete task with dependents succeeds with --force', async () => {
    await run('delete', 'TEST-01.01', '--force');

    const out = stdout();
    expect(out).toContain('Deleted');
    expect(out).toContain('TEST-01.01');
  });
});
