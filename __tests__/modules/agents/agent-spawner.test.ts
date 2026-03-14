import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { ActiveAgent } from '../../../src/modules/agents/burndown.js';
import type { RoutingResult } from '../../../src/modules/pm/engine/routing.js';

vi.mock('node:child_process', () => {
  const EventEmitter = require('node:events');

  function createMockProcess() {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.pid = 12345;
    return proc;
  }

  return {
    spawn: vi.fn(() => createMockProcess()),
  };
});

import { ClaudeAgentSpawner, waitForAgent } from '../../../src/modules/agents/agent-spawner.js';
import { spawn } from 'node:child_process';

const mockSpawn = vi.mocked(spawn);

function makeAgent(overrides: Partial<ActiveAgent> = {}): ActiveAgent {
  const routing: RoutingResult = {
    agentType: 'general-purpose',
    model: 'opus',
    isolation: 'worktree',
    verify: true,
    concurrency: 'sequential-within-workstream',
  };

  return {
    taskId: 'TST-01.01',
    claimToken: 'tok-123',
    routing,
    prompt: 'Implement the feature',
    startedAt: '2026-03-14T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ClaudeAgentSpawner', () => {
  test('spawns claude process with correct args for worktree isolation', () => {
    const spawner = new ClaudeAgentSpawner({ projectDir: '/test/dir' });
    const agent = makeAgent();

    spawner.spawn(agent);

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      [
        '--print',
        '--model', 'opus',
        '--permission-mode', 'auto',
        '--worktree', 'tst-01.01',
        'Implement the feature',
      ],
      expect.objectContaining({ cwd: '/test/dir' }),
    );
  });

  test('omits --worktree when isolation is none', () => {
    const spawner = new ClaudeAgentSpawner();
    const agent = makeAgent({
      routing: {
        agentType: 'Explore',
        model: 'sonnet',
        isolation: 'none',
        verify: false,
        concurrency: 'parallel',
      },
    });

    spawner.spawn(agent);

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).not.toContain('--worktree');
    expect(args).toContain('sonnet');
  });

  test('tracks active agents', () => {
    const spawner = new ClaudeAgentSpawner();
    expect(spawner.activeCount).toBe(0);

    spawner.spawn(makeAgent());
    expect(spawner.activeCount).toBe(1);
    expect(spawner.getActive().has('TST-01.01')).toBe(true);
  });

  test('uses custom claude path', () => {
    const spawner = new ClaudeAgentSpawner({
      claudePath: '/usr/local/bin/claude',
    });

    spawner.spawn(makeAgent());

    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/local/bin/claude',
      expect.any(Array),
      expect.any(Object),
    );
  });

  test('maps haiku model correctly', () => {
    const spawner = new ClaudeAgentSpawner();
    const agent = makeAgent({
      routing: {
        agentType: 'general-purpose',
        model: 'haiku',
        isolation: 'none',
        verify: false,
        concurrency: 'parallel',
      },
    });

    spawner.spawn(agent);

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('haiku');
  });

  test('toSpawnerCallback returns a function compatible with BurndownOrchestrator', async () => {
    const spawner = new ClaudeAgentSpawner();
    const callback = spawner.toSpawnerCallback();

    await callback(makeAgent());

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(spawner.activeCount).toBe(1);
  });

  test('uses custom permission mode', () => {
    const spawner = new ClaudeAgentSpawner({
      permissionMode: 'bypassPermissions',
    });

    spawner.spawn(makeAgent());

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('--permission-mode');
    expect(args).toContain('bypassPermissions');
  });
});

describe('waitForAgent', () => {
  test('resolves with output on process close', async () => {
    const EventEmitter = require('node:events');
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();

    const spawned = {
      taskId: 'TST-01.01',
      process: proc,
      startedAt: '2026-03-14T00:00:00Z',
      model: 'opus',
      isolation: 'worktree',
    };

    const promise = waitForAgent(spawned);

    proc.stdout.emit('data', Buffer.from('Task completed'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('Task completed');
    expect(result.taskId).toBe('TST-01.01');
  });

  test('captures stderr on failure', async () => {
    const EventEmitter = require('node:events');
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();

    const spawned = {
      taskId: 'TST-01.01',
      process: proc,
      startedAt: '2026-03-14T00:00:00Z',
      model: 'opus',
      isolation: 'worktree',
    };

    const promise = waitForAgent(spawned);

    proc.stderr.emit('data', Buffer.from('Error occurred'));
    proc.emit('close', 1);

    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe('Error occurred');
  });

  test('handles process error event', async () => {
    const EventEmitter = require('node:events');
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();

    const spawned = {
      taskId: 'TST-01.01',
      process: proc,
      startedAt: '2026-03-14T00:00:00Z',
      model: 'opus',
      isolation: 'worktree',
    };

    const promise = waitForAgent(spawned);
    proc.emit('error', new Error('ENOENT'));

    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe('ENOENT');
  });
});
