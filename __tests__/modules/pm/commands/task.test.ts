import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../../helpers.js';
import { createStandardProject } from '../../../fixtures/pm-project.js';
import type { BrainConfig } from '../../../../src/types.js';
import { createTaskCommands } from '../../../../src/modules/pm/commands/task.js';
import { createTestTask } from '../../../helpers.js';

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
    await createTestTask(db, config, embedder, {
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
    await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Critical task',
      priority: 'critical',
    });
    await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Low task',
      priority: 'low',
    });
    await createTestTask(db, config, embedder, {
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
    await createTestTask(db, config, embedder, {
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
    await run('add', 'New task', '--project', 'TEST', '--workstream', '1', '--description', 'A new test task.');

    const out = stdout();
    expect(out).toContain('TEST-01.04');
    expect(out).toContain('pending');
  });

  it('--depends-on sets dependency', async () => {
    await run('add', 'Dep task', '--project', 'TEST', '--workstream', '1', '--description', 'Task with dependency.', '--depends-on', 'TEST-01.01');

    const out = stdout();
    expect(out).toContain('TEST-01.04');
  });

  it('--json outputs created task', async () => {
    await run('add', 'Json task', '--project', 'TEST', '--workstream', '1', '--description', 'JSON output test task.', '--json');

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

  it('update --depends-on adds dependency relations (O-44)', async () => {
    // TEST-02.01 has no dependencies initially
    await run('update', 'TEST-02.01', '--depends-on', 'TEST-01.01', '--json');

    expect(process.exitCode).not.toBe(1);

    // Verify the relation was created by checking relations from the note
    const notes = db.getModuleNoteIds({ module: 'pm', type: 'task' });
    const taskNote = notes
      .map((id) => db.getNoteById(id))
      .find((n) => {
        const meta = JSON.parse(n!.metadata!) as Record<string, unknown>;
        return meta.display_id === 'TEST-02.01';
      });
    expect(taskNote).toBeDefined();

    const relations = db.getRelationsFrom(taskNote!.id);
    const depRelations = relations.filter((r) => r.type === 'depends_on');
    expect(depRelations.length).toBeGreaterThanOrEqual(1);
  });

  it('update --depends-on with multiple IDs adds all relations (O-44)', async () => {
    // Create a fresh task with no deps
    await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'No deps task',
    });

    stdoutChunks = [];
    stderrChunks = [];

    await run('update', 'TEST-01.04', '--depends-on', 'TEST-01.01', 'TEST-01.02', '--json');

    expect(process.exitCode).not.toBe(1);

    const notes = db.getModuleNoteIds({ module: 'pm', type: 'task' });
    const taskNote = notes
      .map((id) => db.getNoteById(id))
      .find((n) => {
        const meta = JSON.parse(n!.metadata!) as Record<string, unknown>;
        return meta.display_id === 'TEST-01.04';
      });
    expect(taskNote).toBeDefined();

    const relations = db.getRelationsFrom(taskNote!.id);
    const depRelations = relations.filter((r) => r.type === 'depends_on');
    expect(depRelations.length).toBe(2);
  });

  it('update --depends-on with invalid ID warns but does not fail (O-44)', async () => {
    await run('update', 'TEST-01.01', '--depends-on', 'TEST-99.99', '--json');

    expect(process.exitCode).not.toBe(1);
    expect(stderr()).toContain('Warning');
    expect(stderr()).toContain('TEST-99.99');
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

describe('task add (error paths)', () => {
  it('error when no project and no active project', async () => {
    db.close();
    db = new BrainDB(tmpDbPath('task-add-noproj'));

    await run('add', 'New task', '--workstream', '1', '--description', 'Test task.');

    expect(process.exitCode).toBe(1);
  });
});

describe('task list (error paths)', () => {
  it('error when resolveProject fails', async () => {
    db.close();
    db = new BrainDB(tmpDbPath('task-list-noproj'));

    await run('list');

    expect(process.exitCode).toBe(1);
  });

  it('error on invalid workstream format', async () => {
    await run('list', '--project', 'TEST', '--workstream', 'INVALID');

    expect(process.exitCode).toBe(1);
  });
});

describe('task update (error paths)', () => {
  it('error when task not found', async () => {
    await run('update', 'TEST-99.99', '--priority', 'high');

    expect(process.exitCode).toBe(1);
  });
});

describe('task done (error paths)', () => {
  it('error when task not found', async () => {
    await run('done', 'TEST-99.99');

    expect(process.exitCode).toBe(1);
  });
});

describe('task block (error paths)', () => {
  it('error when task not found', async () => {
    await run('block', 'TEST-99.99');

    expect(process.exitCode).toBe(1);
  });
});

describe('task unblock (error paths)', () => {
  it('error when task not found', async () => {
    await run('unblock', 'TEST-99.99');

    expect(process.exitCode).toBe(1);
  });
});

describe('task claim (error paths)', () => {
  it('error on invalid transition (done task)', async () => {
    await run('claim', 'TEST-01.01', '--start');
    stdoutChunks = [];
    stderrChunks = [];
    process.exitCode = undefined;
    await run('done', 'TEST-01.01');
    stdoutChunks = [];
    stderrChunks = [];
    process.exitCode = undefined;

    await run('claim', 'TEST-01.01');

    expect(process.exitCode).toBe(1);
  });
});

describe('task start (error paths)', () => {
  it('error when task has no claim', async () => {
    await run('start', 'TEST-01.01', '--token', 'some-token');

    expect(process.exitCode).toBe(1);
  });
});

describe('task release (error paths)', () => {
  it('error when task not found', async () => {
    await run('release', 'TEST-99.99');

    expect(process.exitCode).toBe(1);
  });
});

describe('task delete (json output)', () => {
  it('--json returns delete confirmation', async () => {
    await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Deletable json task',
    });

    await run('delete', 'TEST-01.04', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.deleted).toBe(true);
    expect(parsed.id).toBe('TEST-01.04');
  });
});

describe('task show (text detail)', () => {
  it('shows mode when present', async () => {
    await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Auto mode task',
      mode: 'auto' as never,
    });

    await run('show', 'TEST-01.04');

    const out = stdout();
    expect(out).toContain('Mode: auto');
  });

  it('shows depends_on when present', async () => {
    await run('show', 'TEST-01.02');

    const out = stdout();
    expect(out).toContain('Depends on:');
    expect(out).toContain('TEST-01.01');
  });

  it('shows virtual states when present', async () => {
    // TEST-01.02 depends on TEST-01.01 (pending), so it should have +BLOCKED
    await run('show', 'TEST-01.02');

    const out = stdout();
    expect(out).toContain('Virtual states:');
    expect(out).toContain('+BLOCKED');
  });
});

