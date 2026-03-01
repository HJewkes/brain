import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../../helpers.js';
import type { BrainConfig } from '../../../../src/types.js';
import { createProject } from '../../../../src/modules/pm/data/project-ops.js';
import { setActiveProject } from '../../../../src/modules/pm/data/queries.js';

vi.mock('../../../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(),
}));

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

let stdoutData: string;
let stderrData: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  dbPath = tmpDbPath('pm-workstream');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-workstream-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  // Create a project as prerequisite
  await createProject(db, config, embedder, { name: 'TestApp', prefix: 'TST' });
  setActiveProject(db, 'TST');

  // Mock withBrain to use our real db/config/embedder
  const { withBrain } = await import('../../../../src/services/brain-service.js');
  vi.mocked(withBrain).mockImplementation(async (fn) => {
    return fn({ db, config, embedder, modules: {} as never, close: () => {} });
  });

  stdoutData = '';
  stderrData = '';
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
    stdoutData += String(data);
    return true;
  });
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((data) => {
    stderrData += String(data);
    return true;
  });
  process.exitCode = undefined;
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  process.exitCode = undefined;
});

async function run(args: string[]): Promise<void> {
  const { createWorkstreamCommands } = await import(
    '../../../../src/modules/pm/commands/workstream.js'
  );
  const cmd = createWorkstreamCommands();
  await cmd.parseAsync(args, { from: 'user' });
}

describe('workstream add (error paths)', () => {
  it('error when no project and no active project', async () => {
    db.close();
    db = new BrainDB(tmpDbPath('ws-add-noproj'));

    const { withBrain } = await import('../../../../src/services/brain-service.js');
    vi.mocked(withBrain).mockImplementation(async (fn) => {
      return fn({ db, config, embedder, modules: {} as never, close: () => {} });
    });

    await run(['add', 'Backend', '--project', 'NONEXIST']);

    expect(process.exitCode).toBe(1);
  });
});

describe('workstream list (error paths)', () => {
  it('error when no project and no active project', async () => {
    db.close();
    db = new BrainDB(tmpDbPath('ws-list-noproj'));

    const { withBrain } = await import('../../../../src/services/brain-service.js');
    vi.mocked(withBrain).mockImplementation(async (fn) => {
      return fn({ db, config, embedder, modules: {} as never, close: () => {} });
    });

    await run(['list']);

    expect(process.exitCode).toBe(1);
  });
});

describe('workstream add', () => {
  it('creates workstream with name', async () => {
    await run(['add', 'Backend']);

    expect(stdoutData).toContain('TST-01');
    expect(stdoutData).toContain('Backend');
    expect(stdoutData).toContain('active');
  });

  it('outputs JSON with --json', async () => {
    await run(['add', 'Frontend', '--json']);

    const parsed = JSON.parse(stdoutData);
    expect(parsed.display_id).toBe('TST-01');
    expect(parsed.project).toBe('TST');
    expect(parsed.status).toBe('active');
  });

  it('creates with --description', async () => {
    await run(['add', 'API', '--description', 'REST API layer']);

    expect(stdoutData).toContain('TST-01');
    expect(stdoutData).toContain('API');
  });
});

describe('workstream list', () => {
  it('lists workstreams as text', async () => {
    await run(['add', 'Backend']);
    stdoutData = '';
    await run(['add', 'Frontend']);
    stdoutData = '';

    await run(['list']);

    expect(stdoutData).toContain('TST-01');
    expect(stdoutData).toContain('TST-02');
  });

  it('returns array with --json', async () => {
    await run(['add', 'Backend']);
    stdoutData = '';

    await run(['list', '--json']);

    const parsed = JSON.parse(stdoutData);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].display_id).toBe('TST-01');
  });

  it('shows empty state message', async () => {
    await run(['list']);

    expect(stdoutData).toContain('No workstreams found');
  });
});

describe('workstream show', () => {
  it('shows workstream detail', async () => {
    await run(['add', 'Backend']);
    stdoutData = '';

    await run(['show', 'TST-01']);

    expect(stdoutData).toContain('TST-01');
    expect(stdoutData).toContain('active');
  });

  it('outputs JSON with --json', async () => {
    await run(['add', 'Backend']);
    stdoutData = '';

    await run(['show', 'TST-01', '--json']);

    const parsed = JSON.parse(stdoutData);
    expect(parsed.display_id).toBe('TST-01');
    expect(parsed.status).toBe('active');
  });

  it('reports not-found error', async () => {
    await run(['show', 'TST-99']);

    expect(process.exitCode).toBe(1);
    expect(stderrData).toContain('NOT_FOUND');
  });
});

describe('workstream update', () => {
  it('updates status', async () => {
    await run(['add', 'Backend']);
    stdoutData = '';

    await run(['update', 'TST-01', '--status', 'paused']);

    expect(stdoutData).toContain('TST-01');
    expect(stdoutData).toContain('paused');
  });

  it('reports not-found error', async () => {
    await run(['update', 'TST-99', '--status', 'paused']);

    expect(process.exitCode).toBe(1);
    expect(stderrData).toContain('NOT_FOUND');
  });

  it('outputs JSON with --json', async () => {
    await run(['add', 'Backend']);
    stdoutData = '';

    await run(['update', 'TST-01', '--status', 'paused', '--json']);

    const parsed = JSON.parse(stdoutData);
    expect(parsed.display_id).toBe('TST-01');
    expect(parsed.status).toBe('paused');
  });
});

describe('workstream delete', () => {
  it('deletes workstream', async () => {
    await run(['add', 'Backend']);
    stdoutData = '';

    await run(['delete', 'TST-01']);

    expect(stdoutData).toContain('Deleted');
    expect(stdoutData).toContain('TST-01');
  });

  it('reports not-found error', async () => {
    await run(['delete', 'TST-99']);

    expect(process.exitCode).toBe(1);
    expect(stderrData).toContain('NOT_FOUND');
  });

  it('outputs JSON with --json', async () => {
    await run(['add', 'Backend']);
    stdoutData = '';

    await run(['delete', 'TST-01', '--json']);

    const parsed = JSON.parse(stdoutData);
    expect(parsed.deleted).toBe(true);
    expect(parsed.id).toBe('TST-01');
  });
});
