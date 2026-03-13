import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  gitSafetyCheck,
  extractGitCommands,
  isDestructiveGitCommand,
  markerPath,
} from '../../src/hooks/checks/git-safety.js';
import { ownershipCheck } from '../../src/hooks/checks/ownership.js';
import { wipCheck } from '../../src/hooks/checks/wip.js';
import { workspaceCheck } from '../../src/hooks/checks/workspace.js';
import { evaluateDod, dodCheck } from '../../src/hooks/checks/dod.js';
import { hookAllow, hookBlock, hookAllowJson } from '../../src/hooks/types.js';
import { DEFAULT_HOOK_CONFIG } from '../../src/hooks/config.js';
import type { HookInput, HookConfig } from '../../src/hooks/types.js';

function makeInput(parsed: Record<string, unknown> = {}, cwd?: string): HookInput {
  return { event: 'pre-tool-use', raw: '', parsed, cwd: cwd ?? '/test' };
}

function makeBashInput(command: string, cwd = '/test'): HookInput {
  return {
    event: 'pre-tool-use',
    raw: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    parsed: { tool_name: 'Bash', tool_input: { command } },
    cwd,
  };
}

// ─── hook-result helpers ────────────────────────────────────────────────────

describe('hookAllow', () => {
  it('returns exit code 0', () => {
    expect(hookAllow().exitCode).toBe(0);
  });

  it('returns empty stdout when no message provided', () => {
    expect(hookAllow().stdout).toBe('');
  });

  it('returns message as stdout when provided', () => {
    expect(hookAllow('hello').stdout).toBe('hello');
  });
});

describe('hookBlock', () => {
  it('returns exit code 2', () => {
    expect(hookBlock('reason').exitCode).toBe(2);
  });

  it('returns reason as stderr', () => {
    expect(hookBlock('file outside ownership').stderr).toBe('file outside ownership');
  });

  it('returns empty stdout', () => {
    expect(hookBlock('reason').stdout).toBe('');
  });
});

describe('hookAllowJson', () => {
  it('returns exit code 0', () => {
    expect(hookAllowJson('ctx').exitCode).toBe(0);
  });

  it('encodes context in additionalContext field', () => {
    const result = hookAllowJson('my context');
    const parsed = JSON.parse(result.stdout) as { additionalContext: string };
    expect(parsed.additionalContext).toBe('my context');
  });

  it('returns valid JSON with no context', () => {
    const result = hookAllowJson();
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });
});

// ─── extractGitCommands ─────────────────────────────────────────────────────

describe('extractGitCommands', () => {
  it('extracts a simple git command', () => {
    expect(extractGitCommands('git push --force')).toEqual(['git push --force']);
  });

  it('extracts git commands from && chains', () => {
    expect(extractGitCommands('npm test && git push --force origin main')).toEqual([
      'git push --force origin main',
    ]);
  });

  it('extracts git commands from || chains', () => {
    expect(extractGitCommands('git status || git reset --hard')).toEqual([
      'git status',
      'git reset --hard',
    ]);
  });

  it('extracts git commands from semicolon-separated commands', () => {
    expect(extractGitCommands('echo hello; git clean -f; ls')).toEqual(['git clean -f']);
  });

  it('extracts git commands from pipes', () => {
    expect(extractGitCommands('git log | grep fix')).toEqual(['git log']);
  });

  it('handles mixed separators', () => {
    const result = extractGitCommands(
      'git status && echo ok; git push --force || git reset --hard'
    );
    expect(result).toContain('git status');
    expect(result).toContain('git push --force');
    expect(result).toContain('git reset --hard');
  });

  it('returns empty array for non-git commands', () => {
    expect(extractGitCommands('npm test && echo done')).toEqual([]);
  });

  it('trims whitespace from extracted commands', () => {
    expect(extractGitCommands('  git push --force  ')).toEqual(['git push --force']);
  });
});

// ─── isDestructiveGitCommand ────────────────────────────────────────────────