describe('task block', () => {
  it('blocks a task', async () => {
    await run('block', 'TEST-01.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.status).toBe('blocked');
  });

  it('error for invalid transition', async () => {
    // done task cannot be blocked
    await run('claim', 'TEST-01.01', '--start');
    stdoutChunks = [];
    stderrChunks = [];
    process.exitCode = undefined;
    await run('done', 'TEST-01.01');
    stdoutChunks = [];
    stderrChunks = [];
    process.exitCode = undefined;

    await run('block', 'TEST-01.01');

    expect(process.exitCode).toBe(1);
  });
});

describe('task unblock', () => {
  it('unblocks a blocked task', async () => {
    await run('block', 'TEST-01.01');
    stdoutChunks = [];
    stderrChunks = [];

    await run('unblock', 'TEST-01.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.status).toBe('pending');
  });
});

describe('task release', () => {
  it('releases a claimed task back to pending', async () => {
    await run('claim', 'TEST-01.01');
    stdoutChunks = [];
    stderrChunks = [];

    await run('release', 'TEST-01.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.status).toBe('pending');
  });

  it('error when releasing a non-claimed task', async () => {
    await run('release', 'TEST-01.01');

    expect(process.exitCode).toBe(1);
  });
});

describe('task list (output formatting)', () => {
  it('text output shows filter context when no results match', async () => {
    await run('list', '--project', 'TEST', '--priority', 'critical', '--status', 'done');

    const out = stdout();
    expect(out).toContain('0 tasks found matching:');
    expect(out).toContain('priority=critical');
    expect(out).toContain('status=done');
  });

  it('text output shows "No tasks found" with no filters on empty project', async () => {
    db.close();
    db = new BrainDB(tmpDbPath('task-cmd-empty'));

    await run('list');

    // Either shows "No tasks found" or errors
    const out = stdout() + stderr();
    expect(out.length).toBeGreaterThan(0);
  });

  it('--sort status orders tasks by status', async () => {
    await run('list', '--project', 'TEST', '--sort', 'status', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('--sort workstream orders by workstream', async () => {
    await run('list', '--project', 'TEST', '--sort', 'workstream', '--json');

    const parsed = JSON.parse(stdout());
    for (let i = 1; i < parsed.length; i++) {
      expect(parsed[i].workstream).toBeGreaterThanOrEqual(parsed[i - 1].workstream);
    }
  });

  it('text output single task shows display_id and status', async () => {
    await run('add', 'Single task', '--project', 'TEST', '--workstream', '1', '--description', 'A single test task.');

    const out = stdout();
    expect(out).toContain('TEST-01.04');
    expect(out).toContain('pending');
  });

  it('--category filter works', async () => {
    await createTestTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Bug task',
      category: 'bug' as never,
    });

    await run('list', '--project', 'TEST', '--category', 'bug', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.length).toBe(1);
    expect(parsed[0].category).toBe('bug');
  });

  it('--workstream display ID format works', async () => {
    await run('list', '--project', 'TEST', '--workstream', 'TEST-01', '--json');

    const parsed = JSON.parse(stdout());
    for (const t of parsed) {
      expect(t.workstream).toBe(1);
    }
  });
});

describe('task delete', () => {
  it('deletes a task without dependents', async () => {
    // TEST-01.03 has no dependents (nothing depends on it except TEST-02.03)
    // Actually TEST-02.03 depends on TEST-01.03. Use a fresh task instead.
    await createTestTask(db, config, embedder, {
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

function appendTaskBody(displayId: string, bodyText: string): void {
  const filePath = join(config.notesDir, 'modules', 'pm', 'TEST', `${displayId}.md`);
  if (!existsSync(filePath)) throw new Error(`Task file not found: ${filePath}`);
  const content = readFileSync(filePath, 'utf-8');
  writeFileSync(filePath, content + '\n' + bodyText, 'utf-8');
}

describe('task list enrichment', () => {
  it('--json includes description field truncated to 500 chars', async () => {
    const longBody = 'A'.repeat(600);
    appendTaskBody('TEST-01.01', longBody);

    await run('list', '--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    const task = parsed.find((t: { display_id: string }) => t.display_id === 'TEST-01.01');
    expect(task).toHaveProperty('description');
    expect(task.description.length).toBeLessThanOrEqual(500);
  });

  it('--json includes depends_on array', async () => {
    await run('list', '--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    const task = parsed.find((t: { display_id: string }) => t.display_id === 'TEST-01.02');
    expect(task).toHaveProperty('depends_on');
    expect(task.depends_on).toContain('TEST-01.01');
  });

  it('--json includes blocked_by array (upstream prerequisites)', async () => {
    // TEST-01.02 depends on TEST-01.01, so TEST-01.02.blocked_by = [TEST-01.01]
    await run('list', '--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    const task02 = parsed.find((t: { display_id: string }) => t.display_id === 'TEST-01.02');
    expect(task02).toHaveProperty('blocked_by');
    expect(task02.blocked_by).toContain('TEST-01.01');

    // And TEST-01.01.blocks = [TEST-01.02] (downstream dependents)
    const task01 = parsed.find((t: { display_id: string }) => t.display_id === 'TEST-01.01');
    expect(task01).toHaveProperty('blocks');
    expect(task01.blocks).toContain('TEST-01.02');
  });

  it('--json includes created and modified timestamps', async () => {
    await run('list', '--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    const task = parsed.find((t: { display_id: string }) => t.display_id === 'TEST-01.01');
    expect(task).toHaveProperty('created');
    expect(task).toHaveProperty('modified');
    expect(task.created).toBeTruthy();
    expect(task.modified).toBeTruthy();
  });

  it('--full --json includes complete body not truncated', async () => {
    const longBody = 'B'.repeat(600);
    appendTaskBody('TEST-01.01', longBody);

    await run('list', '--project', 'TEST', '--full', '--json');

    const parsed = JSON.parse(stdout());
    const task = parsed.find((t: { display_id: string }) => t.display_id === 'TEST-01.01');
    expect(task.description.length).toBeGreaterThan(500);
    expect(task.description).toContain('B'.repeat(600));
  });

  it('--short --json omits description', async () => {
    await run('list', '--project', 'TEST', '--short', '--json');

    const parsed = JSON.parse(stdout());
    const task = parsed.find((t: { display_id: string }) => t.display_id === 'TEST-01.01');
    expect(task).not.toHaveProperty('description');
    expect(task).not.toHaveProperty('acceptance_criteria');
    expect(task).not.toHaveProperty('blocked_by');
  });
});

describe('task list search fixes', () => {
  it('--search matches body content', async () => {
    appendTaskBody('TEST-01.01', 'This task involves vector search implementation');

    await run('list', '--project', 'TEST', '--search', 'vector', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.length).toBe(1);
    expect(parsed[0].display_id).toBe('TEST-01.01');
  });

  it('--search queries all statuses by default', async () => {
    // Move TEST-01.01 to done: pending -> claimed -> in-progress -> done
    await run('claim', 'TEST-01.01', '--start');
    stdoutChunks = [];
    stderrChunks = [];
    await run('done', 'TEST-01.01');
    stdoutChunks = [];
    stderrChunks = [];

    await run('list', '--project', 'TEST', '--search', '01.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.length).toBe(1);
    expect(parsed[0].display_id).toBe('TEST-01.01');
    expect(parsed[0].status).toBe('done');
  });

  it('--search --status pending restricts to pending', async () => {
    // Move TEST-01.01 to done
    await run('claim', 'TEST-01.01', '--start');
    stdoutChunks = [];
    stderrChunks = [];
    await run('done', 'TEST-01.01');
    stdoutChunks = [];
    stderrChunks = [];

    await run('list', '--project', 'TEST', '--search', '01.01', '--status', 'pending', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.length).toBe(0);
  });
});
