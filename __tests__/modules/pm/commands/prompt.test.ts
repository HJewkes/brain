import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../../helpers.js';
import { createStandardProject } from '../../../fixtures/pm-project.js';
import type { BrainConfig } from '../../../../src/types.js';
import { createPromptCommands } from '../../../../src/modules/pm/commands/prompt.js';

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
  await createPromptCommands().parseAsync(['node', 'prompt', ...args], { from: 'node' });
}

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('prompt-cmd'));
  config = {
    notesDir: '/tmp/test-prompt-cmd',
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

describe('prompt write', () => {
  it('creates a prompt for a task', async () => {
    await run('write', 'TEST-01.01', '--project', 'TEST', '--content', 'Build the feature');

    const out = stdout();
    expect(out).toContain('TEST-P01');
    expect(out).toContain('current');
  });

  it('--json outputs created prompt as JSON', async () => {
    await run('write', 'TEST-01.01', '--project', 'TEST', '--content', 'Build it', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.display_id).toBe('TEST-P01');
    expect(parsed.task).toBe('TEST-01.01');
    expect(parsed.prompt_status).toBe('current');
    expect(parsed.version).toBe(1);
  });

  it('not-found error for invalid task', async () => {
    await run('write', 'TEST-99.99', '--project', 'TEST', '--content', 'Nothing');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('NOT_FOUND');
  });
});

describe('prompt show', () => {
  it('displays prompt content', async () => {
    await run(
      'write',
      'TEST-01.01',
      '--project',
      'TEST',
      '--content',
      'Detailed instructions here'
    );

    stdoutChunks = [];
    stderrChunks = [];

    await run('show', 'TEST-01.01');

    const out = stdout();
    expect(out).toContain('TEST-P01');
    expect(out).toContain('Detailed instructions here');
  });

  it('--json outputs full prompt object', async () => {
    await run('write', 'TEST-01.01', '--project', 'TEST', '--content', 'JSON test');

    stdoutChunks = [];
    stderrChunks = [];

    await run('show', 'TEST-01.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.display_id).toBe('TEST-P01');
    expect(parsed).toHaveProperty('content');
  });

  it('not-found error when no prompt exists', async () => {
    await run('show', 'TEST-01.01');

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('NOT_FOUND');
  });
});

describe('prompt list', () => {
  it('lists prompts for a project', async () => {
    await run('write', 'TEST-01.01', '--project', 'TEST', '--content', 'First prompt');
    stdoutChunks = [];
    stderrChunks = [];

    await run('list', '--project', 'TEST');

    const out = stdout();
    expect(out).toContain('TEST-P01');
  });

  it('--json returns array of prompts', async () => {
    await run('write', 'TEST-01.01', '--project', 'TEST', '--content', 'A prompt');
    stdoutChunks = [];
    stderrChunks = [];

    await run('list', '--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0]).toHaveProperty('display_id');
  });

  it('--status filters by prompt status', async () => {
    await run('write', 'TEST-01.01', '--project', 'TEST', '--content', 'Active prompt');
    stdoutChunks = [];
    stderrChunks = [];

    await run('list', '--project', 'TEST', '--status', 'current', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.length).toBe(1);
  });

  it('empty state shows "No prompts found"', async () => {
    await run('list', '--project', 'TEST');

    const out = stdout();
    expect(out).toContain('No prompts found');
  });
});

describe('prompt history', () => {
  it('shows version history for a task', async () => {
    await run('write', 'TEST-01.01', '--project', 'TEST', '--content', 'V1');
    stdoutChunks = [];
    stderrChunks = [];
    await run('write', 'TEST-01.01', '--project', 'TEST', '--content', 'V2');
    stdoutChunks = [];
    stderrChunks = [];

    await run('history', 'TEST-01.01');

    const out = stdout();
    expect(out).toContain('TEST-P01');
  });

  it('--json returns array of prompt versions', async () => {
    await run('write', 'TEST-01.01', '--project', 'TEST', '--content', 'V1');
    stdoutChunks = [];
    stderrChunks = [];
    await run('write', 'TEST-01.01', '--project', 'TEST', '--content', 'V2');
    stdoutChunks = [];
    stderrChunks = [];

    await run('history', 'TEST-01.01', '--json');

    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
  });

  it('returns error for task with no prompts', async () => {
    await run('history', 'TEST-99.99');

    expect(process.exitCode).toBe(1);
  });

  it('show --version retrieves specific version', async () => {
    await run('write', 'TEST-01.01', '--project', 'TEST', '--content', 'Version 1');
    stdoutChunks = [];
    stderrChunks = [];
    await run('write', 'TEST-01.01', '--project', 'TEST', '--content', 'Version 2');
    stdoutChunks = [];
    stderrChunks = [];

    await run('show', 'TEST-01.01', '--version', '1');

    const out = stdout();
    expect(out).toContain('TEST-P01');
  });
});
