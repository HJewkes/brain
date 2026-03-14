import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('../../../src/modules/pm/data/queries.js', () => ({
  getPmNotes: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { detectStalledTasks, getStalledTasks } from '../../../src/modules/agents/stall-detector.js';
import { getPmNotes } from '../../../src/modules/pm/data/queries.js';
import type { BrainDB } from '../../../src/services/brain-db.js';

const mockExecFileSync = execFileSync as ReturnType<typeof vi.fn>;
const mockGetPmNotes = getPmNotes as ReturnType<typeof vi.fn>;
const fakeDb = {} as BrainDB;

describe('detectStalledTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty when no in-progress tasks exist', () => {
    mockGetPmNotes.mockReturnValue([]);

    const result = detectStalledTasks(fakeDb, '/repo');

    expect(result).toEqual([]);
  });

  it('does not detect tasks with recent commits as stalled', () => {
    mockGetPmNotes.mockReturnValue([
      { metadata: JSON.stringify({ display_id: 'VNM-10.13', status: 'in-progress' }) },
    ]);
    const recentDate = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockExecFileSync.mockReturnValue(recentDate + '\n');

    const result = detectStalledTasks(fakeDb, '/repo');

    expect(result).toEqual([]);
  });

  it('detects tasks without recent commits as stalled', () => {
    mockGetPmNotes.mockReturnValue([
      { metadata: JSON.stringify({ display_id: 'VNM-10.14', status: 'in-progress' }) },
    ]);
    const oldDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    mockExecFileSync.mockReturnValue(oldDate + '\n');

    const result = detectStalledTasks(fakeDb, '/repo');

    expect(result).toHaveLength(1);
    expect(result[0].displayId).toBe('VNM-10.14');
    expect(result[0].lastCommitAge).toBeGreaterThanOrEqual(30);
  });

  it('detects tasks with no commits at all as stalled', () => {
    mockGetPmNotes.mockReturnValue([
      { metadata: JSON.stringify({ display_id: 'VNM-10.15', status: 'in-progress' }) },
    ]);
    mockExecFileSync.mockReturnValue('');

    const result = detectStalledTasks(fakeDb, '/repo');

    expect(result).toHaveLength(1);
    expect(result[0].displayId).toBe('VNM-10.15');
    expect(result[0].lastCommitAge).toBe(Infinity);
  });

  it('respects custom threshold parameter', () => {
    mockGetPmNotes.mockReturnValue([
      { metadata: JSON.stringify({ display_id: 'VNM-10.16', status: 'in-progress' }) },
    ]);
    // 10 minutes ago — stalled with 5 min threshold, not with 15 min
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    mockExecFileSync.mockReturnValue(tenMinAgo + '\n');

    const stalledWith5 = detectStalledTasks(fakeDb, '/repo', 5);
    expect(stalledWith5).toHaveLength(1);

    const stalledWith15 = detectStalledTasks(fakeDb, '/repo', 15);
    expect(stalledWith15).toEqual([]);
  });

  it('handles git command failure gracefully', () => {
    mockGetPmNotes.mockReturnValue([
      { metadata: JSON.stringify({ display_id: 'VNM-10.17', status: 'in-progress' }) },
    ]);
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });

    const result = detectStalledTasks(fakeDb, '/repo');

    expect(result).toHaveLength(1);
    expect(result[0].displayId).toBe('VNM-10.17');
  });

  it('passes correct git arguments', () => {
    mockGetPmNotes.mockReturnValue([
      { metadata: JSON.stringify({ display_id: 'VNM-10.18', status: 'in-progress' }) },
    ]);
    mockExecFileSync.mockReturnValue('');

    detectStalledTasks(fakeDb, '/my/repo');

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['log', '-1', '--format=%aI', '--all', '--grep', 'VNM-10.18'],
      { cwd: '/my/repo', encoding: 'utf-8', stdio: 'pipe' }
    );
  });
});

describe('getStalledTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns tasks with stalled status', () => {
    mockGetPmNotes.mockReturnValue([
      {
        metadata: JSON.stringify({
          display_id: 'VNM-10.20',
          status: 'stalled',
          stalled_since: '2026-01-01T00:00:00.000Z',
        }),
      },
    ]);

    const result = getStalledTasks(fakeDb);

    expect(result).toHaveLength(1);
    expect(result[0].displayId).toBe('VNM-10.20');
    expect(result[0].stalledSince).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns empty when no stalled tasks', () => {
    mockGetPmNotes.mockReturnValue([]);

    const result = getStalledTasks(fakeDb);

    expect(result).toEqual([]);
  });
});
