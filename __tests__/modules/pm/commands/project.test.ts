import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../../helpers.js';
import type { BrainConfig } from '../../../../src/types.js';
import type { BrainService } from '../../../../src/services/brain-service.js';
import { createProject } from '../../../../src/modules/pm/data/project-ops.js';
import { setActiveProject } from '../../../../src/modules/pm/data/queries.js';

const mockWithBrain = vi.fn();

vi.mock('../../../../src/services/brain-service.js', () => ({
  withBrain: (...args: unknown[]) => mockWithBrain(...args),
}));

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

function captureOutput(): { stdout: () => string; stderr: () => string } {
  let stdoutData = '';
  let stderrData = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
    stdoutData += String(data);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((data) => {
    stderrData += String(data);
    return true;
  });
  return { stdout: () => stdoutData, stderr: () => stderrData };
}

beforeEach(() => {
  dbPath = tmpDbPath('pm-project');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-project-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  mockWithBrain.mockImplementation(async (fn: (svc: BrainService) => unknown) =>
    fn({ db, embedder, config } as unknown as BrainService)
  );
  process.exitCode = undefined;
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

async function loadCommand() {
  const { createPmCommand, createProjectCommands } = await import(
    '../../../../src/modules/pm/commands/project.js'
  );
  return { createPmCommand, createProjectCommands };
}

describe('pm init', () => {
  it('creates project with prefix and name', async () => {
    const output = captureOutput();
    const { createPmCommand } = await loadCommand();
    const cmd = createPmCommand();
    await cmd.parseAsync(['init', 'TestApp', '--prefix', 'TST'], { from: 'user' });

    expect(output.stdout()).toContain('Created project "TestApp" (TST)');
    expect(output.stdout()).toContain('active');
    expect(process.exitCode).toBeUndefined();
  });

  it('outputs JSON with --json flag', async () => {
    const output = captureOutput();
    const { createPmCommand } = await loadCommand();
    const cmd = createPmCommand();
    await cmd.parseAsync(['init', 'TestApp', '--prefix', 'TST', '--json'], { from: 'user' });

    const parsed = JSON.parse(output.stdout());
    expect(parsed.prefix).toBe('TST');
    expect(parsed.status).toBe('active');
    expect(parsed.display_id).toBe('TST');
  });

  it('returns error for duplicate prefix', async () => {
    await createProject(db, config, embedder, { name: 'First', prefix: 'DUP' });

    const output = captureOutput();
    const { createPmCommand } = await loadCommand();
    const cmd = createPmCommand();
    await cmd.parseAsync(['init', 'Second', '--prefix', 'DUP'], { from: 'user' });

    expect(output.stderr()).toContain('PROJECT_EXISTS');
    expect(process.exitCode).toBe(1);
  });
});

describe('pm list', () => {
  it('lists projects as text', async () => {
    await createProject(db, config, embedder, { name: 'Alpha', prefix: 'ALP' });
    await createProject(db, config, embedder, { name: 'Beta', prefix: 'BET' });

    const output = captureOutput();
    const { createPmCommand } = await loadCommand();
    const cmd = createPmCommand();
    await cmd.parseAsync(['list'], { from: 'user' });

    const out = output.stdout();
    expect(out).toContain('ALP');
    expect(out).toContain('BET');
    expect(out).toContain('active');
  });

  it('returns JSON array with --json flag', async () => {
    await createProject(db, config, embedder, { name: 'Alpha', prefix: 'ALP' });

    const output = captureOutput();
    const { createPmCommand } = await loadCommand();
    const cmd = createPmCommand();
    await cmd.parseAsync(['list', '--json'], { from: 'user' });

    const parsed = JSON.parse(output.stdout());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].prefix).toBe('ALP');
  });

  it('shows "No projects found" when empty', async () => {
    const output = captureOutput();
    const { createPmCommand } = await loadCommand();
    const cmd = createPmCommand();
    await cmd.parseAsync(['list'], { from: 'user' });

    expect(output.stdout()).toContain('No projects found');
  });
});

