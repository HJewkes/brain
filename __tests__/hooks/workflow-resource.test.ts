import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { workflowResourceCheck } from '../../src/hooks/checks/workflow-resource.js';
import { DEFAULT_HOOK_CONFIG } from '../../src/hooks/config.js';
import type { HookInput, HookConfig } from '../../src/hooks/types.js';

function makeInput(parsed: Record<string, unknown> = {}, cwd = '/test'): HookInput {
  return { event: 'pre-tool-use', raw: '', parsed, cwd };
}

function enabledConfig(): HookConfig {
  return {
    ...DEFAULT_HOOK_CONFIG,
    enforcement: { ...DEFAULT_HOOK_CONFIG.enforcement, brainResources: true },
  };
}

describe('workflow-resource check', () => {
  const originalEnv = { ...process.env };
  let tmpDir: string;
  let resourceDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `hooks-wfr-test-${Date.now()}`);
    resourceDir = join(tmpDir, '.brain', 'modules', 'workflow', 'resources');
    mkdirSync(resourceDir, { recursive: true });
    delete process.env.AO_AGENT_ID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is disabled when brainResources is false', () => {
    expect(workflowResourceCheck.enabled(DEFAULT_HOOK_CONFIG)).toBe(false);
  });

  it('is enabled when brainResources is true', () => {
    expect(workflowResourceCheck.enabled(enabledConfig())).toBe(true);
  });

  it('has correct name and event', () => {
    expect(workflowResourceCheck.name).toBe('workflow-resource');
    expect(workflowResourceCheck.event).toBe('pre-tool-use');
  });

  it('allows non-write tools', () => {
    process.env.AO_AGENT_ID = 'agent-1';
    const result = workflowResourceCheck.run(
      makeInput({ tool_name: 'Read', tool_input: { file_path: '/test.ts' } }, tmpDir),
      enabledConfig()
    );
    expect(result.exitCode).toBe(0);
  });

  it('allows writes when no AO_AGENT_ID is set', () => {
    const result = workflowResourceCheck.run(
      makeInput({ tool_name: 'Write', tool_input: { file_path: '/test.ts' } }, tmpDir),
      enabledConfig()
    );
    expect(result.exitCode).toBe(0);
  });

  it('allows writes when no resource directory exists', () => {
    process.env.AO_AGENT_ID = 'agent-1';
    const emptyDir = join(tmpdir(), `hooks-wfr-empty-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    const result = workflowResourceCheck.run(
      makeInput({ tool_name: 'Write', tool_input: { file_path: '/test.ts' } }, emptyDir),
      enabledConfig()
    );
    expect(result.exitCode).toBe(0);
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('allows writes when branch has no resource claim', () => {
    process.env.AO_AGENT_ID = 'agent-1';
    writeFileSync(
      join(resourceDir, 'res-1.json'),
      JSON.stringify({
        id: 'res-1',
        type: 'branch',
        project: 'test',
        status: 'active',
        data: { branch: 'feat/other-branch', agentId: 'agent-2' },
        updatedAt: '2026-01-01T00:00:00Z',
      })
    );
    // This won't block because getCurrentBranch returns the real branch,
    // which won't match 'feat/other-branch'
    const result = workflowResourceCheck.run(
      makeInput({ tool_name: 'Write', tool_input: { file_path: '/test.ts' } }, tmpDir),
      enabledConfig()
    );
    expect(result.exitCode).toBe(0);
  });

  it('allows writes when agent owns the branch resource', () => {
    process.env.AO_AGENT_ID = 'agent-1';
    writeFileSync(
      join(resourceDir, 'res-1.json'),
      JSON.stringify({
        id: 'res-1',
        type: 'branch',
        project: 'test',
        status: 'active',
        data: { branch: 'main', agentId: 'agent-1' },
        updatedAt: '2026-01-01T00:00:00Z',
      })
    );
    // Resources are read from input.cwd, so we need resources there
    // Resources are read from input.cwd, so we need resources there
    // But we need git to work, so test with a git repo
    const result = workflowResourceCheck.run(
      makeInput({ tool_name: 'Write', tool_input: { file_path: '/test.ts' } }, tmpDir),
      enabledConfig()
    );
    // tmpDir is not a git repo, so getCurrentBranch returns null -> allow
    expect(result.exitCode).toBe(0);
  });

  it('skips inactive branch resources', () => {
    process.env.AO_AGENT_ID = 'agent-1';
    writeFileSync(
      join(resourceDir, 'res-1.json'),
      JSON.stringify({
        id: 'res-1',
        type: 'branch',
        project: 'test',
        status: 'completed',
        data: { branch: 'main', agentId: 'agent-2' },
        updatedAt: '2026-01-01T00:00:00Z',
      })
    );
    const result = workflowResourceCheck.run(
      makeInput({ tool_name: 'Write', tool_input: { file_path: '/test.ts' } }, tmpDir),
      enabledConfig()
    );
    expect(result.exitCode).toBe(0);
  });

  it('skips non-branch resource types', () => {
    process.env.AO_AGENT_ID = 'agent-1';
    writeFileSync(
      join(resourceDir, 'res-1.json'),
      JSON.stringify({
        id: 'res-1',
        type: 'file',
        project: 'test',
        status: 'active',
        data: { path: 'src/index.ts', agentId: 'agent-2' },
        updatedAt: '2026-01-01T00:00:00Z',
      })
    );
    const result = workflowResourceCheck.run(
      makeInput({ tool_name: 'Write', tool_input: { file_path: '/test.ts' } }, tmpDir),
      enabledConfig()
    );
    expect(result.exitCode).toBe(0);
  });

  it('skips malformed JSON files', () => {
    process.env.AO_AGENT_ID = 'agent-1';
    writeFileSync(join(resourceDir, 'bad.json'), 'not valid json{{{');
    const result = workflowResourceCheck.run(
      makeInput({ tool_name: 'Write', tool_input: { file_path: '/test.ts' } }, tmpDir),
      enabledConfig()
    );
    expect(result.exitCode).toBe(0);
  });

  it('treats Edit as a write tool', () => {
    process.env.AO_AGENT_ID = 'agent-1';
    const result = workflowResourceCheck.run(
      makeInput({ tool_name: 'Edit', tool_input: { file_path: '/test.ts' } }, tmpDir),
      enabledConfig()
    );
    expect(result.exitCode).toBe(0);
  });

  it('treats NotebookEdit as a write tool but allows when no conflict', () => {
    process.env.AO_AGENT_ID = 'agent-1';
    const result = workflowResourceCheck.run(
      makeInput({ tool_name: 'NotebookEdit', tool_input: { file_path: '/test.ipynb' } }, tmpDir),
      enabledConfig()
    );
    expect(result.exitCode).toBe(0);
  });

  describe('with a git repo', () => {
    let gitDir: string;
    let gitResourceDir: string;

    beforeEach(async () => {
      gitDir = join(tmpdir(), `hooks-wfr-git-${Date.now()}`);
      gitResourceDir = join(gitDir, '.brain', 'modules', 'workflow', 'resources');
      mkdirSync(gitResourceDir, { recursive: true });

      // Initialize a git repo with a commit so getCurrentBranch works
      const { execSync: exec } = await import('node:child_process');
      exec('git init', { cwd: gitDir });
      exec('git commit --allow-empty -m "init"', { cwd: gitDir });
      exec('git checkout -b test-branch', { cwd: gitDir });
    });

    afterEach(() => {
      rmSync(gitDir, { recursive: true, force: true });
    });

    it('blocks writes when branch is owned by a different agent', () => {
      process.env.AO_AGENT_ID = 'agent-1';
      writeFileSync(
        join(gitResourceDir, 'res-1.json'),
        JSON.stringify({
          id: 'res-1',
          type: 'branch',
          project: 'test',
          status: 'active',
          data: { branch: 'test-branch', agentId: 'agent-2' },
          updatedAt: '2026-01-01T00:00:00Z',
        })
      );

      const result = workflowResourceCheck.run(
        makeInput({ tool_name: 'Write', tool_input: { file_path: '/test.ts' } }, gitDir),
        enabledConfig()
      );
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('test-branch');
      expect(result.stderr).toContain('agent-2');
    });

    it('allows writes when agent owns the branch', () => {
      process.env.AO_AGENT_ID = 'agent-1';
      writeFileSync(
        join(gitResourceDir, 'res-1.json'),
        JSON.stringify({
          id: 'res-1',
          type: 'branch',
          project: 'test',
          status: 'active',
          data: { branch: 'test-branch', agentId: 'agent-1' },
          updatedAt: '2026-01-01T00:00:00Z',
        })
      );

      const result = workflowResourceCheck.run(
        makeInput({ tool_name: 'Write', tool_input: { file_path: '/test.ts' } }, gitDir),
        enabledConfig()
      );
      expect(result.exitCode).toBe(0);
    });

    it('allows writes when branch has no matching resource', () => {
      process.env.AO_AGENT_ID = 'agent-1';
      writeFileSync(
        join(gitResourceDir, 'res-1.json'),
        JSON.stringify({
          id: 'res-1',
          type: 'branch',
          project: 'test',
          status: 'active',
          data: { branch: 'other-branch', agentId: 'agent-2' },
          updatedAt: '2026-01-01T00:00:00Z',
        })
      );

      const result = workflowResourceCheck.run(
        makeInput({ tool_name: 'Write', tool_input: { file_path: '/test.ts' } }, gitDir),
        enabledConfig()
      );
      expect(result.exitCode).toBe(0);
    });

    it('blocks Edit tool when branch is owned by different agent', () => {
      process.env.AO_AGENT_ID = 'agent-1';
      writeFileSync(
        join(gitResourceDir, 'res-1.json'),
        JSON.stringify({
          id: 'res-1',
          type: 'branch',
          project: 'test',
          status: 'active',
          data: { branch: 'test-branch', agentId: 'agent-3' },
          updatedAt: '2026-01-01T00:00:00Z',
        })
      );

      const result = workflowResourceCheck.run(
        makeInput({ tool_name: 'Edit', tool_input: { file_path: '/test.ts' } }, gitDir),
        enabledConfig()
      );
      expect(result.exitCode).toBe(2);
    });
  });
});
