import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gitSafetyCheck, extractGitCommands, isDestructiveGitCommand, markerPath } from '../../src/hooks/checks/git-safety.js';
import { ownershipCheck } from '../../src/hooks/checks/ownership.js';
import { wipCheck } from '../../src/hooks/checks/wip.js';
import { evaluateDod } from '../../src/hooks/checks/dod.js';
import { DEFAULT_HOOK_CONFIG } from '../../src/hooks/config.js';
import type { HookInput, HookConfig } from '../../src/hooks/types.js';

function makeInput(parsed: Record<string, unknown> = {}, cwd?: string): HookInput {
  return { event: 'pre-tool-use', raw: '', parsed, cwd: cwd ?? '/test' };
}

describe('git-safety check', () => {
  it('extracts git commands from compound command', () => {
    const cmds = extractGitCommands('npm test && git push --force origin main');
    expect(cmds).toEqual(['git push --force origin main']);
  });

  it('identifies destructive commands', () => {
    expect(isDestructiveGitCommand('git push --force origin main')).toBe(true);
    expect(isDestructiveGitCommand('git reset --hard')).toBe(true);
    expect(isDestructiveGitCommand('git branch -D feature')).toBe(true);
    expect(isDestructiveGitCommand('git stash drop')).toBe(true);
    expect(isDestructiveGitCommand('git rebase -i HEAD~3')).toBe(true);
  });

  it('allows non-destructive git commands', () => {
    expect(isDestructiveGitCommand('git push origin main')).toBe(false);
    expect(isDestructiveGitCommand('git commit -m "test"')).toBe(false);
    expect(isDestructiveGitCommand('git branch feature')).toBe(false);
    expect(isDestructiveGitCommand('git stash')).toBe(false);
  });

  it('allows non-Bash tools', () => {
    const config = { ...DEFAULT_HOOK_CONFIG, enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, gitSafety: true } };
    const result = gitSafetyCheck.run(
      makeInput({ tool_name: 'Write', tool_input: { file_path: '/test.ts' } }),
      config
    );
    expect(result.exitCode).toBe(0);
  });

  describe('block-once pattern', () => {
    let tmpDir: string;
    beforeEach(() => {
      tmpDir = join(tmpdir(), `hooks-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
    });
    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('blocks first time and creates marker', () => {
      const config: HookConfig = {
        ...DEFAULT_HOOK_CONFIG,
        enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, gitSafety: true, gitSafetyBlockOnce: true },
      };
      const input = makeInput(
        { tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } },
        tmpDir
      );

      const result = gitSafetyCheck.run(input, config);
      expect(result.exitCode).toBe(2);

      const marker = markerPath(tmpDir, 'git push --force origin main');
      expect(existsSync(marker)).toBe(true);
    });

    it('allows second time and removes marker', () => {
      const config: HookConfig = {
        ...DEFAULT_HOOK_CONFIG,
        enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, gitSafety: true, gitSafetyBlockOnce: true },
      };
      const input = makeInput(
        { tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } },
        tmpDir
      );

      gitSafetyCheck.run(input, config);
      const result = gitSafetyCheck.run(input, config);
      expect(result.exitCode).toBe(0);

      const marker = markerPath(tmpDir, 'git push --force origin main');
      expect(existsSync(marker)).toBe(false);
    });
  });
});

describe('ownership check', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = join(tmpdir(), `hooks-test-${Date.now()}`);
    mkdirSync(join(tmpDir, '.claude'), { recursive: true });
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('allows writes when no manifest exists', () => {
    const config = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, ownership: true },
    };
    const result = ownershipCheck.run(
      makeInput({ tool_name: 'Write', tool_input: { file_path: join(tmpDir, 'anything.ts') } }, tmpDir),
      config
    );
    expect(result.exitCode).toBe(0);
  });

  it('blocks writes outside owned paths', () => {
    const manifest = { agents: { default: { paths: ['src/'] } } };
    writeFileSync(join(tmpDir, '.claude', 'ownership.json'), JSON.stringify(manifest));

    const config = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, ownership: true },
    };
    const result = ownershipCheck.run(
      makeInput({ tool_name: 'Write', tool_input: { file_path: join(tmpDir, 'docs/readme.md') } }, tmpDir),
      config
    );
    expect(result.exitCode).toBe(2);
  });

  it('allows writes inside owned paths', () => {
    const manifest = { agents: { default: { paths: ['src/'] } } };
    writeFileSync(join(tmpDir, '.claude', 'ownership.json'), JSON.stringify(manifest));

    const config = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, ownership: true },
    };
    const result = ownershipCheck.run(
      makeInput({ tool_name: 'Write', tool_input: { file_path: join(tmpDir, 'src/index.ts') } }, tmpDir),
      config
    );
    expect(result.exitCode).toBe(0);
  });

  it('skips non-write tools', () => {
    const config = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, ownership: true },
    };
    const result = ownershipCheck.run(
      makeInput({ tool_name: 'Read', tool_input: { file_path: '/etc/passwd' } }, tmpDir),
      config
    );
    expect(result.exitCode).toBe(0);
  });
});

describe('dod check', () => {
  it('allows when no spec provided', () => {
    const result = evaluateDod(null);
    expect(result.exitCode).toBe(0);
  });

  it('allows when all required criteria pass', () => {
    const result = evaluateDod({
      name: 'test',
      criteria: [{ name: 'echo', check: 'echo ok', required: true }],
    });
    expect(result.exitCode).toBe(0);
  });

  it('blocks when required criterion fails', () => {
    const result = evaluateDod({
      name: 'test',
      criteria: [{ name: 'fail', check: 'exit 1', required: true }],
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Definition of Done not met');
  });

  it('allows when optional criterion fails', () => {
    const result = evaluateDod({
      name: 'test',
      criteria: [{ name: 'optional', check: 'exit 1', required: false }],
    });
    expect(result.exitCode).toBe(0);
  });
});

describe('wip check', () => {
  it('is disabled when wipLimit is 0', () => {
    expect(wipCheck.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);
  });

  it('is enabled when wipLimit > 0', () => {
    const config = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, wipLimit: 4 },
    };
    expect(wipCheck.enabled(config)).toBe(true);
  });
});
