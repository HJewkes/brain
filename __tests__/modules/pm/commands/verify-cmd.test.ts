import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb } from '../../../helpers.js';
import { createStandardProject } from '../../../fixtures/pm-project.js';
import type { BrainConfig } from '../../../../src/types.js';
import { createVerifyCommand } from '../../../../src/modules/pm/commands/verify.js';
import { updateTask } from '../../../../src/modules/pm/data/task-ops.js';
import type { TaskCategory } from '../../../../src/modules/pm/types.js';

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
  await createVerifyCommand().parseAsync(['node', 'verify', ...args], { from: 'node' });
}

beforeEach(async () => {
  ({ db } = createTestDb());
  config = {
    notesDir: '/tmp/test-verify-cmd',
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

describe('verify command handler', () => {
  it('shows verification steps for a task', async () => {
    await run('TEST-01.01');

    const out = stdout();
    expect(out).toContain('Verification Plan: TEST-01.01');
    expect(out).toContain('Verification steps:');
    expect(out).toContain('[ ]');
  });

  it('different categories produce different steps', async () => {
    await updateTask(db, config, embedder, 'TEST-01.01', { category: 'testing' });
    await run('TEST-01.01');
    const testingOut = stdout();

    stdoutChunks = [];
    stderrChunks = [];

    await updateTask(db, config, embedder, 'TEST-02.01', { category: 'documentation' });
    await run('TEST-02.01');
    const docsOut = stdout();

    expect(testingOut).toContain('test coverage');
    expect(docsOut).toContain('documentation matches');
    expect(testingOut).not.toBe(docsOut);
  });

  it('--json returns structured verification plan', async () => {
    await run('TEST-01.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('taskId', 'TEST-01.01');
    expect(parsed).toHaveProperty('category');
    expect(parsed).toHaveProperty('steps');
    expect(Array.isArray(parsed.steps)).toBe(true);
    expect(parsed.steps.length).toBeGreaterThan(0);
  });

  it('not-found error sets exitCode=1', async () => {
    await run('TEST-99.99');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('NOT_FOUND');
  });

  it('handles task with default category gracefully', async () => {
    // Standard project tasks have default category (implementation)
    await run('TEST-01.01');

    const out = stdout();
    expect(out).toContain('Category:');
    expect(out).toContain('Verification steps:');
  });

  it('all TaskCategory values produce verification output', async () => {
    const categories: TaskCategory[] = [
      'implementation',
      'testing',
      'documentation',
      'research',
      'review',
      'infrastructure',
      'configuration',
      'design',
      'migration',
    ];

    for (const category of categories) {
      await updateTask(db, config, embedder, 'TEST-01.01', { category });

      stdoutChunks = [];
      stderrChunks = [];

      await run('TEST-01.01', '--json');

      const parsed = JSON.parse(stdout());
      expect(parsed.category).toBe(category);
      expect(parsed.steps.length).toBeGreaterThan(0);
    }
  });
});
