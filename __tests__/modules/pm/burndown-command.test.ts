import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(),
  withDb: vi.fn(),
}));

vi.mock('../../../src/modules/agents/burndown.js', () => {
  const MockOrchestrator = vi.fn();
  MockOrchestrator.prototype.setSpawner = vi.fn();
  MockOrchestrator.prototype.setStallHandler = vi.fn();
  MockOrchestrator.prototype.tick = vi.fn();
  MockOrchestrator.prototype.start = vi.fn();
  MockOrchestrator.prototype.stop = vi.fn();
  return { BurndownOrchestrator: MockOrchestrator };
});

vi.mock('../../../src/modules/pm/data/task-ops.js', () => ({
  listTasks: vi.fn(),
}));

vi.mock('../../../src/modules/pm/data/queries.js', () => ({
  getActiveProject: vi.fn(),
}));

vi.mock('../../../src/modules/agents/data.js', () => ({
  countActiveAgents: vi.fn(),
}));

vi.mock('../../../src/modules/agents/burndown-dashboard.js', () => ({
  buildDashboard: vi.fn(),
  formatDashboard: vi.fn(),
}));

import { createBurndownCommand } from '../../../src/modules/pm/commands/burndown.js';
import { withBrain, withDb } from '../../../src/services/brain-service.js';
import { BurndownOrchestrator } from '../../../src/modules/agents/burndown.js';
import { listTasks } from '../../../src/modules/pm/data/task-ops.js';
import { getActiveProject } from '../../../src/modules/pm/data/queries.js';
import { buildDashboard, formatDashboard } from '../../../src/modules/agents/burndown-dashboard.js';

const mockWithBrain = withBrain as ReturnType<typeof vi.fn>;
const mockWithDb = withDb as ReturnType<typeof vi.fn>;
const mockListTasks = listTasks as ReturnType<typeof vi.fn>;
const mockGetActiveProject = getActiveProject as ReturnType<typeof vi.fn>;
const mockBuildDashboard = buildDashboard as ReturnType<typeof vi.fn>;
const mockFormatDashboard = formatDashboard as ReturnType<typeof vi.fn>;

describe('burndown command', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    process.exitCode = undefined;
  });

  it('creates a command group with run and status subcommands', () => {
    const cmd = createBurndownCommand();
    expect(cmd.name()).toBe('burndown');
    const subcommands = cmd.commands.map((c) => c.name());
    expect(subcommands).toContain('run');
    expect(subcommands).toContain('status');
  });

  it('run errors when no active project and no --project flag', async () => {
    mockWithBrain.mockImplementation(async (fn: (svc: unknown) => Promise<void>) => {
      const svc = { db: {}, config: {}, embedder: {} };
      mockGetActiveProject.mockReturnValue(null);
      await fn(svc);
    });

    const cmd = createBurndownCommand();
    await cmd.parseAsync(['run', '--once'], { from: 'user' });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('No active project'));
  });

  it('run --once executes a single tick', async () => {
    const tickResult = {
      spawned: [],
      stalled: [],
      activeCount: 0,
      availableSlots: 3,
    };

    mockWithBrain.mockImplementation(async (fn: (svc: unknown) => Promise<void>) => {
      const svc = { db: {}, config: {}, embedder: {} };
      mockGetActiveProject.mockReturnValue('VNM');
      mockListTasks.mockReturnValue({
        ok: true,
        data: [{ status: 'done' }, { status: 'done' }, { status: 'pending' }],
      });

      const proto = BurndownOrchestrator.prototype as unknown as Record<
        string,
        ReturnType<typeof vi.fn>
      >;
      proto.tick.mockResolvedValue(tickResult);

      await fn(svc);
    });

    const cmd = createBurndownCommand();
    await cmd.parseAsync(['run', '--once'], { from: 'user' });

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('2/3 done'));
  });

  it('run --once --json outputs JSON', async () => {
    const tickResult = {
      spawned: [],
      stalled: [],
      activeCount: 0,
      availableSlots: 3,
    };

    mockWithBrain.mockImplementation(async (fn: (svc: unknown) => Promise<void>) => {
      const svc = { db: {}, config: {}, embedder: {} };
      mockGetActiveProject.mockReturnValue('VNM');
      mockListTasks.mockReturnValue({ ok: true, data: [] });

      const proto = BurndownOrchestrator.prototype as unknown as Record<
        string,
        ReturnType<typeof vi.fn>
      >;
      proto.tick.mockResolvedValue(tickResult);

      await fn(svc);
    });

    const cmd = createBurndownCommand();
    await cmd.parseAsync(['run', '--once', '--json'], { from: 'user' });

    const output = stdoutSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.project).toBe('VNM');
    expect(parsed.tick.activeCount).toBe(0);
  });

  it('run --dry-run shows what would be dispatched', async () => {
    const tickResult = {
      spawned: [
        {
          taskId: 'VNM-11.01',
          claimToken: 'tok',
          routing: { model: 'opus', agentType: 'general-purpose', isolation: 'worktree' },
          prompt: 'test',
          startedAt: '2026-01-01',
        },
      ],
      stalled: [],
      activeCount: 0,
      availableSlots: 2,
    };

    mockWithBrain.mockImplementation(async (fn: (svc: unknown) => Promise<void>) => {
      const svc = { db: {}, config: {}, embedder: {} };
      mockGetActiveProject.mockReturnValue('VNM');
      mockListTasks.mockReturnValue({ ok: true, data: [{ status: 'pending' }] });

      const proto = BurndownOrchestrator.prototype as unknown as Record<
        string,
        ReturnType<typeof vi.fn>
      >;
      proto.tick.mockResolvedValue(tickResult);

      await fn(svc);
    });

    const cmd = createBurndownCommand();
    await cmd.parseAsync(['run', '--dry-run'], { from: 'user' });

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Would dispatch'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('VNM-11.01'));
  });

  describe('status subcommand', () => {
    it('shows dashboard', async () => {
      mockWithDb.mockImplementation(async (fn: (svc: unknown) => void) => {
        const svc = { db: {} };
        mockBuildDashboard.mockReturnValue({
          project: 'VNM',
          tasks: { total: 10, done: 5 },
          agents: { active: 2, activeList: [] },
          stalled: [],
          throughput: { completedPerHour: 3, estimatedRemainingMinutes: 100 },
        });
        mockFormatDashboard.mockReturnValue('Dashboard output');
        fn(svc);
      });

      const cmd = createBurndownCommand();
      await cmd.parseAsync(['status'], { from: 'user' });

      expect(stdoutSpy).toHaveBeenCalledWith('Dashboard output\n');
    });

    it('outputs JSON with --json', async () => {
      const dashData = {
        project: 'VNM',
        tasks: { total: 10, done: 5 },
        agents: { active: 2, activeList: [] },
        stalled: [],
        throughput: { completedPerHour: 3, estimatedRemainingMinutes: 100 },
      };

      mockWithDb.mockImplementation(async (fn: (svc: unknown) => void) => {
        const svc = { db: {} };
        mockBuildDashboard.mockReturnValue(dashData);
        fn(svc);
      });

      const cmd = createBurndownCommand();
      await cmd.parseAsync(['status', '--json'], { from: 'user' });

      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.project).toBe('VNM');
    });

    it('errors when no active project', async () => {
      mockWithDb.mockImplementation(async (fn: (svc: unknown) => void) => {
        const svc = { db: {} };
        mockBuildDashboard.mockReturnValue(null);
        fn(svc);
      });

      const cmd = createBurndownCommand();
      await cmd.parseAsync(['status'], { from: 'user' });

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('No active project'));
    });
  });
});