describe('isDestructiveGitCommand', () => {
  it('detects git push --force', () => {
    expect(isDestructiveGitCommand('git push --force')).toBe(true);
  });

  it('detects git push -f', () => {
    expect(isDestructiveGitCommand('git push -f')).toBe(true);
  });

  it('detects git push --force-with-lease', () => {
    expect(isDestructiveGitCommand('git push --force-with-lease')).toBe(true);
  });

  it('detects git push --force origin main', () => {
    expect(isDestructiveGitCommand('git push --force origin main')).toBe(true);
  });

  it('detects git reset --hard', () => {
    expect(isDestructiveGitCommand('git reset --hard')).toBe(true);
  });

  it('detects git reset --hard HEAD~1', () => {
    expect(isDestructiveGitCommand('git reset --hard HEAD~1')).toBe(true);
  });

  it('detects git clean -f', () => {
    expect(isDestructiveGitCommand('git clean -f')).toBe(true);
  });

  it('detects git clean -fd', () => {
    expect(isDestructiveGitCommand('git clean -fd')).toBe(true);
  });

  it('detects git checkout -- .', () => {
    expect(isDestructiveGitCommand('git checkout -- .')).toBe(true);
  });

  it('detects git checkout .', () => {
    expect(isDestructiveGitCommand('git checkout .')).toBe(true);
  });

  it('detects git restore --staged --worktree .', () => {
    expect(isDestructiveGitCommand('git restore --staged --worktree .')).toBe(true);
  });

  it('detects git restore .', () => {
    expect(isDestructiveGitCommand('git restore .')).toBe(true);
  });

  it('detects git branch -D', () => {
    expect(isDestructiveGitCommand('git branch -D feature')).toBe(true);
  });

  it('detects git stash drop', () => {
    expect(isDestructiveGitCommand('git stash drop')).toBe(true);
  });

  it('detects git rebase -i', () => {
    expect(isDestructiveGitCommand('git rebase -i HEAD~3')).toBe(true);
  });

  it('allows git push (no force)', () => {
    expect(isDestructiveGitCommand('git push')).toBe(false);
  });

  it('allows git push origin main', () => {
    expect(isDestructiveGitCommand('git push origin main')).toBe(false);
  });

  it('allows git status', () => {
    expect(isDestructiveGitCommand('git status')).toBe(false);
  });

  it('allows git log', () => {
    expect(isDestructiveGitCommand('git log')).toBe(false);
  });

  it('allows git commit', () => {
    expect(isDestructiveGitCommand("git commit -m 'test'")).toBe(false);
  });

  it('allows git add', () => {
    expect(isDestructiveGitCommand('git add .')).toBe(false);
  });

  it('allows git diff', () => {
    expect(isDestructiveGitCommand('git diff')).toBe(false);
  });

  it('allows git branch (no -D)', () => {
    expect(isDestructiveGitCommand('git branch feature')).toBe(false);
  });

  it('allows git reset without --hard', () => {
    expect(isDestructiveGitCommand('git reset HEAD~1')).toBe(false);
  });

  it('allows git checkout branch name', () => {
    expect(isDestructiveGitCommand('git checkout feature-branch')).toBe(false);
  });

  it('allows git restore specific file', () => {
    expect(isDestructiveGitCommand('git restore src/foo.ts')).toBe(false);
  });

  it('allows git stash (no drop)', () => {
    expect(isDestructiveGitCommand('git stash')).toBe(false);
  });
});

// ─── gitSafetyCheck ─────────────────────────────────────────────────────────

