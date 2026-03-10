import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb } from '../../../helpers.js';
import { createStandardProject } from '../../../fixtures/pm-project.js';
import type { BrainConfig } from '../../../../src/types.js';
import { createCaptureCommands } from '../../../../src/modules/pm/commands/capture.js';

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

function getCaptureCmd() {
  const cmds = createCaptureCommands();
  return cmds[0]; // capture command
}

function getInboxCmd() {
  const cmds = createCaptureCommands();
  return cmds[1]; // inbox command
}

async function runCapture(...args: string[]): Promise<void> {
  await getCaptureCmd().parseAsync(['node', 'capture', ...args], { from: 'node' });
}

async function runInbox(...args: string[]): Promise<void> {
  await getInboxCmd().parseAsync(['node', 'inbox', ...args], { from: 'node' });
}

beforeEach(async () => {
  ({ db } = createTestDb());
  config = {
    notesDir: '/tmp/test-capture-cmd',
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

describe('capture process (error paths)', () => {
  function getProcessCmd() {
    const cmds = createCaptureCommands();
    return cmds[2];
  }

  async function runProcess2(...args: string[]): Promise<void> {
    await getProcessCmd().parseAsync(['node', 'process', ...args], { from: 'node' });
  }

  it('error when no project and no active project', async () => {
    db.close();
    ({ db } = createTestDb());

    await runProcess2(
      'some-id',
      '--task-name',
      'T',
      '--workstream',
      '1',
      '--description',
      'Test task description.'
    );

    expect(process.exitCode).toBe(1);
  });
});

describe('capture add', () => {
  it('creates a capture with text', async () => {
    await runCapture('Remember to refactor the parser');

    const out = stdout();
    expect(out).toContain('Remember to refactor the parser');
  });

  it('--json returns capture object', async () => {
    await runCapture('JSON capture test', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('noteId');
    expect(parsed).toHaveProperty('content', 'JSON capture test');
    expect(parsed).toHaveProperty('processed', false);
    expect(parsed).toHaveProperty('source', 'cli');
  });

  it('--project scopes capture to a project', async () => {
    await runCapture('Scoped capture', '--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.project).toBe('TEST');
  });
});

describe('capture list (inbox)', () => {
  it('lists captures', async () => {
    await runCapture('First capture');
    stdoutChunks = [];
    stderrChunks = [];

    await runInbox();

    const out = stdout();
    // formatCaptureLine shows noteId and content from chunk
    // At minimum, the capture note ID prefix appears
    expect(out).toContain('capture-');
  });

  it('--json returns array of captures', async () => {
    await runCapture('Capture for list');
    stdoutChunks = [];
    stderrChunks = [];

    await runInbox('--json');

    const parsed = JSON.parse(stdout());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0]).toHaveProperty('noteId');
  });

  it('empty state shows "No captures found"', async () => {
    await runInbox();

    const out = stdout();
    expect(out).toContain('No captures found');
  });

  it('--project filters captures', async () => {
    await runCapture('Project capture', '--project', 'TEST');
    await runCapture('Unscoped capture');
    stdoutChunks = [];
    stderrChunks = [];

    await runInbox('--project', 'TEST', '--json');

    const parsed = JSON.parse(stdout());
    for (const c of parsed) {
      expect(c.project).toBe('TEST');
    }
  });

  it('--all includes processed captures', async () => {
    await runCapture('A capture');
    stdoutChunks = [];
    stderrChunks = [];

    await runInbox('--all', '--json');

    const parsed = JSON.parse(stdout());
    expect(parsed.length).toBeGreaterThanOrEqual(1);
  });
});

describe('capture process', () => {
  function getProcessCmd() {
    const cmds = createCaptureCommands();
    return cmds[2]; // process command
  }

  async function runProcess(...args: string[]): Promise<void> {
    await getProcessCmd().parseAsync(['node', 'process', ...args], { from: 'node' });
  }

  it('processes a capture into a task', async () => {
    await runCapture('Needs to be a task', '--project', 'TEST', '--json');
    const capture = JSON.parse(stdout());
    stdoutChunks = [];
    stderrChunks = [];

    await runProcess(
      capture.noteId,
      '--task-name',
      'New task from capture',
      '--workstream',
      '1',
      '--project',
      'TEST',
      '--description',
      'New task created from a capture.'
    );

    const out = stdout();
    expect(out).toContain('Processed capture into task');
  });

  it('--json outputs processed result', async () => {
    await runCapture('JSON process', '--project', 'TEST', '--json');
    const capture = JSON.parse(stdout());
    stdoutChunks = [];
    stderrChunks = [];

    await runProcess(
      capture.noteId,
      '--task-name',
      'JSON task',
      '--workstream',
      '1',
      '--project',
      'TEST',
      '--description',
      'JSON task description.',
      '--json'
    );

    const parsed = JSON.parse(stdout());
    expect(parsed).toHaveProperty('display_id');
  });

  it('errors on invalid capture ID', async () => {
    await runProcess(
      'nonexistent-id',
      '--task-name',
      'Bad',
      '--workstream',
      '1',
      '--project',
      'TEST',
      '--description',
      'Bad task.'
    );

    expect(process.exitCode).toBe(1);
  });
});
