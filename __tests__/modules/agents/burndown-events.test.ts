import { describe, it, expect } from 'vitest';
import {
  createBurndownSession,
  recordTick,
  recordMerge,
  formatSessionSummary,
} from '../../../src/modules/agents/burndown-events.js';
import type { TickResult } from '../../../src/modules/agents/burndown.js';

describe('burndown-events', () => {
  describe('createBurndownSession', () => {
    it('creates a session with initial stats', () => {
      const session = createBurndownSession('VNM');

      expect(session.sessionId).toBeTruthy();
      expect(session.project).toBe('VNM');
      expect(session.stats.tickCount).toBe(0);
      expect(session.stats.totalSpawned).toBe(0);
    });
  });

  describe('recordTick', () => {
    it('increments tick count and records spawns', () => {
      const session = createBurndownSession('VNM');

      const result: TickResult = {
        spawned: [
          {
            taskId: 'VNM-11.01',
            claimToken: 'tok',
            routing: {
              agentType: 'general-purpose',
              model: 'opus',
              isolation: 'worktree',
              verify: true,
              concurrency: 'sequential-within-workstream',
            },
            prompt: 'test',
            startedAt: new Date().toISOString(),
          },
        ],
        stalled: [],
        activeCount: 1,
        availableSlots: 2,
      };

      recordTick(session, result);

      expect(session.stats.tickCount).toBe(1);
      expect(session.stats.totalSpawned).toBe(1);
      expect(session.events.size).toBe(1);
    });

    it('records stalled tasks', () => {
      const session = createBurndownSession('VNM');

      const result: TickResult = {
        spawned: [],
        stalled: [
          {
            displayId: 'VNM-11.03',
            lastCommitAge: 45,
            stalledSince: new Date().toISOString(),
          },
        ],
        activeCount: 0,
        availableSlots: 3,
      };

      recordTick(session, result);

      expect(session.stats.totalStalled).toBe(1);
      expect(session.events.size).toBe(1);
    });
  });

  describe('recordMerge', () => {
    it('records successful merge', () => {
      const session = createBurndownSession('VNM');

      recordMerge(session, {
        taskId: 'VNM-11.01',
        prNumber: 42,
        merged: true,
      });

      expect(session.stats.totalMerged).toBe(1);
      expect(session.events.size).toBe(1);
    });

    it('records failed merge', () => {
      const session = createBurndownSession('VNM');

      recordMerge(session, {
        taskId: 'VNM-11.01',
        prNumber: 42,
        merged: false,
        error: 'conflicts',
      });

      expect(session.stats.totalMerged).toBe(0);
      expect(session.events.size).toBe(1);
    });
  });

  describe('formatSessionSummary', () => {
    it('formats summary with all stats', () => {
      const session = createBurndownSession('VNM');
      session.stats.tickCount = 5;
      session.stats.totalSpawned = 3;
      session.stats.totalMerged = 2;
      session.stats.totalStalled = 1;

      const summary = formatSessionSummary(session);

      expect(summary).toContain('VNM');
      expect(summary).toContain('Ticks: 5');
      expect(summary).toContain('Spawned: 3');
      expect(summary).toContain('Merged: 2');
      expect(summary).toContain('Stalled: 1');
    });
  });
});
