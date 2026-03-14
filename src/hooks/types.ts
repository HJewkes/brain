export type HookEvent =
  | 'pre-tool-use'
  | 'post-tool-use'
  | 'prompt-submit'
  | 'notification'
  | 'task-completed'
  | 'agent-done'
  | 'session-start';

export interface HookInput {
  event: HookEvent;
  raw: string;
  parsed: Record<string, unknown>;
  cwd: string;
}

export interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface HookHandler {
  name: string;
  event: HookEvent;
  priority: number;
  enabled(config: HookConfig): boolean;
  run(input: HookInput, config: HookConfig): HookResult;
}

export interface DodCriterion {
  name: string;
  check: string;
  required: boolean;
}

export interface HookConfig {
  enforcement: {
    ownership: boolean;
    dod: boolean;
    dodCriteria: DodCriterion[];
    wipLimit: number;
    workspaceClean: boolean;
    gitSafety: boolean;
    gitSafetyBlockOnce: boolean;
    brainResources: boolean;
    worktreeBudget: number;
    worktreeBasePath: string;
    worktreeIsolation: boolean;
  };
  ownershipManifest: string;
}

export function hookAllow(message?: string): HookResult {
  return { exitCode: 0, stdout: message ?? '', stderr: '' };
}

export function hookBlock(reason: string): HookResult {
  return { exitCode: 2, stdout: '', stderr: reason };
}

export function hookAllowJson(context?: string): HookResult {
  const obj: Record<string, unknown> = {};
  if (context) obj.additionalContext = context;
  return { exitCode: 0, stdout: JSON.stringify(obj), stderr: '' };
}
