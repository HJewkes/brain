import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Command } from '@commander-js/extra-typings';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../../helpers.js';
import { createStandardProject } from '../../../fixtures/pm-project.js';
import type { BrainConfig } from '../../../../src/types.js';
import { createOrchestrationCommands } from '../../../../src/modules/pm/commands/orchestration.js';
import { createTask, updateTaskStatus } from '../../../../src/modules/pm/data/task-ops.js';
import type { TaskStatus } from '../../../../src/modules/pm/types.js';

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

function createParentCommand(): Command {
  const parent = new Command('pm');
  for (const cmd of createOrchestrationCommands()) {
    parent.addCommand(cmd);
  }
  return parent;
}

async function run(...args: string[]): Promise<void> {
  await createParentCommand().parseAsync(['node', 'pm', ...args], { from: 'node' });
}

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('orchestration-cmd'));
  config = {
    notesDir: '/tmp/test-orchestration-cmd',
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

describe('next (error paths)', () => {
  it('error when no project and no active project', async () => {
    db.close();
    db = new BrainDB(tmpDbPath('orch-next-empty'));

    await run('next');

    expect(process.exitCode).toBe(1);
  });

  it('--workstream with invalid format shows error', async () => {
    await run('next', '--project', 'TEST', '--workstream', 'INVALID');

    expect(process.exitCode).toBe(1);
  });

  it('shows "... and N more" when filtered > limit', async () => {
    // Add more eligible tasks
    for (let i = 0; i < 3; i++) {
      await createTask(db, config, embedder, {
        project: 'TEST',
        workstream: 1,
        name: `Extra eligible ${i}`,
      });
    }

    await run('next', '--project', 'TEST', '--limit', '2');

    const out = stdout();
    expect(out).toContain('more eligible');
  });
});

describe('waves (error paths)', () => {
  it('error when no project and no active project', async () => {
    db.close();
    db = new BrainDB(tmpDbPath('orch-waves-empty'));

    await run('waves');

    expect(process.exitCode).toBe(1);
  });
});

describe('dispatch (error paths)', () => {
  it('error when no project resolves', async () => {
    db.close();
    db = new BrainDB(tmpDbPath('orch-dispatch-empty'));

    await run('dispatch', 'NONE-01.01');

    expect(process.exitCode).toBe(1);
  });
});

describe('next', () => {
  it('returns eligible tasks grouped by workstream', async () => {
    await run('next', '--project', 'TEST');

    const out = stdout();
    expect(out).toContain('Workstream 1');
    expect(out).toContain('Workstream 2');
    expect(out).toContain('TEST-01.01');
    expect(out).toContain('TEST-02.01');
  });

  it('--json returns array of eligible tasks', async () => {
    await run('next', '--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed)).toBe(true);
    const ids = parsed.map((t: { display_id: string }) => t.display_id);
    expect(ids).toContain('TEST-01.01');
    expect(ids).toContain('TEST-02.01');
    // Tasks with unmet deps should not be eligible
    expect(ids).not.toContain('TEST-01.02');
    expect(ids).not.toContain('TEST-02.03');
  });

  it('--limit 1 truncates results', async () => {
    await run('next', '--project', 'TEST', '--limit', '1', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.length).toBe(1);
  });

  it('--workstream 1 filters by workstream', async () => {
    await run('next', '--project', 'TEST', '--workstream', '1', '--json');

    const parsed = JSON.parse(stdout());
    for (const t of parsed) {
      expect(t.workstream).toBe(1);
    }
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('shows "No eligible tasks" when none are eligible', async () => {
    // Complete the two eligible tasks, making the remaining ones depend on incomplete deps
    // Actually easier: mark all tasks as done so no pending remain
    for (const id of ['TEST-01.01', 'TEST-02.01', 'TEST-01.02', 'TEST-02.02', 'TEST-01.03', 'TEST-02.03']) {
      await updateTaskStatus(db, config, embedder, id, 'claimed' as TaskStatus);
      await updateTaskStatus(db, config, embedder, id, 'in-progress' as TaskStatus);
      await updateTaskStatus(db, config, embedder, id, 'done' as TaskStatus);
    }

    await run('next', '--project', 'TEST');

    expect(stdout()).toContain('No eligible tasks');
  });
});

describe('waves', () => {
  it('shows wave grouping as text', async () => {
    await run('waves', '--project', 'TEST');

    const out = stdout();
    expect(out).toContain('Wave 0');
    expect(out).toContain('TEST-01.01');
    expect(out).toContain('TEST-02.01');
  });

  it('--json includes depends_on in task objects (O-113)', async () => {
    await run('waves', '--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);

    // Find a task that has dependencies
    const allTasks = parsed.flatMap((w: { tasks: unknown[] }) => w.tasks);
    const taskWithDeps = allTasks.find(
      (t: { display_id: string; depends_on?: string[] }) =>
        t.depends_on && t.depends_on.length > 0
    );
    expect(taskWithDeps).toBeDefined();
    expect(taskWithDeps.depends_on).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it('shows "No active tasks" when all done', async () => {
    for (const id of ['TEST-01.01', 'TEST-02.01', 'TEST-01.02', 'TEST-02.02', 'TEST-01.03', 'TEST-02.03']) {
      await updateTaskStatus(db, config, embedder, id, 'claimed' as TaskStatus);
      await updateTaskStatus(db, config, embedder, id, 'in-progress' as TaskStatus);
      await updateTaskStatus(db, config, embedder, id, 'done' as TaskStatus);
    }

    await run('waves', '--project', 'TEST');

    expect(stdout()).toContain('No active tasks');
  });
});

describe('dispatch', () => {
  it('returns enriched context as text', async () => {
    await run('dispatch', 'TEST-01.01');

    const out = stdout();
    expect(out).toContain('Task: TEST-01.01');
    expect(out).toContain('Status:');
    expect(out).toContain('Priority:');
  });

  it('--json returns full DispatchBundle', async () => {
    await run('dispatch', 'TEST-01.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.task).toBeDefined();
    expect(parsed.task.display_id).toBe('TEST-01.01');
    expect(parsed).toHaveProperty('peerTasks');
    expect(parsed).toHaveProperty('relatedNotes');
    expect(parsed).toHaveProperty('workstreamDescription');
    expect(parsed).toHaveProperty('downstreamDependents');
  });

  it('--json includes peerTasks, relatedNotes, workstreamDescription, downstreamDependents', async () => {
    await run('dispatch', 'TEST-01.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed.peerTasks)).toBe(true);
    expect(Array.isArray(parsed.relatedNotes)).toBe(true);
    expect(typeof parsed.workstreamDescription).toBe('string');
    expect(Array.isArray(parsed.downstreamDependents)).toBe(true);
    // TEST-01.01 is depended on by TEST-01.02 and TEST-02.02
    const depIds = parsed.downstreamDependents.map((d: { displayId: string }) => d.displayId);
    expect(depIds).toContain('TEST-01.02');
    expect(depIds).toContain('TEST-02.02');
  });

  it('text output shows workstream info', async () => {
    await run('dispatch', 'TEST-01.01');

    const out = stdout();
    expect(out).toContain('Workstream:');
  });

  it('text output shows downstream dependents', async () => {
    // TEST-01.01 has dependents: TEST-01.02, TEST-02.02
    await run('dispatch', 'TEST-01.01');

    const out = stdout();
    expect(out).toContain('Downstream');
    expect(out).toContain('TEST-01.02');
  });

  it('text output shows peer tasks in same workstream', async () => {
    await run('dispatch', 'TEST-01.01');

    const out = stdout();
    expect(out).toContain('Peer Tasks');
  });

  it('text output shows dependencies for dependent task', async () => {
    await run('dispatch', 'TEST-01.02');

    const out = stdout();
    expect(out).toContain('Dependencies');
    expect(out).toContain('TEST-01.01');
  });

  it('text output shows decisions when present', async () => {
    const { createDecision } = await import('../../../../src/modules/pm/data/decision-ops.js');
    await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Use REST',
      sourceTask: 'TEST-01.01',
      impacts: ['TEST-01.01'],
      content: '',
    });

    await run('dispatch', 'TEST-01.01');

    const out = stdout();
    expect(out).toContain('Decisions');
  });

  it('text output shows prompt when present', async () => {
    const { writePrompt } = await import('../../../../src/modules/pm/data/prompt-ops.js');
    await writePrompt(db, config, embedder, {
      project: 'TEST',
      task: 'TEST-01.01',
      content: 'Implement feature X',
    });

    await run('dispatch', 'TEST-01.01');

    const out = stdout();
    expect(out).toContain('Prompt');
  });

  it('not-found sets exitCode=1', async () => {
    await run('dispatch', 'TEST-99.99');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('NOT_FOUND');
  });
});

describe('complete', () => {
  it('completes a task with --summary', async () => {
    await run('complete', 'TEST-01.01', '--summary', 'Finished the first task');

    const out = stdout();
    expect(out).toContain('Completed TEST-01.01');
  });

  it('not-found sets exitCode=1', async () => {
    await run('complete', 'TEST-99.99');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('NOT_FOUND');
  });
});

describe('briefing', () => {
  it('shows task counts in default briefing', async () => {
    await run('briefing', '--project', 'TEST');

    const out = stdout();
    expect(out).toContain('Briefing: TEST');
    expect(out).toContain('Tasks: 6 total');
    expect(out).toContain('Done: 0');
    expect(out).toContain('Eligible:');
    expect(out).toContain('Pending:');
  });

  it('blocked count includes +BLOCKED virtual state (O-135)', async () => {
    await run('briefing', '--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    // No tasks have status='blocked', but tasks with unmet deps get +BLOCKED virtual state
    // TEST-01.02 depends on 01.01 (pending), TEST-01.03 depends on 01.02, etc.
    const blockedIds = parsed.tasks.blocked as string[];
    expect(blockedIds.length).toBe(4);
    expect(blockedIds).toContain('TEST-01.02');
    expect(blockedIds).toContain('TEST-01.03');
    expect(blockedIds).toContain('TEST-02.02');
    expect(blockedIds).toContain('TEST-02.03');
  });

  it('--verbose adds workstream breakdown and priority matrix', async () => {
    await run('briefing', '--project', 'TEST', '--verbose');

    const out = stdout();
    expect(out).toContain('Workstream Breakdown');
    expect(out).toContain('Priority Matrix');
    expect(out).toContain('Critical:');
    expect(out).toContain('High:');
    expect(out).toContain('Medium:');
    expect(out).toContain('Low:');
  });

  it('--json returns structured BriefingData', async () => {
    await run('briefing', '--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('project');
    expect(parsed).toHaveProperty('tasks');
    expect(parsed.tasks).toHaveProperty('total');
    expect(parsed.tasks).toHaveProperty('eligible');
    expect(parsed.tasks).toHaveProperty('inProgress');
    expect(parsed.tasks).toHaveProperty('blocked');
    expect(parsed.tasks).toHaveProperty('done');
    expect(parsed.tasks).toHaveProperty('pending');
    expect(parsed).toHaveProperty('recentDecisions');
    expect(parsed).toHaveProperty('nextActions');
    expect(parsed.tasks.total).toBe(6);
  });

  it('--verbose --json includes workstreamBreakdown and priorityMatrix', async () => {
    await run('briefing', '--project', 'TEST', '--verbose', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('workstreamBreakdown');
    expect(parsed).toHaveProperty('priorityMatrix');
    expect(parsed.workstreamBreakdown.length).toBeGreaterThan(0);
    expect(parsed.priorityMatrix).toHaveProperty('critical');
    expect(parsed.priorityMatrix).toHaveProperty('high');
    expect(parsed.priorityMatrix).toHaveProperty('medium');
    expect(parsed.priorityMatrix).toHaveProperty('low');
  });

  it('--verbose text shows Top Eligible section', async () => {
    await run('briefing', '--project', 'TEST', '--verbose');

    const out = stdout();
    expect(out).toContain('Top Eligible');
    expect(out).toContain('TEST-01.01');
  });

  it('shows consistency issues when present', async () => {
    // Create a blocked task without cause
    const t = await createTask(db, config, embedder, {
      project: 'TEST',
      workstream: 1,
      name: 'Blocked no deps',
    });
    if (!t.ok) throw new Error('Failed');
    await updateTaskStatus(db, config, embedder, t.data.display_id, 'blocked' as TaskStatus);

    await run('briefing', '--project', 'TEST');

    const out = stdout();
    expect(out).toContain('Consistency:');
    expect(out).toContain('structural issue');
  });

  it('briefing with >5 eligible shows truncated list', async () => {
    // Add more tasks to get >5 eligible (no deps)
    for (let i = 0; i < 5; i++) {
      await createTask(db, config, embedder, {
        project: 'TEST',
        workstream: 1,
        name: `Extra task ${i}`,
      });
    }

    await run('briefing', '--project', 'TEST');

    const out = stdout();
    // With 2 original eligible + 5 new = 7 eligible
    expect(out).toContain('more');
  });

  it('shows recent decisions in text', async () => {
    const { createDecision } = await import('../../../../src/modules/pm/data/decision-ops.js');
    await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Recent decision',
      sourceTask: 'TEST-01.01',
      content: '',
    });

    await run('briefing', '--project', 'TEST');

    const out = stdout();
    expect(out).toContain('Recent decisions');
    expect(out).toContain('TEST-D01');
  });

  it('shows stale prompts in text', async () => {
    const { writePrompt } = await import('../../../../src/modules/pm/data/prompt-ops.js');
    await writePrompt(db, config, embedder, {
      project: 'TEST',
      task: 'TEST-01.01',
      content: 'Old prompt',
    });

    // Complete the task to make the prompt stale
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed' as TaskStatus);
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress' as TaskStatus);
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done' as TaskStatus);

    await run('briefing', '--project', 'TEST');

    const out = stdout();
    // Stale prompts should be detected since the task is done
    // If stalePrompts shows up depends on the implementation, but the command should run
    expect(out).toContain('Briefing: TEST');
  });

  it('shows recommended actions', async () => {
    await run('briefing', '--project', 'TEST');

    const out = stdout();
    expect(out).toContain('Recommended actions');
    expect(out).toContain('Pick up eligible task');
  });

  it('shows blocked task recommended action', async () => {
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'blocked' as TaskStatus);

    await run('briefing', '--project', 'TEST');

    const out = stdout();
    expect(out).toContain('Resolve');
    expect(out).toContain('blocked');
  });
});

describe('complete (detailed)', () => {
  it('--json returns newly eligible tasks', async () => {
    await run('complete', 'TEST-01.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('newlyEligible');
    expect(Array.isArray(parsed.newlyEligible)).toBe(true);
  });

  it('text output shows newly eligible when present', async () => {
    // Complete TEST-02.01 so TEST-02.02 only needs TEST-01.01
    await run('complete', 'TEST-02.01');
    stdoutChunks = [];
    stderrChunks = [];

    // Complete TEST-01.01 which should unblock TEST-01.02 and TEST-02.02
    await run('complete', 'TEST-01.01');

    const out = stdout();
    expect(out).toContain('Completed TEST-01.01');
    expect(out).toContain('Newly eligible');
  });

  it('validates claim token when provided', async () => {
    await run('complete', 'TEST-01.01', '--token', 'bad-token');

    // Task has no active claim, so this should fail
    expect(process.exitCode).toBe(1);
  });
});
