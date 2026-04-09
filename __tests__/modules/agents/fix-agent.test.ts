import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import type { DeliveryRecord } from '../../../src/modules/agents/delivery.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('../../../src/modules/sessions/data/session-ops.js', () => ({
  getSessionBySessionId: vi.fn(() => null),
}));

vi.mock('../../../src/modules/agents/worktree.js', () => ({
  findGitRoot: vi.fn(() => '/tmp/test-project'),
}));

import { spawnFixAgent } from '../../../src/modules/agents/fix-agent.js';

const mockExecFileSync = execFileSync as ReturnType<typeof vi.fn>;
const mockSpawn = spawn as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockWriteFileSync = writeFileSync as ReturnType<typeof vi.fn>;
const mockUnlinkSync = unlinkSync as ReturnType<typeof vi.fn>;

function makeDelivery(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    agent_id: 'agent-fix-1',
    task_id: 'VNM-48.101',
    branch: 'agent/vnm-48/VNM-48.101',
    status: 'conflicted',
    pr_number: 42,
    pr_url: 'https://github.com/test/repo/pull/42',
    pr_merged_at: null,
    delivered_at: null,
    retry_count: 0,
    session_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeMockProcess(
  exitCode = 0
): EventEmitter & { stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } } {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  };
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  // Auto-emit exit on next tick so tests resolve
  setTimeout(() => proc.emit('exit', exitCode), 0);
  return proc;
}

const fakeDb = { rawDb: {} } as unknown;

describe('spawnFixAgent', () => {
  beforeEach(() => {
    // Default: worktree creation succeeds, claude binary found
    mockExecFileSync.mockReturnValue('');
    mockExistsSync.mockReturnValue(false); // claude binary not at standard paths
    // which claude succeeds
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'which' && args?.[0] === 'claude') return '/usr/local/bin/claude';
      if (cmd === 'gh') return '[]';
      return '';
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('returns false when delivery has no branch', async () => {
    const result = await spawnFixAgent(fakeDb, makeDelivery({ branch: null }));
    expect(result).toBe(false);
  });

  it('returns false when worktree creation fails', async () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args?.includes('worktree')) throw new Error('worktree failed');
      if (cmd === 'which') return '/usr/local/bin/claude';
      return '';
    });

    const result = await spawnFixAgent(fakeDb, makeDelivery());
    expect(result).toBe(false);
  });

  it('spawns claude process with correct arguments', async () => {
    const proc = makeMockProcess(0);
    mockSpawn.mockReturnValue(proc);
    mockExistsSync.mockImplementation((p: string) => p.includes('.local/bin/claude'));

    const result = await spawnFixAgent(fakeDb, makeDelivery());

    expect(result).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    const spawnArgs = mockSpawn.mock.calls[0];
    const args = spawnArgs[1] as string[];
    expect(args).toContain('--model');
    expect(args).toContain('claude-sonnet-4-6');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
    expect(args).toContain('--max-budget-usd');
  });

  it('writes MCP config to temp file and cleans up after', async () => {
    const proc = makeMockProcess(0);
    mockSpawn.mockReturnValue(proc);
    mockExistsSync.mockImplementation((p: string) => p.includes('.local/bin/claude'));

    await spawnFixAgent(fakeDb, makeDelivery());

    expect(mockWriteFileSync).toHaveBeenCalled();
    const configArg = mockWriteFileSync.mock.calls[0][1] as string;
    const config = JSON.parse(configArg);
    expect(config.mcpServers.brain).toBeDefined();

    // Config cleaned up
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('writes prompt to process stdin', async () => {
    const proc = makeMockProcess(0);
    mockSpawn.mockReturnValue(proc);
    mockExistsSync.mockImplementation((p: string) => p.includes('.local/bin/claude'));

    await spawnFixAgent(fakeDb, makeDelivery());

    expect(proc.stdin.write).toHaveBeenCalled();
    const prompt = proc.stdin.write.mock.calls[0][0] as string;
    expect(prompt).toContain('fix agent');
    expect(prompt).toContain('VNM-48.101');
    expect(prompt).toContain('agent/vnm-48/VNM-48.101');
    expect(proc.stdin.end).toHaveBeenCalled();
  });

  it('returns false on non-zero exit code', async () => {
    const proc = makeMockProcess(1);
    mockSpawn.mockReturnValue(proc);
    mockExistsSync.mockImplementation((p: string) => p.includes('.local/bin/claude'));

    const result = await spawnFixAgent(fakeDb, makeDelivery());

    expect(result).toBe(false);
  });

  it('returns false on spawn error', async () => {
    const proc = new EventEmitter() as EventEmitter & {
      stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    };
    proc.stdin = { write: vi.fn(), end: vi.fn() };
    setTimeout(() => proc.emit('error', new Error('ENOENT')), 0);
    mockSpawn.mockReturnValue(proc);
    mockExistsSync.mockImplementation((p: string) => p.includes('.local/bin/claude'));

    const result = await spawnFixAgent(fakeDb, makeDelivery());

    expect(result).toBe(false);
  });

  it('releases fix worktree after process completes', async () => {
    const proc = makeMockProcess(0);
    mockSpawn.mockReturnValue(proc);
    mockExistsSync.mockImplementation((p: string) => p.includes('.local/bin/claude'));

    await spawnFixAgent(fakeDb, makeDelivery());

    // Should call git worktree remove for the fix worktree
    const removeCall = mockExecFileSync.mock.calls.find(
      (c) => c[0] === 'git' && c[1]?.includes('worktree') && c[1]?.includes('remove')
    );
    expect(removeCall).toBeDefined();
  });

  it('includes CI failure log in prompt when available', async () => {
    const proc = makeMockProcess(0);
    mockSpawn.mockReturnValue(proc);
    mockExistsSync.mockImplementation((p: string) => p.includes('.local/bin/claude'));
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'gh' && args?.includes('checks')) {
        return JSON.stringify([{ name: 'test', state: 'FAILURE', description: 'Tests failed' }]);
      }
      if (cmd === 'git' && args?.includes('diff')) return 'src/foo.ts';
      if (cmd === 'which') return '/usr/local/bin/claude';
      return '';
    });

    await spawnFixAgent(fakeDb, makeDelivery());

    const prompt = proc.stdin.write.mock.calls[0][0] as string;
    expect(prompt).toContain('CI Failures');
    expect(prompt).toContain('test: FAILURE');
  });
});
