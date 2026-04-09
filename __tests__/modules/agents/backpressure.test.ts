import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  BackpressureController,
  bootstrapBackpressure,
} from '../../../src/modules/agents/backpressure.js';
import { recordDelivery } from '../../../src/modules/agents/delivery.js';
import {
  agentsMigrationV1,
  agentsMigrationV2,
  agentsMigrationV3,
} from '../../../src/modules/agents/schema.js';
import { createAgent } from '../../../src/modules/agents/data.js';

describe('BackpressureController', () => {
  it('returns base WIP when no pressure signals', () => {
    const ctrl = new BackpressureController(4);
    const result = ctrl.computeEffectiveWip();

    expect(result.effectiveWip).toBe(4);
    expect(result.reason).toBe('nominal');
  });

  it('reduces WIP when merge queue is deep', () => {
    const ctrl = new BackpressureController(4);
    ctrl.setMergeQueueDepth(4);

    const result = ctrl.computeEffectiveWip();

    expect(result.effectiveWip).toBe(2);
    expect(result.reason).toContain('merge queue depth');
  });

  it('reduces WIP on high conflict rate', () => {
    const ctrl = new BackpressureController(4);
    ctrl.recordMerge(true, true);
    ctrl.recordMerge(true, true);
    ctrl.recordMerge(true, false);

    const result = ctrl.computeEffectiveWip();

    // 2/3 = 66% conflict rate > 30% threshold
    expect(result.effectiveWip).toBe(2);
    expect(result.reason).toContain('conflict rate');
  });

  it('reduces WIP on high stall rate', () => {
    const ctrl = new BackpressureController(4);
    ctrl.recordStall('ws-1');
    ctrl.recordStall('ws-1');
    ctrl.recordStall('ws-2');
    ctrl.recordMerge(true, false);

    const result = ctrl.computeEffectiveWip();

    // 3 stalls / 4 total = 75% stall rate > 50% threshold
    expect(result.effectiveWip).toBe(3);
    expect(result.reason).toContain('stall rate');
  });

  it('never goes below WIP of 1', () => {
    const ctrl = new BackpressureController(1);
    ctrl.setMergeQueueDepth(10);
    ctrl.recordMerge(true, true);
    ctrl.recordStall('ws-1');

    const result = ctrl.computeEffectiveWip();

    expect(result.effectiveWip).toBe(1);
  });

  it('combines multiple pressure signals', () => {
    const ctrl = new BackpressureController(4);
    ctrl.setMergeQueueDepth(4); // reduces by 2 → 2
    ctrl.recordMerge(true, true);
    ctrl.recordMerge(true, true); // 100% conflict → halve → 1

    const result = ctrl.computeEffectiveWip();

    expect(result.effectiveWip).toBe(1);
    expect(result.reason).toContain('merge queue');
    expect(result.reason).toContain('conflict rate');
  });

  it('exposes state for monitoring', () => {
    const ctrl = new BackpressureController(4);
    ctrl.setMergeQueueDepth(3);
    ctrl.recordMerge(true, true);

    const state = ctrl.getState();

    expect(state.mergeQueueDepth).toBe(3);
    expect(state.conflictRate).toBe(1);
    expect(state.recentMergeResults).toHaveLength(1);
  });
});

describe('bootstrapBackpressure', () => {
  let db: Database.Database;

  function setupDb(): Database.Database {
    const d = new Database(':memory:');
    agentsMigrationV1.up(d);
    agentsMigrationV2.up(d);
    agentsMigrationV3.up(d);
    return d;
  }

  function makeAgent(d: Database.Database): string {
    return createAgent(d, { name: 'worker', parent: 'orch', brain_task: null });
  }

  beforeEach(() => {
    db = setupDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns controller with baseWip from config', () => {
    const ctrl = bootstrapBackpressure(db, { baseWip: 5 });
    const result = ctrl.computeEffectiveWip();

    expect(result.effectiveWip).toBe(5);
    expect(result.reason).toBe('nominal');
  });

  it('defaults baseWip to 3 when not specified', () => {
    const ctrl = bootstrapBackpressure(db);
    const result = ctrl.computeEffectiveWip();

    expect(result.effectiveWip).toBe(3);
  });

  it('seeds merge rate from delivered deliveries in last 24h', () => {
    const agentId = makeAgent(db);
    recordDelivery(db, agentId, {
      status: 'delivered',
      task_id: 'VNM-48.01',
      branch: 'feat/test',
    });

    const ctrl = bootstrapBackpressure(db, { baseWip: 3 });
    const state = ctrl.getState();

    expect(state.recentMergeResults).toHaveLength(1);
    expect(state.recentMergeResults[0].success).toBe(true);
    expect(state.recentMergeResults[0].hadConflict).toBe(false);
  });

  it('seeds conflict rate from redispatched deliveries in last 24h', () => {
    const agentId = makeAgent(db);
    recordDelivery(db, agentId, {
      status: 'redispatched',
      task_id: 'VNM-48.02',
      branch: 'feat/conflict',
    });

    const ctrl = bootstrapBackpressure(db, { baseWip: 4 });
    const state = ctrl.getState();

    expect(state.recentMergeResults).toHaveLength(1);
    expect(state.recentMergeResults[0].success).toBe(false);
    expect(state.recentMergeResults[0].hadConflict).toBe(true);
    expect(state.conflictRate).toBe(1);
  });

  it('sets merge queue depth from pr-open deliveries', () => {
    const a1 = makeAgent(db);
    const a2 = makeAgent(db);
    recordDelivery(db, a1, {
      status: 'pr-open',
      task_id: 'VNM-48.03',
      branch: 'feat/a',
      pr_number: 1,
      pr_url: 'https://github.com/org/repo/pull/1',
    });
    recordDelivery(db, a2, {
      status: 'pr-open',
      task_id: 'VNM-48.04',
      branch: 'feat/b',
      pr_number: 2,
      pr_url: 'https://github.com/org/repo/pull/2',
    });

    const ctrl = bootstrapBackpressure(db, { baseWip: 5 });
    const state = ctrl.getState();

    expect(state.mergeQueueDepth).toBe(2);
  });

  it('returns nominal controller when delivery_states table is empty', () => {
    const ctrl = bootstrapBackpressure(db, { baseWip: 3 });
    const state = ctrl.getState();

    expect(state.mergeQueueDepth).toBe(0);
    expect(state.conflictRate).toBe(0);
    expect(state.stallRate).toBe(0);
  });

  it('reduces WIP when merge queue exceeds threshold', () => {
    for (let i = 1; i <= 4; i++) {
      const agentId = makeAgent(db);
      recordDelivery(db, agentId, {
        status: 'pr-open',
        task_id: `VNM-48.0${i}`,
        branch: `feat/${i}`,
        pr_number: i,
        pr_url: `https://github.com/org/repo/pull/${i}`,
      });
    }

    const ctrl = bootstrapBackpressure(db, { baseWip: 4 });
    const result = ctrl.computeEffectiveWip();

    // queue depth 4, threshold 2: reduces by 2 → effectiveWip = 2
    expect(result.effectiveWip).toBe(2);
    expect(result.reason).toContain('merge queue');
  });
});
