import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb, createTestTask } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';
import { createTaskCommands } from '../../../src/modules/pm/commands/task.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

vi.mock('../../../src/services/brain-service.js', () => ({
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
  ({ db } = createTestDb());
  notesDir = join(tmpdir(), `pm-cascade-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
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

  await createProject(db, config, embedder, { name: 'Cascade', prefix: 'CSC' });
  await createWorkstream(db, config, embedder, { project: 'CSC', name: 'Main' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe('newly eligible notification on task completion', () => {
  it('logs newly eligible tasks to stderr when completing a blocking task', async () => {
    // Arrange: task A blocks task B
    await createTestTask(db, config, embedder, {
      project: 'CSC',
      workstream: 1,
      name: 'Task A',
    });
    await createTestTask(db, config, embedder, {
      project: 'CSC',
      workstream: 1,
      name: 'Task B',
      dependsOn: ['CSC-01.01'],
    });

    // Act: complete CSC-01.01 (pending → claimed → in-progress → done)
    await updateTaskStatus(db, config, embedder, 'CSC-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'CSC-01.01', 'in-progress');
    stderrChunks = []; // clear intermediate output
    const doneResult = await updateTaskStatus(db, config, embedder, 'CSC-01.01', 'done');

    // Assert
    expect(doneResult.ok).toBe(true);
    expect(stderr()).toContain('Newly eligible: CSC-01.02');
  });

  it('does not log newly eligible when no downstream tasks are unblocked', async () => {
    // Arrange: standalone task with no dependents
    await createTestTask(db, config, embedder, {
      project: 'CSC',
      workstream: 1,
      name: 'Standalone task',
    });

    // Act: complete it
    await updateTaskStatus(db, config, embedder, 'CSC-01.01', 'in-progress');
    stderrChunks = [];
    await updateTaskStatus(db, config, embedder, 'CSC-01.01', 'done');

    // Assert
    expect(stderr()).not.toContain('Newly eligible');
  });

  it('lists multiple newly eligible tasks when completing a shared dependency', async () => {
    // Arrange: task A blocks tasks B and C
    await createTestTask(db, config, embedder, {
      project: 'CSC',
      workstream: 1,
      name: 'Task A',
    });
    await createTestTask(db, config, embedder, {
      project: 'CSC',
      workstream: 1,
      name: 'Task B',
      dependsOn: ['CSC-01.01'],
    });
    await createTestTask(db, config, embedder, {
      project: 'CSC',
      workstream: 1,
      name: 'Task C',
      dependsOn: ['CSC-01.01'],
    });

    // Act: complete CSC-01.01 (pending → claimed → in-progress → done)
    await updateTaskStatus(db, config, embedder, 'CSC-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'CSC-01.01', 'in-progress');
    stderrChunks = [];
    await updateTaskStatus(db, config, embedder, 'CSC-01.01', 'done');

    // Assert: both B and C appear in the notification
    const errOut = stderr();
    expect(errOut).toContain('Newly eligible:');
    expect(errOut).toContain('CSC-01.02');
    expect(errOut).toContain('CSC-01.03');
  });
});

describe('brain pm task done --cascade', () => {
  it('shows eligible tasks after completing a blocking task', async () => {
    // Arrange
    await createTestTask(db, config, embedder, {
      project: 'CSC',
      workstream: 1,
      name: 'Task A',
    });
    await createTestTask(db, config, embedder, {
      project: 'CSC',
      workstream: 1,
      name: 'Task B',
      dependsOn: ['CSC-01.01'],
    });

    // Act
    await run('done', 'CSC-01.01', '--cascade');

    // Assert
    const out = stdout();
    expect(out).toContain('Post-merge cascade:');
    expect(out).toContain('CSC-01.02');
  });

  it('reports no new tasks when no dependents exist', async () => {
    // Arrange: standalone task
    await createTestTask(db, config, embedder, {
      project: 'CSC',
      workstream: 1,
      name: 'Solo task',
    });

    // Act
    await run('done', 'CSC-01.01', '--cascade');

    // Assert
    const out = stdout();
    expect(out).toContain('Post-merge cascade: no new tasks unblocked');
  });

  it('works without --cascade flag (no cascade output)', async () => {
    // Arrange
    await createTestTask(db, config, embedder, {
      project: 'CSC',
      workstream: 1,
      name: 'Task A',
    });
    await createTestTask(db, config, embedder, {
      project: 'CSC',
      workstream: 1,
      name: 'Task B',
      dependsOn: ['CSC-01.01'],
    });

    // Act: complete without --cascade
    await run('done', 'CSC-01.01');

    // Assert: no cascade block in stdout
    expect(stdout()).not.toContain('Post-merge cascade:');
  });
});