describe('git-safety check', () => {
  it('has correct name and event', () => {
    expect(gitSafetyCheck.name).toBe('git-safety');
    expect(gitSafetyCheck.event).toBe('pre-tool-use');
  });

  it('is disabled when gitSafety is false', () => {
    expect(gitSafetyCheck.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);
  });

  it('is enabled when gitSafety is true', () => {
    const config: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, gitSafety: true },
    };
    expect(gitSafetyCheck.enabled(config)).toBe(true);
  });

  it('allows non-Bash tools', () => {
    const config: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, gitSafety: true },
    };
    const result = gitSafetyCheck.run(
      makeInput({ tool_name: 'Write', tool_input: { file_path: '/test.ts' } }),
      config
    );
    expect(result.exitCode).toBe(0);
  });

  it('allows safe git commands', () => {
    const config: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, gitSafety: true },
    };
    expect(gitSafetyCheck.run(makeBashInput('git status'), config).exitCode).toBe(0);
  });

  it('allows non-git bash commands', () => {
    const config: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, gitSafety: true },
    };
    expect(gitSafetyCheck.run(makeBashInput('npm test'), config).exitCode).toBe(0);
  });

  it('blocks destructive git commands when blockOnce is false', () => {
    const config: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: {
        ...DEFAULT_HOOK_CONFIG.enforcement,
        gitSafety: true,
        gitSafetyBlockOnce: false,
      },
    };
    const result = gitSafetyCheck.run(makeBashInput('git push --force'), config);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('git push --force');
  });

  it('blocks destructive commands embedded in compound expressions', () => {
    const config: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: {
        ...DEFAULT_HOOK_CONFIG.enforcement,
        gitSafety: true,
        gitSafetyBlockOnce: false,
      },
    };
    const result = gitSafetyCheck.run(makeBashInput('npm test && git reset --hard'), config);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('git reset --hard');
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
        enforcement: {
          ...DEFAULT_HOOK_CONFIG.enforcement,
          gitSafety: true,
          gitSafetyBlockOnce: true,
        },
      };
      const input = makeBashInput('git push --force origin main', tmpDir);

      const result = gitSafetyCheck.run(input, config);
      expect(result.exitCode).toBe(2);

      const marker = markerPath(tmpDir, 'git push --force origin main');
      expect(existsSync(marker)).toBe(true);
    });

    it('allows second time and removes marker', () => {
      const config: HookConfig = {
        ...DEFAULT_HOOK_CONFIG,
        enforcement: {
          ...DEFAULT_HOOK_CONFIG.enforcement,
          gitSafety: true,
          gitSafetyBlockOnce: true,
        },
      };
      const input = makeBashInput('git push --force origin main', tmpDir);

      gitSafetyCheck.run(input, config);
      const result = gitSafetyCheck.run(input, config);
      expect(result.exitCode).toBe(0);

      const marker = markerPath(tmpDir, 'git push --force origin main');
      expect(existsSync(marker)).toBe(false);
    });

    it('blocks again after marker is consumed', () => {
      const config: HookConfig = {
        ...DEFAULT_HOOK_CONFIG,
        enforcement: {
          ...DEFAULT_HOOK_CONFIG.enforcement,
          gitSafety: true,
          gitSafetyBlockOnce: true,
        },
      };
      const input = makeBashInput('git push --force', tmpDir);

      // First: block
      gitSafetyCheck.run(input, config);
      // Second: allow (consumes marker)
      gitSafetyCheck.run(input, config);
      // Third: block again
      const result = gitSafetyCheck.run(input, config);
      expect(result.exitCode).toBe(2);
    });

    it('uses different markers for different commands', () => {
      const config: HookConfig = {
        ...DEFAULT_HOOK_CONFIG,
        enforcement: {
          ...DEFAULT_HOOK_CONFIG.enforcement,
          gitSafety: true,
          gitSafetyBlockOnce: true,
        },
      };

      // Block both commands (creates their respective markers)
      gitSafetyCheck.run(makeBashInput('git push --force', tmpDir), config);
      gitSafetyCheck.run(makeBashInput('git reset --hard', tmpDir), config);

      // Both should be independently allowed
      const r1 = gitSafetyCheck.run(makeBashInput('git push --force', tmpDir), config);
      expect(r1.exitCode).toBe(0);

      const r2 = gitSafetyCheck.run(makeBashInput('git reset --hard', tmpDir), config);
      expect(r2.exitCode).toBe(0);
    });
  });
});

// ─── ownership check ────────────────────────────────────────────────────────

