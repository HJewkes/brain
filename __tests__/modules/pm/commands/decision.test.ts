import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../../helpers.js';
import { createStandardProject } from '../../../fixtures/pm-project.js';
import type { BrainConfig } from '../../../../src/types.js';
import { createDecisionCommands } from '../../../../src/modules/pm/commands/decision.js';
import { createDecision } from '../../../../src/modules/pm/data/decision-ops.js';

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
  await createDecisionCommands().parseAsync(['node', 'decision', ...args], { from: 'node' });
}

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('decision-cmd'));
  config = {
    notesDir: '/tmp/test-decision-cmd',
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

describe('decision add', () => {
  it('creates decision with content', async () => {
    await run('add', 'Use React', '--project', 'TEST', '--source-task', 'TEST-01.01');

    const out = stdout();
    expect(out).toContain('TEST-D01');
    expect(out).toContain('accepted');
  });

  it('--impacts links to task', async () => {
    await run(
      'add',
      'Use React',
      '--project',
      'TEST',
      '--source-task',
      'TEST-01.01',
      '--impacts',
      'TEST-01.01'
    );

    const out = stdout();
    expect(out).toContain('TEST-D01');
    expect(out).toContain('accepted');
  });

  it('--json outputs created decision', async () => {
    await run(
      'add',
      'Use React',
      '--project',
      'TEST',
      '--source-task',
      'TEST-01.01',
      '--json'
    );

    const parsed = JSON.parse(stdout());
    expect(parsed.display_id).toBe('TEST-D01');
    expect(parsed.status).toBe('accepted');
    expect(parsed.source_task).toBe('TEST-01.01');
    expect(parsed.project).toBe('TEST');
  });
});

describe('decision list', () => {
  it('lists decisions as text', async () => {
    await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Use React',
      sourceTask: 'TEST-01.01',
      content: '',
    });

    await run('list', '--project', 'TEST');

    const out = stdout();
    expect(out).toContain('TEST-D01');
    expect(out).toContain('Use React');
    expect(out).toContain('accepted');
  });

  it('--json returns array', async () => {
    await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Use React',
      sourceTask: 'TEST-01.01',
      content: '',
    });

    await run('list', '--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].display_id).toBe('TEST-D01');
  });

  it('empty state shows no-decisions message', async () => {
    await run('list', '--project', 'TEST');

    const out = stdout();
    expect(out).toContain('No decisions found');
  });
});

describe('decision show', () => {
  it('shows decision detail', async () => {
    await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Use React',
      sourceTask: 'TEST-01.01',
      content: '',
    });

    await run('show', 'TEST-D01');

    const out = stdout();
    expect(out).toContain('TEST-D01');
    expect(out).toContain('Use React');
    expect(out).toContain('accepted');
  });

  it('--json outputs full decision object', async () => {
    await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Use React',
      sourceTask: 'TEST-01.01',
      content: '',
    });

    await run('show', 'TEST-D01', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.display_id).toBe('TEST-D01');
    expect(parsed.status).toBe('accepted');
    expect(parsed).toHaveProperty('content');
  });

  it('not-found sets exitCode=1', async () => {
    await run('show', 'TEST-D99');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('NOT_FOUND');
  });
});

describe('decision supersede', () => {
  it('supersedes a decision with a new one', async () => {
    await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Use React',
      sourceTask: 'TEST-01.01',
      content: '',
    });

    await run('supersede', 'TEST-D01', 'Use Vue');

    const out = stdout();
    expect(out).toContain('Superseded');
    expect(out).toContain('TEST-D01');
    expect(out).toContain('TEST-D02');
  });

  it('not-found sets exitCode=1', async () => {
    await run('supersede', 'TEST-D99', 'Use Vue');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('NOT_FOUND');
  });

  it('--json outputs old and new decisions', async () => {
    await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Use React',
      sourceTask: 'TEST-01.01',
      content: '',
    });

    await run('supersede', 'TEST-D01', 'Use Vue', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.old.display_id).toBe('TEST-D01');
    expect(parsed.old.status).toBe('superseded');
    expect(parsed.new.display_id).toBe('TEST-D02');
    expect(parsed.new.status).toBe('accepted');
  });
});
