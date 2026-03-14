import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/modules/pm/data/task-ops.js', () => ({
  listTasks: vi.fn(),
}));

vi.mock('../../../src/modules/pm/data/queries.js', () => ({
  getActiveProject: vi.fn(),
}));

vi.mock('../../../src/modules/agents/data.js', () => ({
  countActiveAgents: vi.fn(),
  listAgents: vi.fn(),
}));

vi.mock('../../../src/modules/agents/stall-detector.js', () => ({
  detectStalledTasks: vi.fn(),
}));

import { buildDashboard, formatDashboard } from '../../../src/modules/agents/burndown-dashboard.js';
import { listTasks } from '../../../src/modules/pm/data/task-ops.js';
import { getActiveProject } from '../../../src/modules/pm/data/queries.js';
import { countActiveAgents, listAgents } from '../../../src/modules/agents/data.js';
import { detectStalledTasks } from '../../../src/modules/agents/stall-detector.js';
import type { BrainDB } from '../../../src/services/brain-db.js';

const mockListTasks = listTasks as ReturnType<typeof vi.fn>;
const mockGetActiveProject = getActiveProject as ReturnType<typeof vi.fn>;
const mockCountActiveAgents = countActiveAgents as ReturnType<typeof vi.fn>;
const mockListAgents = listAgents as ReturnType<typeof vi.fn>;
const mockDetectStalledTasks = detectStalledTasks as ReturnType<typeof vi.fn>;

const fakeDb = {} as BrainDB;

describe('burndown-dashboard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDetectStalledTasks.mockReturnValue([]);
    mockListAgents.mockReturnValue([]);
    mockCountActiveAgents.mockReturnValue(0);
  });

  describe('buildDashboard', () => {
    it('returns null when no project', () => {
      mockGetActiveProject.mockReturnValue(null);
      expect(buildDashboard(fakeDb, '/repo')).toBeNull();
    });

    it('builds dashboard with task counts', () => {
      mockListTasks.mockReturnValue({
        ok: true,
        data: [
          { status: 'done', modified: '2026-01-01' },
          { status: 'done', modified: '2026-01-02' },
          { status: 'in-progress' },
          { status: 'pending' },
          { status: 'claimed' },
        ],
      });

      const data = buildDashboard(fakeDb, '/repo', 'VNM');

      expect(data).not.toBeNull();
      expect(data!.project).toBe('VNM');
      expect(data!.tasks.total).toBe(5);
      expect(data!.tasks.done).toBe(2);
      expect(data!.tasks.inProgress).toBe(1);
      expect(data!.tasks.pending).toBe(1);
      expect(data!.tasks.claimed).toBe(1);
    });

    it('includes active agents', () => {
      mockListTasks.mockReturnValue({ ok: true, data: [] });
      mockCountActiveAgents.mockReturnValue(2);
      mockListAgents.mockReturnValue([
        {
          name: 'agent-1',
          brain_task: 'VNM-11.01',
          started_at: new Date().toISOString(),
        },
      ]);

      const data = buildDashboard(fakeDb, '/repo', 'VNM');

      expect(data!.agents.active).toBe(2);
      expect(data!.agents.activeList).toHaveLength(1);
      expect(data!.agents.activeList[0].taskId).toBe('VNM-11.01');
    });

    it('includes stalled tasks', () => {
      mockListTasks.mockReturnValue({ ok: true, data: [] });
      mockDetectStalledTasks.mockReturnValue([
        { displayId: 'VNM-11.03', lastCommitAge: 45, stalledSince: '2026-01-01' },
      ]);

      const data = buildDashboard(fakeDb, '/repo', 'VNM');

      expect(data!.stalled).toHaveLength(1);
      expect(data!.stalled[0].taskId).toBe('VNM-11.03');
    });
  });

  describe('formatDashboard', () => {
    it('renders readable dashboard', () => {
      const data = {
        project: 'VNM',
        tasks: { total: 10, done: 5, inProgress: 2, pending: 2, claimed: 1 },
        agents: { active: 2, activeList: [] },
        stalled: [],
        throughput: { completedPerHour: 3.5, estimatedRemainingMinutes: 85 },
      };

      const output = formatDashboard(data);

      expect(output).toContain('Burndown: VNM');
      expect(output).toContain('50%');
      expect(output).toContain('5/10 done');
      expect(output).toContain('3.5 tasks/hr');
      expect(output).toContain('85m');
    });

    it('shows progress bar', () => {
      const data = {
        project: 'VNM',
        tasks: { total: 4, done: 3, inProgress: 1, pending: 0, claimed: 0 },
        agents: { active: 0, activeList: [] },
        stalled: [],
        throughput: { completedPerHour: 0, estimatedRemainingMinutes: null },
      };

      const output = formatDashboard(data);

      expect(output).toContain('[');
      expect(output).toContain('#');
      expect(output).toContain('75%');
    });
  });
});
