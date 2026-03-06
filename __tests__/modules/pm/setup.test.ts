import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';

function makeTempClaudeDir(): string {
  return mkdtempSync(join(tmpdir(), 'brain-setup-test-'));
}

const mockWithBrain = vi.fn();

vi.mock('../../../src/services/brain-service.js', () => ({
  withBrain: (...args: unknown[]) => mockWithBrain(...args),
}));

const mockCreateProject = vi.fn();
vi.mock('../../../src/modules/pm/data/project-ops.js', () => ({
  createProject: (...args: unknown[]) => mockCreateProject(...args),
}));

const mockCreateWorkstream = vi.fn();
vi.mock('../../../src/modules/pm/data/workstream-ops.js', () => ({
  createWorkstream: (...args: unknown[]) => mockCreateWorkstream(...args),
}));

const mockCreateTask = vi.fn();
vi.mock('../../../src/modules/pm/data/task-ops.js', () => ({
  createTask: (...args: unknown[]) => mockCreateTask(...args),
}));

const mockSetActiveProject = vi.fn();
vi.mock('../../../src/modules/pm/data/queries.js', () => ({
  setActiveProject: (...args: unknown[]) => mockSetActiveProject(...args),
}));

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

describe('setup command deprecation', () => {
  let claudeDir: string;
  let originalEnv: string | undefined;
  let output: ReturnType<typeof captureOutput>;

  beforeEach(() => {
    claudeDir = makeTempClaudeDir();
    originalEnv = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeDir;
    process.exitCode = undefined;
    output = captureOutput();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = originalEnv;
    } else {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  test('shows deprecation message without --demo', async () => {
    const { createSetupCommand } = await import('../../../src/modules/pm/commands/setup.js');
    const cmd = createSetupCommand();
    await cmd.parseAsync([], { from: 'user' });

    expect(output.stderr()).toContain('DEPRECATED');
    expect(output.stderr()).toContain('ao hook install');
    expect(process.exitCode).toBe(1);
  });

  test('--dry-run without --demo shows deprecation', async () => {
    const { createSetupCommand } = await import('../../../src/modules/pm/commands/setup.js');
    const cmd = createSetupCommand();
    await cmd.parseAsync(['--dry-run'], { from: 'user' });

    const out = output.stdout();
    expect(out).toContain('Would install:');
    expect(out).toContain('DEPRECATED');
    expect(existsSync(join(claudeDir, 'hooks'))).toBe(false);
  });

  test('--dry-run --demo mentions demo project', async () => {
    const { createSetupCommand } = await import('../../../src/modules/pm/commands/setup.js');
    const cmd = createSetupCommand();
    await cmd.parseAsync(['--dry-run', '--demo'], { from: 'user' });

    expect(output.stdout()).toContain('Demo project');
  });
});

describe('setup --demo', () => {
  let claudeDir: string;
  let originalEnv: string | undefined;
  let output: ReturnType<typeof captureOutput>;
  const fakeSvc = { db: {}, config: { notesDir: '/tmp/notes' }, embedder: {} };

  beforeEach(async () => {
    claudeDir = makeTempClaudeDir();
    originalEnv = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeDir;
    process.exitCode = undefined;
    output = captureOutput();

    mockWithBrain.mockImplementation(async (fn: (svc: unknown) => unknown) => fn(fakeSvc));

    mockCreateProject.mockResolvedValue({
      ok: true,
      data: { display_id: 'DEMO', prefix: 'DEMO', status: 'active' },
    });
    mockCreateWorkstream
      .mockResolvedValueOnce({
        ok: true,
        data: { display_id: 'DEMO-01', project: 'DEMO', number: 1, status: 'active' },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { display_id: 'DEMO-02', project: 'DEMO', number: 2, status: 'active' },
      });
    mockCreateTask
      .mockResolvedValueOnce({ ok: true, data: { display_id: 'DEMO-01.01' } })
      .mockResolvedValueOnce({ ok: true, data: { display_id: 'DEMO-01.02' } })
      .mockResolvedValueOnce({ ok: true, data: { display_id: 'DEMO-02.01' } })
      .mockResolvedValueOnce({ ok: true, data: { display_id: 'DEMO-02.02' } });
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = originalEnv;
    } else {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
    process.exitCode = undefined;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  test('creates project, workstreams, and tasks', async () => {
    const { createSetupCommand } = await import('../../../src/modules/pm/commands/setup.js');
    const cmd = createSetupCommand();
    await cmd.parseAsync(['--demo', '--json'], { from: 'user' });

    expect(mockCreateProject).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ name: 'Demo Project', prefix: 'DEMO' })
    );
    expect(mockSetActiveProject).toHaveBeenCalledWith(expect.anything(), 'DEMO');
    expect(mockCreateWorkstream).toHaveBeenCalledTimes(2);
    expect(mockCreateTask).toHaveBeenCalledTimes(4);

    const parsed = JSON.parse(output.stdout());
    expect(parsed.demo).toBeDefined();
    expect(parsed.demo.success).toBe(true);
  });

  test('reports demo failure without blocking status output', async () => {
    mockCreateProject.mockResolvedValueOnce({
      ok: false,
      error: { error: true, code: 'PROJECT_EXISTS', message: 'DEMO already exists' },
    });

    const { createSetupCommand } = await import('../../../src/modules/pm/commands/setup.js');
    const cmd = createSetupCommand();
    await cmd.parseAsync(['--demo', '--json'], { from: 'user' });

    const parsed = JSON.parse(output.stdout());
    expect(parsed.demo.success).toBe(false);
    expect(parsed.demo.error).toContain('DEMO already exists');
    expect(parsed.checks).toBeDefined();
    expect(process.exitCode).toBe(1);
  });

  test('passes correct dependencies to tasks', async () => {
    const { createSetupCommand } = await import('../../../src/modules/pm/commands/setup.js');
    const cmd = createSetupCommand();
    await cmd.parseAsync(['--demo', '--json'], { from: 'user' });

    const calls = mockCreateTask.mock.calls;

    // First task has no dependencies
    expect(calls[0][3].dependsOn).toBeUndefined();

    // Second task depends on first
    expect(calls[1][3].dependsOn).toEqual(['DEMO-01.01']);

    // Third task depends on second
    expect(calls[2][3].dependsOn).toEqual(['DEMO-01.02']);

    // Fourth task depends on second
    expect(calls[3][3].dependsOn).toEqual(['DEMO-01.02']);
  });
});
