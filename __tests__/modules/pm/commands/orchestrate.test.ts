import { EventEmitter, Readable } from 'node:stream';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../../helpers.js';
import { createStandardProject } from '../../../fixtures/pm-project.js';
import type { BrainConfig } from '../../../../src/types.js';
import { createOrchestrateCommands } from '../../../../src/modules/pm/commands/orchestrate.js';
import { updateTaskStatus } from '../../../../src/modules/pm/data/task-ops.js';
import { setActiveProject } from '../../../../src/modules/pm/data/queries.js';

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
  await createOrchestrateCommands().parseAsync(['node', 'orchestrate', ...args], { from: 'node' });
}

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('orchestrate-cmd'));
  config = {
    notesDir: '/tmp/test-orchestrate-cmd',
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
  setActiveProject(db, 'TEST');
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('orchestrate route', () => {
  it('returns routing info as text', async () => {
    await run('route', 'TEST-01.01');

    const out = stdout();
    expect(out).toContain('Task: TEST-01.01');
    expect(out).toContain('Agent:');
    expect(out).toContain('Model:');
    expect(out).toContain('Isolation:');
    expect(out).toContain('Verify:');
    expect(out).toContain('Concurrency:');
  });

  it('--json returns routing as JSON', async () => {
    await run('route', 'TEST-01.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.taskId).toBe('TEST-01.01');
    expect(parsed).toHaveProperty('agentType');
    expect(parsed).toHaveProperty('model');
    expect(parsed).toHaveProperty('isolation');
    expect(parsed).toHaveProperty('verify');
    expect(parsed).toHaveProperty('concurrency');
  });

  it('not-found sets exitCode=1', async () => {
    await run('route', 'TEST-99.99');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('NOT_FOUND');
  });
});

describe('orchestrate render', () => {
  it('renders agent prompt as text', async () => {
    await run('render', 'TEST-01.01');

    const out = stdout();
    expect(out).toContain('TEST-01.01');
  });

  it('--json returns prompt with metadata', async () => {
    await run('render', 'TEST-01.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.taskId).toBe('TEST-01.01');
    expect(parsed).toHaveProperty('contextHash');
    expect(parsed).toHaveProperty('prompt');
  });

  it('--verification renders verification prompt', async () => {
    await run('render', 'TEST-01.01', '--verification');

    const out = stdout();
    expect(out.length).toBeGreaterThan(0);
  });

  it('--verification --json renders verification prompt as JSON', async () => {
    await run('render', 'TEST-01.01', '--verification', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.taskId).toBe('TEST-01.01');
    expect(parsed).toHaveProperty('prompt');
  });

  it('not-found sets exitCode=1', async () => {
    await run('render', 'TEST-99.99');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('NOT_FOUND');
  });
});

describe('orchestrate worktree-alloc', () => {
  it('not-found sets exitCode=1', async () => {
    await run('worktree-alloc', 'TEST-99.99');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('NOT_FOUND');
  });
});

describe('orchestrate worktree-check', () => {
  it('fails when BRAIN_PM_WORKTREE not set', async () => {
    const orig = process.env.BRAIN_PM_WORKTREE;
    delete process.env.BRAIN_PM_WORKTREE;

    await run('worktree-check');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('BRAIN_PM_WORKTREE not set');

    if (orig !== undefined) process.env.BRAIN_PM_WORKTREE = orig;
  });

  it('succeeds when path matches worktree', async () => {
    const cwd = process.cwd();
    process.env.BRAIN_PM_WORKTREE = cwd;

    await run('worktree-check', '--path', cwd);

    expect(process.exitCode).toBe(0);

    delete process.env.BRAIN_PM_WORKTREE;
  });

  it('fails when path does not match worktree', async () => {
    process.env.BRAIN_PM_WORKTREE = '/some/expected/path';

    await run('worktree-check', '--path', '/completely/different/path');

    expect(process.exitCode).toBe(1);

    delete process.env.BRAIN_PM_WORKTREE;
  });
});

describe('orchestrate worktree-release', () => {
  it('reports no allocation when none exists', async () => {
    await run('worktree-release', 'TEST-01.01');

    const out = stdout();
    expect(out).toContain('No allocation found for TEST-01.01');
  });

  it('--json returns release status', async () => {
    await run('worktree-release', 'TEST-01.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.taskId).toBe('TEST-01.01');
    expect(parsed).toHaveProperty('released');
  });
});

describe('orchestrate worktree-status', () => {
  it('shows budget as text', async () => {
    await run('worktree-status');

    const out = stdout();
    expect(out).toContain('Budget:');
    expect(out).toContain('available');
  });

  it('--json returns budget object', async () => {
    await run('worktree-status', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('used');
    expect(parsed).toHaveProperty('max');
    expect(parsed).toHaveProperty('available');
    expect(parsed).toHaveProperty('allocations');
  });

  it('shows allocations list when present (json)', async () => {
    // Just verify the structure works even with 0 allocations
    await run('worktree-status', '--json');

    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed.allocations)).toBe(true);
  });
});

describe('orchestrate session-end', () => {
  it('outputs session summary as text', async () => {
    await run('session-end');

    const out = stdout();
    expect(out).toContain('Session End');
    expect(out).toContain('TEST');
    expect(out).toContain('Tasks:');
    expect(out).toContain('Worktrees:');
  });

  it('--json returns structured summary', async () => {
    await run('session-end', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.session).toBe('ended');
    expect(parsed.project).toBe('TEST');
    expect(parsed).toHaveProperty('tasks');
    expect(parsed.tasks).toHaveProperty('total');
    expect(parsed.tasks).toHaveProperty('done');
    expect(parsed.tasks).toHaveProperty('inProgress');
    expect(parsed.tasks).toHaveProperty('pending');
    expect(parsed).toHaveProperty('worktrees');
  });

  it('handles no active project', async () => {
    db.close();
    db = new BrainDB(tmpDbPath('orchestrate-cmd-empty'));

    await run('session-end', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.session).toBe('ended');
    expect(parsed.project).toBeNull();
  });
});

describe('orchestrate route (validation)', () => {
  it('errors when task has invalid category', async () => {
    // Directly update the task frontmatter to have invalid category
    const { getPmNotes } = await import('../../../../src/modules/pm/data/queries.js');
    const { readFileSync, writeFileSync } = await import('node:fs');
    const notes = getPmNotes(db, 'task', { display_id: 'TEST-01.01' });
    if (notes.length > 0) {
      const content = readFileSync(notes[0].filePath, 'utf-8');
      const updated = content.replace(/category: implementation/, 'category: INVALID_CATEGORY');
      writeFileSync(notes[0].filePath, updated, 'utf-8');
      // Re-index to update metadata
      const { createHash } = await import('node:crypto');
      const { indexSingleFile } = await import('../../../../src/services/indexing.js');
      const hash = createHash('sha256').update(updated).digest('hex');
      await indexSingleFile(db, embedder, notes[0].filePath, updated, hash, Date.now());
    }

    await run('route', 'TEST-01.01');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('INVALID_INPUT');
  });

  it('errors when task has invalid mode', async () => {
    const { getPmNotes } = await import('../../../../src/modules/pm/data/queries.js');
    const { readFileSync, writeFileSync } = await import('node:fs');
    const notes = getPmNotes(db, 'task', { display_id: 'TEST-02.01' });
    if (notes.length > 0) {
      const content = readFileSync(notes[0].filePath, 'utf-8');
      const updated = content.replace(/mode: auto/, 'mode: INVALID_MODE');
      writeFileSync(notes[0].filePath, updated, 'utf-8');
      const { createHash } = await import('node:crypto');
      const { indexSingleFile } = await import('../../../../src/services/indexing.js');
      const hash = createHash('sha256').update(updated).digest('hex');
      await indexSingleFile(db, embedder, notes[0].filePath, updated, hash, Date.now());
    }

    await run('route', 'TEST-02.01');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('INVALID_INPUT');
  });
});

describe('orchestrate session-start', () => {
  function mockStdin(data: string) {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    // When isTTY is true, readStdin resolves immediately with ''
    // The command then parses empty string and uses defaults
    return () => {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
      });
    };
  }

  it('outputs session info with active project (TTY mode)', async () => {
    const restore = mockStdin('');

    await run('session-start');

    const out = stdout();
    expect(out).toContain('TEST');
    expect(out).toContain('BRAIN_PM_PROJECT');
    // Also includes the cheat sheet
    expect(out).toContain('brain pm');

    restore();
  });

  it('errors when no active project', async () => {
    db.close();
    db = new BrainDB(tmpDbPath('orchestrate-no-project'));
    const restore = mockStdin('');

    await run('session-start');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('No active project');

    restore();
  });
});

describe('orchestrate agent-done', () => {
  it('records agent completion (TTY mode with empty stdin)', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    await run('agent-done');

    const out = stdout();
    expect(out).toContain('recorded');
    expect(out).toContain('true');

    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    });
  });
});
