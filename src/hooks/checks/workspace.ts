import { execSync } from 'node:child_process';
import type { HookHandler, HookInput, HookConfig, HookResult } from '../types.js';
import { hookAllow, hookAllowJson } from '../types.js';

export const workspaceCheck: HookHandler = {
  name: 'workspace',
  event: 'prompt-submit',
  priority: 50,

  enabled(config: HookConfig): boolean {
    return config.enforcement.workspaceClean;
  },

  run(input: HookInput): HookResult {
    if (!detectGitRepo()) return hookAllow();

    const status = getGitStatus();
    if (!status.trim()) return hookAllow();

    const changedFiles = status
      .split('\n')
      .filter((l) => l.trim())
      .slice(0, 5)
      .map((l) => l.trim());

    const totalChanged = status.split('\n').filter((l) => l.trim()).length;
    const context =
      `[brain] Workspace has ${totalChanged} uncommitted change${totalChanged === 1 ? '' : 's'}:\n` +
      changedFiles.join('\n') +
      (changedFiles.length < totalChanged ? '\n...' : '');

    return hookAllowJson(context);
  },
};

function detectGitRepo(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 2000,
    });
    return true;
  } catch {
    return false;
  }
}

function getGitStatus(): string {
  try {
    return execSync('git status --porcelain', { encoding: 'utf-8', timeout: 5000 });
  } catch {
    return '';
  }
}
