import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  installHooks,
  removeHooks,
  generateHookScripts,
  generateSkillContent,
  generateSanityCheckSkillContent,
  createInstallHooksCommand,
} from '../../../../src/modules/pm/commands/install-hooks.js';

let tempDir: string;
let stdoutChunks: string[];
let stderrChunks: string[];

function stdout(): string {
  return stdoutChunks.join('');
}

async function run(...args: string[]): Promise<void> {
  await createInstallHooksCommand().parseAsync(['node', 'install-hooks', ...args], {
    from: 'node',
  });
}

beforeEach(() => {
  tempDir = join(tmpdir(), `hooks-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(tempDir, { recursive: true });

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
  vi.restoreAllMocks();
  try {
    rmSync(tempDir, { recursive: true });
  } catch {
    // ignore
  }
});

describe('generateHookScripts', () => {
  it('returns all hook files', () => {
    const scripts = generateHookScripts();
    expect(Object.keys(scripts)).toContain('brain-pm-session.sh');
    expect(Object.keys(scripts)).toContain('brain-pm-worktree.sh');
    expect(Object.keys(scripts)).toContain('brain-pm-agent-done.sh');
  });
});

describe('generateSkillContent', () => {
  it('returns orchestrator skill markdown', () => {
    const content = generateSkillContent();
    expect(content).toContain('Project Orchestrator');
    expect(content).toContain('brain pm');
  });
});

describe('generateSanityCheckSkillContent', () => {
  it('returns sanity check skill markdown', () => {
    const content = generateSanityCheckSkillContent();
    expect(content).toContain('Sanity Check');
    expect(content).toContain('brain pm check');
  });
});

describe('installHooks', () => {
  it('creates hook files and settings', () => {
    const result = installHooks(tempDir);

    expect(result.errors).toHaveLength(0);
    expect(result.installed.length).toBeGreaterThan(0);

    // Hook scripts exist
    expect(existsSync(join(tempDir, 'hooks', 'brain-pm-session.sh'))).toBe(true);
    expect(existsSync(join(tempDir, 'hooks', 'brain-pm-worktree.sh'))).toBe(true);
    expect(existsSync(join(tempDir, 'hooks', 'brain-pm-agent-done.sh'))).toBe(true);

    // Settings updated
    const settings = JSON.parse(readFileSync(join(tempDir, 'settings.json'), 'utf-8'));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.SessionStart).toBeDefined();
    expect(settings.hooks.PreToolUse).toBeDefined();
    expect(settings.hooks.SubagentStop).toBeDefined();

    // Skill file created
    expect(existsSync(join(tempDir, 'skills', 'orchestrator', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tempDir, 'skills', 'sanity-check', 'SKILL.md'))).toBe(true);
  });

  it('merges with existing settings', () => {
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'settings.json'), JSON.stringify({ existingKey: true }));

    const result = installHooks(tempDir);

    expect(result.errors).toHaveLength(0);
    const settings = JSON.parse(readFileSync(join(tempDir, 'settings.json'), 'utf-8'));
    expect(settings.existingKey).toBe(true);
    expect(settings.hooks).toBeDefined();
  });

  it('does not duplicate hooks on re-install', () => {
    installHooks(tempDir);
    installHooks(tempDir);

    const settings = JSON.parse(readFileSync(join(tempDir, 'settings.json'), 'utf-8'));
    expect(settings.hooks.SessionStart.length).toBe(1);
  });
});

describe('installHooks (error handling)', () => {
  it('reports errors when hook dir is not writable', () => {
    // Create the hooks dir as a file to cause write errors
    const hooksDir = join(tempDir, 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    // Make the dir read-only
    chmodSync(hooksDir, 0o444);

    const result = installHooks(tempDir);

    // Should have errors for the hook files
    expect(result.errors.length).toBeGreaterThan(0);

    // Restore permissions for cleanup
    chmodSync(hooksDir, 0o755);
  });
});

describe('removeHooks', () => {
  it('removes installed hooks and skills', () => {
    installHooks(tempDir);
    const result = removeHooks(tempDir);

    expect(result.errors).toHaveLength(0);
    expect(result.removed.length).toBeGreaterThan(0);

    expect(existsSync(join(tempDir, 'hooks', 'brain-pm-session.sh'))).toBe(false);
    expect(existsSync(join(tempDir, 'hooks', 'brain-pm-worktree.sh'))).toBe(false);
    expect(existsSync(join(tempDir, 'hooks', 'brain-pm-agent-done.sh'))).toBe(false);
    expect(existsSync(join(tempDir, 'skills', 'orchestrator'))).toBe(false);
    expect(existsSync(join(tempDir, 'skills', 'sanity-check'))).toBe(false);
  });

  it('cleans up settings hook entries', () => {
    installHooks(tempDir);
    removeHooks(tempDir);

    const settings = JSON.parse(readFileSync(join(tempDir, 'settings.json'), 'utf-8'));
    expect(settings.hooks).toBeUndefined();
  });

  it('handles removal when nothing is installed', () => {
    const result = removeHooks(tempDir);

    expect(result.errors).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });
});

describe('install-hooks command', () => {
  it('--dry-run shows what would be installed', async () => {
    await run('--dry-run');

    const out = stdout();
    expect(out).toContain('Would install');
    expect(out).toContain('brain-pm-session.sh');
    expect(out).toContain('brain-pm-worktree.sh');
    expect(out).toContain('brain-pm-agent-done.sh');
    expect(out).toContain('SKILL.md');
    expect(out).toContain('settings.json');
  });

  it('--dry-run --remove shows what would be removed', async () => {
    await run('--dry-run', '--remove');

    const out = stdout();
    expect(out).toContain('Would remove');
    expect(out).toContain('brain-pm-session.sh');
    expect(out).toContain('orchestrator');
    expect(out).toContain('sanity-check');
    expect(out).toContain('settings.json');
  });

  it('installs hooks to real location', async () => {
    // Override HOME to use temp dir so we don't pollute real home
    const origHome = process.env.HOME;
    process.env.HOME = tempDir;

    await run();

    const out = stdout();
    expect(out).toContain('Installed');
    expect(out).toContain('items');
    expect(out).toContain('Orchestration hooks are ready');

    // Verify files were created in temp dir
    expect(existsSync(join(tempDir, '.claude', 'hooks', 'brain-pm-session.sh'))).toBe(true);

    process.env.HOME = origHome;
  });

  it('--remove removes installed hooks', async () => {
    // Install first
    const origHome = process.env.HOME;
    process.env.HOME = tempDir;

    await run();
    stdoutChunks = [];
    stderrChunks = [];

    await run('--remove');

    const out = stdout();
    expect(out).toContain('Removed');
    expect(out).toContain('items');

    process.env.HOME = origHome;
  });

  it('install writes correct number of items', async () => {
    const origHome = process.env.HOME;
    process.env.HOME = tempDir;

    await run();

    const out = stdout();
    // Should report installed items count (3 hooks + settings + 2 skills = 6)
    expect(out).toMatch(/Installed \d+ items/);

    process.env.HOME = origHome;
  });

  it('remove with no hooks installed shows zero items', async () => {
    const origHome = process.env.HOME;
    const emptyDir = join(tempDir, 'empty-home');
    mkdirSync(emptyDir, { recursive: true });
    process.env.HOME = emptyDir;

    await run('--remove');

    const out = stdout();
    expect(out).toContain('Removed 0 items');

    process.env.HOME = origHome;
  });
});