describe('ownership check', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = join(tmpdir(), `hooks-test-${Date.now()}`);
    mkdirSync(join(tmpDir, '.claude'), { recursive: true });
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is disabled when ownership is false', () => {
    expect(ownershipCheck.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);
  });

  it('is enabled when ownership is true', () => {
    const config: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, ownership: true },
    };
    expect(ownershipCheck.enabled(config)).toBe(true);
  });

  it('allows writes when no manifest exists', () => {
    const config: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, ownership: true },
    };
    const result = ownershipCheck.run(
      makeInput(
        { tool_name: 'Write', tool_input: { file_path: join(tmpDir, 'anything.ts') } },
        tmpDir
      ),
      config
    );
    expect(result.exitCode).toBe(0);
  });

  it('blocks writes outside owned paths', () => {
    const manifest = { agents: { default: { paths: ['src/'] } } };
    writeFileSync(join(tmpDir, '.claude', 'ownership.json'), JSON.stringify(manifest));

    const config: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, ownership: true },
    };
    const result = ownershipCheck.run(
      makeInput(
        { tool_name: 'Write', tool_input: { file_path: join(tmpDir, 'docs/readme.md') } },
        tmpDir
      ),
      config
    );
    expect(result.exitCode).toBe(2);
  });

  it('allows writes inside owned paths', () => {
    const manifest = { agents: { default: { paths: ['src/'] } } };
    writeFileSync(join(tmpDir, '.claude', 'ownership.json'), JSON.stringify(manifest));

    const config: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, ownership: true },
    };
    const result = ownershipCheck.run(
      makeInput(
        { tool_name: 'Write', tool_input: { file_path: join(tmpDir, 'src/index.ts') } },
        tmpDir
      ),
      config
    );
    expect(result.exitCode).toBe(0);
  });

  it('skips non-write tools', () => {
    const config: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, ownership: true },
    };
    const result = ownershipCheck.run(
      makeInput({ tool_name: 'Read', tool_input: { file_path: '/etc/passwd' } }, tmpDir),
      config
    );
    expect(result.exitCode).toBe(0);
  });

  it('treats Edit tool as a write tool', () => {
    const manifest = { agents: { default: { paths: ['src/'] } } };
    writeFileSync(join(tmpDir, '.claude', 'ownership.json'), JSON.stringify(manifest));

    const config: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, ownership: true },
    };
    const result = ownershipCheck.run(
      makeInput(
        { tool_name: 'Edit', tool_input: { file_path: join(tmpDir, 'docs/readme.md') } },
        tmpDir
      ),
      config
    );
    expect(result.exitCode).toBe(2);
  });

  it('allows writes when no file_path in tool input', () => {
    const config: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, ownership: true },
    };
    const result = ownershipCheck.run(
      makeInput({ tool_name: 'Write', tool_input: {} }, tmpDir),
      config
    );
    expect(result.exitCode).toBe(0);
  });

  it('includes agent name and allowed paths in block message', () => {
    const manifest = { agents: { default: { paths: ['src/'] } } };
    writeFileSync(join(tmpDir, '.claude', 'ownership.json'), JSON.stringify(manifest));

    const config: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, ownership: true },
    };
    const result = ownershipCheck.run(
      makeInput(
        { tool_name: 'Write', tool_input: { file_path: join(tmpDir, 'docs/readme.md') } },
        tmpDir
      ),
      config
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('default');
    expect(result.stderr).toContain('src/');
  });
});

// ─── dod check ──────────────────────────────────────────────────────────────

describe('dod check', () => {
  it('is disabled when dod is false', () => {
    expect(dodCheck.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);
  });

  it('is enabled when dod is true', () => {
    const config: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, dod: true },
    };
    expect(dodCheck.enabled(config)).toBe(true);
  });

  it('has correct name and event', () => {
    expect(dodCheck.name).toBe('dod');
    expect(dodCheck.event).toBe('task-completed');
  });
});

describe('evaluateDod', () => {
  it('allows when no spec provided', () => {
    expect(evaluateDod(null).exitCode).toBe(0);
  });

  it('allows when all required criteria pass', () => {
    const result = evaluateDod({
      name: 'test',
      criteria: [
        { name: 'check1', check: 'true', required: true },
        { name: 'check2', check: 'true', required: true },
      ],
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

  it('includes failing criterion name in error message', () => {
    const result = evaluateDod({
      name: 'test',
      criteria: [{ name: 'typecheck', check: 'exit 1', required: true }],
    });
    expect(result.stderr).toContain('typecheck');
  });

  it('allows when optional criterion fails', () => {
    const result = evaluateDod({
      name: 'test',
      criteria: [{ name: 'optional', check: 'exit 1', required: false }],
    });
    expect(result.exitCode).toBe(0);
  });

  it('blocks when at least one required criterion fails among multiple', () => {
    const result = evaluateDod({
      name: 'test',
      criteria: [
        { name: 'passes', check: 'true', required: true },
        { name: 'fails', check: 'exit 1', required: true },
      ],
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('fails');
  });
});

// ─── wip check ──────────────────────────────────────────────────────────────

describe('wip check', () => {
  it('is disabled when wipLimit is 0', () => {
    expect(wipCheck.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);
  });

  it('is enabled when wipLimit > 0', () => {
    const config: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, wipLimit: 4 },
    };
    expect(wipCheck.enabled(config)).toBe(true);
  });

  it('has correct name and event', () => {
    expect(wipCheck.name).toBe('wip');
    expect(wipCheck.event).toBe('prompt-submit');
  });
});

// ─── workspace check ─────────────────────────────────────────────────────────

describe('workspace check', () => {
  it('is disabled when workspaceClean is false', () => {
    expect(workspaceCheck.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);
  });

  it('is enabled when workspaceClean is true', () => {
    const config: HookConfig = {
      ...DEFAULT_HOOK_CONFIG,
      enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, workspaceClean: true },
    };
    expect(workspaceCheck.enabled(config)).toBe(true);
  });

  it('has correct name and event', () => {
    expect(workspaceCheck.name).toBe('workspace');
    expect(workspaceCheck.event).toBe('prompt-submit');
  });
});
