import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Command } from '@commander-js/extra-typings';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb } from '../../../helpers.js';
import { createStandardProject } from '../../../fixtures/pm-project.js';
import type { BrainConfig } from '../../../../src/types.js';
import { createOrchestrationCommands } from '../../../../src/modules/pm/commands/orchestration.js';
import { buildTemplateVariables } from '../../../../src/modules/pm/commands/orchestration.js';
import type { AgentDispatchContext } from '../../../../src/modules/agents/dispatch-context.js';

let db: BrainDB;
const embedder = createMockEmbedder();
let config: BrainConfig;
let testDir: string;

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
  ({ db } = createTestDb());
  testDir = join(tmpdir(), `brain-render-prompt-${Date.now()}`);
  mkdirSync(join(testDir, 'templates', 'agents'), { recursive: true });

  config = {
    notesDir: testDir,
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
  rmSync(testDir, { recursive: true, force: true });
});

describe('render-prompt command', () => {
  it('renders a template with task variables', async () => {
    const template = 'Task: {TASK_ID}\nTitle: {TITLE}\nDir: {PROJECT_DIR}';
    writeFileSync(join(testDir, 'templates', 'agents', 'worker.md'), template);

    await run('render-prompt', 'TEST-01.01', '--template', 'worker', '--project-dir', testDir);

    expect(process.exitCode).toBeUndefined();
    const out = stdout();
    expect(out).toContain('Task: TEST-01.01');
    expect(out).toContain('Title: Task 01.01');
    expect(out).toContain(`Dir: ${testDir}`);
  });

  it('errors on missing template', async () => {
    await run('render-prompt', 'TEST-01.01', '--template', 'nonexistent', '--project-dir', testDir);

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('Template not found');
  });

  it('errors on unknown task', async () => {
    const template = 'Task: {TASK_ID}';
    writeFileSync(join(testDir, 'templates', 'agents', 'worker.md'), template);

    await run('render-prompt', 'NOPE-99.99', '--template', 'worker', '--project-dir', testDir);

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('Cannot build dispatch context');
  });

  it('errors on unfilled placeholders', async () => {
    const template = 'Task: {TASK_ID}\nCustom: {CUSTOM_FIELD}';
    writeFileSync(join(testDir, 'templates', 'agents', 'worker.md'), template);

    await run('render-prompt', 'TEST-01.01', '--template', 'worker', '--project-dir', testDir);

    expect(process.exitCode).toBe(1);
    expect(stderr()).toContain('Unfilled placeholders');
    expect(stderr()).toContain('{CUSTOM_FIELD}');
  });
});

describe('buildTemplateVariables', () => {
  it('populates all standard variables', () => {
    const dispatch: AgentDispatchContext = {
      taskId: 'TEST-01.01',
      routing: { model: 'opus', agentType: 'worker', isolation: 'worktree', verify: true },
      agentDispatchable: true,
      context: {
        title: 'My Task',
        body: 'Do the thing',
        workstream: { displayId: 'TEST-01', title: 'Alpha' },
        prompt: undefined,
        dependencies: [{ displayId: 'TEST-00.01', name: 'Setup', status: 'done' }],
        decisions: [],
        constraints: [],
      },
      waveInfo: { waveNumber: 1, totalWaves: 3, waveTasks: ['TEST-01.02'] },
      contextHash: 'abc123',
      extensions: {},
    };

    const vars = buildTemplateVariables(dispatch, '/project');

    expect(vars.TASK_ID).toBe('TEST-01.01');
    expect(vars.TITLE).toBe('My Task');
    expect(vars.DESCRIPTION).toBe('Do the thing');
    expect(vars.CWD).toBe('/project');
    expect(vars.PROJECT_DIR).toBe('/project');
    expect(vars.MODEL).toBe('opus');
    expect(vars.AGENT_TYPE).toBe('worker');
    expect(vars.ISOLATION).toBe('worktree');
    expect(vars.VERIFY).toBe('true');
    expect(vars.DEPENDENCIES).toContain('TEST-00.01');
    expect(vars.WAVE_INFO).toContain('Wave 1 of 3');
    expect(vars.WAVE_INFO).toContain('TEST-01.02');
  });

  it('handles empty dependencies and no wave info', () => {
    const dispatch: AgentDispatchContext = {
      taskId: 'X-01.01',
      routing: { model: 'sonnet', agentType: 'worker', isolation: 'none', verify: false },
      agentDispatchable: true,
      context: {
        title: 'Simple',
        body: '',
        workstream: undefined,
        prompt: undefined,
        dependencies: [],
        decisions: [],
        constraints: [],
      },
      contextHash: 'def456',
      extensions: {},
    };

    const vars = buildTemplateVariables(dispatch, '/dir');

    expect(vars.DEPENDENCIES).toBe('None');
    expect(vars.WAVE_INFO).toBe('No wave context');
    expect(vars.DESCRIPTION).toBe('(no description)');
  });
});
