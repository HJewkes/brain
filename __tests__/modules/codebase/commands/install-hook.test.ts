import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  installHook,
  resolveHookPath,
} from '../../../../src/modules/codebase/commands/install-hook.js';

function makeTmpGitDir(): string {
  const dir = join(tmpdir(), `brain-hook-test-${randomUUID()}`, '.git');
  mkdirSync(join(dir, 'hooks'), { recursive: true });
  return dir;
}

describe('install-hook', () => {
  let gitDir: string;

  beforeEach(() => {
    gitDir = makeTmpGitDir();
  });

  afterEach(() => {
    const root = join(gitDir, '..');
    rmSync(root, { recursive: true, force: true });
  });

  it('installs hook to .git/hooks/post-merge', () => {
    const result = installHook(gitDir, {});
    const hookPath = resolveHookPath(gitDir);

    expect(result.installed).toBe(true);
    expect(result.path).toBe(hookPath);
    expect(existsSync(hookPath)).toBe(true);

    const content = readFileSync(hookPath, 'utf-8');
    expect(content).toContain('after merge');
    expect(content).toContain('codebase index');
  });

  it('warns if hook already exists', () => {
    const hookPath = resolveHookPath(gitDir);
    writeFileSync(hookPath, '#!/bin/bash\necho existing', 'utf-8');

    const result = installHook(gitDir, {});

    expect(result.installed).toBe(false);
    expect(result.skipped).toBe(true);

    const content = readFileSync(hookPath, 'utf-8');
    expect(content).toContain('existing');
  });

  it('--force overwrites existing hook', () => {
    const hookPath = resolveHookPath(gitDir);
    writeFileSync(hookPath, '#!/bin/bash\necho existing', 'utf-8');

    const result = installHook(gitDir, { force: true });

    expect(result.installed).toBe(true);
    expect(result.overwritten).toBe(true);

    const content = readFileSync(hookPath, 'utf-8');
    expect(content).toContain('codebase index');
    expect(content).not.toContain('existing');
  });

  it('hook script is executable', () => {
    installHook(gitDir, {});
    const hookPath = resolveHookPath(gitDir);
    const stats = statSync(hookPath);
    const mode = stats.mode & 0o777;

    expect(mode & 0o111).not.toBe(0);
  });

  it('creates hooks directory if missing', () => {
    const bareGitDir = join(tmpdir(), `brain-hook-test-${randomUUID()}`, '.git');
    mkdirSync(bareGitDir, { recursive: true });

    const result = installHook(bareGitDir, {});

    expect(result.installed).toBe(true);
    expect(existsSync(resolveHookPath(bareGitDir))).toBe(true);

    rmSync(join(bareGitDir, '..'), { recursive: true, force: true });
  });
});