describe('pm status', () => {
  it('shows project overview with task counts', async () => {
    await createProject(db, config, embedder, { name: 'StatusApp', prefix: 'STA' });
    setActiveProject(db, 'STA');

    const output = captureOutput();
    const { createPmCommand } = await loadCommand();
    const cmd = createPmCommand();
    await cmd.parseAsync(['status'], { from: 'user' });

    const out = output.stdout();
    expect(out).toContain('STA');
    expect(out).toContain('Workstreams:');
    expect(out).toContain('Tasks:');
    expect(out).toContain('Priority:');
  });

  it('returns structured JSON with --json flag', async () => {
    await createProject(db, config, embedder, { name: 'StatusApp', prefix: 'STA' });
    setActiveProject(db, 'STA');

    const output = captureOutput();
    const { createPmCommand } = await loadCommand();
    const cmd = createPmCommand();
    await cmd.parseAsync(['status', '--json'], { from: 'user' });

    const parsed = JSON.parse(output.stdout());
    expect(parsed.prefix).toBe('STA');
    expect(parsed.taskCounts).toBeDefined();
    expect(parsed.taskCounts.total).toBe(0);
    expect(parsed.workstreamCount).toBe(0);
  });

  it('errors when no active project is set', async () => {
    const output = captureOutput();
    const { createPmCommand } = await loadCommand();
    const cmd = createPmCommand();
    await cmd.parseAsync(['status'], { from: 'user' });

    expect(output.stderr()).toContain('No project specified');
    expect(process.exitCode).toBe(1);
  });
});

describe('pm use', () => {
  it('sets active project successfully', async () => {
    await createProject(db, config, embedder, { name: 'UseApp', prefix: 'USE' });

    const output = captureOutput();
    const { createPmCommand } = await loadCommand();
    const cmd = createPmCommand();
    await cmd.parseAsync(['use', 'USE'], { from: 'user' });

    expect(output.stdout()).toContain('Active project set to USE');
    expect(process.exitCode).toBeUndefined();
  });

  it('shows error for unknown prefix', async () => {
    const output = captureOutput();
    const { createPmCommand } = await loadCommand();
    const cmd = createPmCommand();
    await cmd.parseAsync(['use', 'NOPE'], { from: 'user' });

    expect(output.stderr()).toContain('NOT_FOUND');
    expect(process.exitCode).toBe(1);
  });
});

describe('project update', () => {
  it('updates project fields', async () => {
    await createProject(db, config, embedder, { name: 'UpdApp', prefix: 'UPD' });

    const output = captureOutput();
    const { createProjectCommands } = await loadCommand();
    const cmd = createProjectCommands();
    await cmd.parseAsync(['update', 'UPD', '--status', 'paused', '--phase', 'beta'], {
      from: 'user',
    });

    const out = output.stdout();
    expect(out).toContain('UPD');
    expect(out).toContain('paused');
  });

  it('outputs JSON with --json flag', async () => {
    await createProject(db, config, embedder, { name: 'UpdApp', prefix: 'UPD' });

    const output = captureOutput();
    const { createProjectCommands } = await loadCommand();
    const cmd = createProjectCommands();
    await cmd.parseAsync(['update', 'UPD', '--phase', 'alpha', '--json'], { from: 'user' });

    const parsed = JSON.parse(output.stdout());
    expect(parsed.prefix).toBe('UPD');
    expect(parsed.phase).toBe('alpha');
  });
});

describe('project delete', () => {
  it('deletes project successfully', async () => {
    await createProject(db, config, embedder, { name: 'DelApp', prefix: 'DEL' });

    const output = captureOutput();
    const { createProjectCommands } = await loadCommand();
    const cmd = createProjectCommands();
    await cmd.parseAsync(['delete', 'DEL'], { from: 'user' });

    expect(output.stdout()).toContain('Deleted project DEL');
    expect(process.exitCode).toBeUndefined();
  });

  it('errors when project not found', async () => {
    const output = captureOutput();
    const { createProjectCommands } = await loadCommand();
    const cmd = createProjectCommands();
    await cmd.parseAsync(['delete', 'GONE'], { from: 'user' });

    expect(output.stderr()).toContain('NOT_FOUND');
    expect(process.exitCode).toBe(1);
  });

  it('outputs JSON on delete with --json flag', async () => {
    await createProject(db, config, embedder, { name: 'DelJson', prefix: 'DLJ' });

    const output = captureOutput();
    const { createProjectCommands } = await loadCommand();
    const cmd = createProjectCommands();
    await cmd.parseAsync(['delete', 'DLJ', '--json'], { from: 'user' });

    const parsed = JSON.parse(output.stdout());
    expect(parsed.deleted).toBe(true);
    expect(parsed.prefix).toBe('DLJ');
  });

  it('errors on delete not-found with --json flag', async () => {
    const output = captureOutput();
    const { createProjectCommands } = await loadCommand();
    const cmd = createProjectCommands();
    await cmd.parseAsync(['delete', 'MISS', '--json'], { from: 'user' });

    const parsed = JSON.parse(output.stderr());
    expect(parsed.code).toBe('NOT_FOUND');
    expect(process.exitCode).toBe(1);
  });
});
