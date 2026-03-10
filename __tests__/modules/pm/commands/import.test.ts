import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb } from '../../../helpers.js';
import type { BrainConfig } from '../../../../src/types.js';
import { createImportCommand, executeImport } from '../../../../src/modules/pm/commands/import.js';
import type { ImportProjectDef } from '../../../../src/modules/pm/commands/import.js';

let db: BrainDB;
const embedder = createMockEmbedder();
let config: BrainConfig;
let tempDir: string;

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
  await createImportCommand().parseAsync(['node', 'import', ...args], { from: 'node' });
}

beforeEach(async () => {
  tempDir = join(tmpdir(), `import-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(tempDir, { recursive: true });

  ({ db } = createTestDb());
  config = {
    notesDir: join(tempDir, 'notes'),
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
  try {
    rmSync(tempDir, { recursive: true });
  } catch {
    // ignore cleanup errors
  }
});

describe('executeImport', () => {
  it('creates project, workstreams, and tasks', async () => {
    const def: ImportProjectDef = {
      name: 'Import Test',
      prefix: 'IMP',
      workstreams: [
        {
          name: 'Backend',
          tasks: [
            { name: 'Set up API', description: 'Set up the API framework.', priority: 'high' },
            { name: 'Add auth', description: 'Add authentication module.' },
          ],
        },
        {
          name: 'Frontend',
          tasks: [{ name: 'Build UI', description: 'Build the user interface.' }],
        },
      ],
    };

    const result = await executeImport(db, config, embedder, def);

    expect(result.errors).toHaveLength(0);
    expect(result.created.length).toBe(6); // 1 project + 2 workstreams + 3 tasks
    expect(result.created[0].type).toBe('project');
    expect(result.created[1].type).toBe('workstream');
    expect(result.created[2].type).toBe('task');
  });

  it('handles task dependencies', async () => {
    const def: ImportProjectDef = {
      name: 'Dep Test',
      prefix: 'DEP',
      workstreams: [
        {
          name: 'Main',
          tasks: [
            { name: 'First task', description: 'The first task.' },
            { name: 'Second task', description: 'Depends on first.', depends_on: ['DEP-01.01'] },
          ],
        },
      ],
    };

    const result = await executeImport(db, config, embedder, def);

    expect(result.errors).toHaveLength(0);
    expect(result.created.length).toBe(4); // 1 project + 1 ws + 2 tasks
  });

  it('reports errors for invalid dependency targets', async () => {
    const def: ImportProjectDef = {
      name: 'Bad Dep Test',
      prefix: 'BAD',
      workstreams: [
        {
          name: 'Main',
          tasks: [
            {
              name: 'Task with bad dep',
              description: 'Task with bad dependency.',
              depends_on: ['BAD-99.99'],
            },
          ],
        },
      ],
    };

    const result = await executeImport(db, config, embedder, def);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.code === 'NOT_FOUND')).toBe(true);
  });

  it('handles project without workstreams', async () => {
    const def: ImportProjectDef = {
      name: 'Empty Project',
      prefix: 'EMP',
    };

    const result = await executeImport(db, config, embedder, def);

    expect(result.errors).toHaveLength(0);
    expect(result.created.length).toBe(1);
    expect(result.created[0].type).toBe('project');
  });

  it('handles dependency source resolution failure', async () => {
    // Create a project manually, then import tasks with self-referencing deps
    // that won't resolve correctly
    const def: ImportProjectDef = {
      name: 'Dep Src Test',
      prefix: 'DST',
      workstreams: [
        {
          name: 'Main',
          tasks: [
            { name: 'Task A', description: 'Task A for dep source test.' },
            { name: 'Task B', description: 'Task B depends on A.', depends_on: ['DST-01.01'] },
          ],
        },
      ],
    };

    const result = await executeImport(db, config, embedder, def);

    // Should successfully create project, workstream, and tasks
    expect(result.created.filter((c) => c.type === 'task')).toHaveLength(2);
  });

  it('reports project creation errors (duplicate)', async () => {
    const def: ImportProjectDef = {
      name: 'Dup Project',
      prefix: 'DUP',
    };

    await executeImport(db, config, embedder, def);
    const result = await executeImport(db, config, embedder, def);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.created).toHaveLength(0);
  });

  it('handles workstream without tasks', async () => {
    const def: ImportProjectDef = {
      name: 'No Tasks',
      prefix: 'NOT',
      workstreams: [{ name: 'Empty WS' }],
    };

    const result = await executeImport(db, config, embedder, def);

    expect(result.errors).toHaveLength(0);
    expect(result.created.length).toBe(2); // project + ws
  });
});

describe('import command (--from-json)', () => {
  it('imports from a valid JSON file', async () => {
    const jsonFile = join(tempDir, 'project.json');
    writeFileSync(
      jsonFile,
      JSON.stringify({
        name: 'CLI Import',
        prefix: 'CLI',
        workstreams: [
          { name: 'Core', tasks: [{ name: 'Task one', description: 'First core task.' }] },
        ],
      })
    );

    await run('--from-json', jsonFile);

    const out = stdout();
    expect(out).toContain('Created project');
    expect(out).toContain('Created workstream');
    expect(out).toContain('Created task');
    expect(out).toContain('Import complete');
  });

  it('--json outputs structured import result', async () => {
    const jsonFile = join(tempDir, 'project2.json');
    writeFileSync(
      jsonFile,
      JSON.stringify({
        name: 'JSON Import',
        prefix: 'JSN',
        workstreams: [{ name: 'WS1', tasks: [{ name: 'T1', description: 'Test task T1.' }] }],
      })
    );

    await run('--from-json', jsonFile, '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('created');
    expect(parsed).toHaveProperty('errors');
    expect(parsed.created.length).toBe(3);
  });

  it('errors on non-existent file', async () => {
    await run('--from-json', join(tempDir, 'nonexistent.json'));

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('Failed to read/parse');
  });

  it('errors on invalid JSON content', async () => {
    const badFile = join(tempDir, 'bad.json');
    writeFileSync(badFile, 'not json at all');

    await run('--from-json', badFile);

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('Failed to read/parse');
  });

  it('errors on missing name field', async () => {
    const badFile = join(tempDir, 'noname.json');
    writeFileSync(badFile, JSON.stringify({ prefix: 'NN' }));

    await run('--from-json', badFile);

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('name');
  });

  it('errors on missing prefix field', async () => {
    const badFile = join(tempDir, 'nopfx.json');
    writeFileSync(badFile, JSON.stringify({ name: 'No Prefix' }));

    await run('--from-json', badFile);

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('prefix');
  });

  it('errors on non-object input', async () => {
    const badFile = join(tempDir, 'array.json');
    writeFileSync(badFile, JSON.stringify([1, 2, 3]));

    await run('--from-json', badFile);

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('INVALID_INPUT');
  });

  it('errors on null input', async () => {
    const badFile = join(tempDir, 'null.json');
    writeFileSync(badFile, 'null');

    await run('--from-json', badFile);

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('INVALID_INPUT');
  });

  it('errors on workstreams not being an array', async () => {
    const badFile = join(tempDir, 'badws.json');
    writeFileSync(
      badFile,
      JSON.stringify({ name: 'Bad WS', prefix: 'BWS', workstreams: 'not-array' })
    );

    await run('--from-json', badFile);

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('must be an array');
  });

  it('errors on workstream with empty name', async () => {
    const badFile = join(tempDir, 'emptyws.json');
    writeFileSync(
      badFile,
      JSON.stringify({
        name: 'Bad WS Name',
        prefix: 'BWN',
        workstreams: [{ name: '' }],
      })
    );

    await run('--from-json', badFile);

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('non-empty');
  });

  it('errors on task with empty name', async () => {
    const badFile = join(tempDir, 'emptytask.json');
    writeFileSync(
      badFile,
      JSON.stringify({
        name: 'Bad Task',
        prefix: 'BT',
        workstreams: [{ name: 'WS', tasks: [{ name: '' }] }],
      })
    );

    await run('--from-json', badFile);

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('non-empty');
  });

  it('errors on tasks not being an array', async () => {
    const badFile = join(tempDir, 'badtasks.json');
    writeFileSync(
      badFile,
      JSON.stringify({
        name: 'Bad Tasks',
        prefix: 'BTK',
        workstreams: [{ name: 'WS', tasks: 'not-array' }],
      })
    );

    await run('--from-json', badFile);

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('must be an array');
  });

  it('sets exitCode=1 when all items fail', async () => {
    // Create a project first, then try to import it again (duplicate)
    const jsonFile = join(tempDir, 'dup.json');
    writeFileSync(jsonFile, JSON.stringify({ name: 'Dup', prefix: 'DUP' }));

    await run('--from-json', jsonFile);
    stdoutChunks = [];
    stderrChunks = [];
    process.exitCode = undefined;

    await run('--from-json', jsonFile);

    expect(process.exitCode).toBe(1);
  });

  it('shows errors in text mode', async () => {
    // Import with a dep target that does not exist
    const jsonFile = join(tempDir, 'deptxt.json');
    writeFileSync(
      jsonFile,
      JSON.stringify({
        name: 'Dep Err',
        prefix: 'DER',
        workstreams: [
          {
            name: 'WS',
            tasks: [
              { name: 'T1', description: 'Task with invalid dep.', depends_on: ['DER-99.99'] },
            ],
          },
        ],
      })
    );

    await run('--from-json', jsonFile);

    const out = stderr();
    expect(out).toContain('Error');
    expect(out).toContain('NOT_FOUND');
  });
});
