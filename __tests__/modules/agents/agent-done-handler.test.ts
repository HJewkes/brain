import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { handleAgentDone } from '../../../src/modules/agents/agent-done-handler.js';
import {
  createAgent,
  getAgent,
  updateAgentStatus,
  allocateWorktree,
} from '../../../src/modules/agents/data.js';
import { agentsMigrationV1, agentsMigrationV2 } from '../../../src/modules/agents/schema.js';

// Mock execFileSync so we don't shell out during tests
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  agentsMigrationV1.up(db);
  agentsMigrationV2.up(db);
  return db;
}

describe('handleAgentDone', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('marks an active agent as completed on exit_code 0', () => {
    const id = createAgent(db, { name: 'worker', parent: 'orch' });
    updateAgentStatus(db, id, 'active');

    const result = handleAgentDone(db, id, { exit_code: 0, summary: 'All done' }, '/tmp');

    expect(result.status).toBe('completed');
    expect(result.updated).toBe(true);

    const agent = getAgent(db, id);
    expect(agent!.status).toBe('completed');
    expect(agent!.completed_at).toBeTruthy();
    expect(agent!.summary).toBe('All done');
  });

  it('marks an active agent as failed on non-zero exit_code', () => {
    const id = createAgent(db, { name: 'worker', parent: 'orch' });
    updateAgentStatus(db, id, 'active');

    const result = handleAgentDone(db, id, { exit_code: 1 }, '/tmp');

    expect(result.status).toBe('failed');
    expect(result.updated).toBe(true);

    const agent = getAgent(db, id);
    expect(agent!.status).toBe('failed');
    expect(agent!.exit_reason).toBe('exit_code=1');
  });

  it('defaults to completed when exit_code is omitted', () => {
    const id = createAgent(db, { name: 'worker', parent: 'orch' });
    updateAgentStatus(db, id, 'active');

    const result = handleAgentDone(db, id, {}, '/tmp');

    expect(result.status).toBe('completed');
    expect(result.updated).toBe(true);
  });

  it('skips update when agent is not active', () => {
    const id = createAgent(db, { name: 'worker', parent: 'orch' });
    // Status is 'pending', not 'active'

    const result = handleAgentDone(db, id, { exit_code: 0 }, '/tmp');

    expect(result.updated).toBe(false);
    expect(result.worktreeReleased).toBe(false);
    expect(result.taskUpdated).toBe(false);

    const agent = getAgent(db, id);
    expect(agent!.status).toBe('pending');
  });

  it('skips update when agent does not exist', () => {
    const result = handleAgentDone(db, 'nonexistent-id', { exit_code: 0 }, '/tmp');

    expect(result.updated).toBe(false);
    expect(result.agentId).toBe('nonexistent-id');
  });

  it('releases worktree allocation when brain_task is set', () => {
    const id = createAgent(db, {
      name: 'worker',
      parent: 'orch',
      brain_task: 'VNM-07.03',
    });
    updateAgentStatus(db, id, 'active');

    allocateWorktree(db, {
      task_id: 'VNM-07.03',
      worktree_path: '/tmp/worktrees/vnm-07',
      branch: 'agent/vnm-07/VNM-07.03',
    });

    const result = handleAgentDone(db, id, { exit_code: 0 }, '/tmp');

    expect(result.worktreeReleased).toBe(true);

    // Verify the allocation was removed from DB
    const raw = db
      .prepare('SELECT COUNT(*) as n FROM worktree_allocations WHERE task_id = ?')
      .get('VNM-07.03') as { n: number };
    expect(raw.n).toBe(0);
  });

  it('does not release worktree when brain_task is null', () => {
    const id = createAgent(db, { name: 'worker', parent: 'orch' });
    updateAgentStatus(db, id, 'active');

    const result = handleAgentDone(db, id, { exit_code: 0 }, '/tmp');

    expect(result.worktreeReleased).toBe(false);
  });

  it('sets taskUpdated when brain_task is set and status is completed', () => {
    const id = createAgent(db, {
      name: 'worker',
      parent: 'orch',
      brain_task: 'VNM-07.03',
    });
    updateAgentStatus(db, id, 'active');

    const result = handleAgentDone(db, id, { exit_code: 0 }, '/tmp');

    expect(result.taskUpdated).toBe(true);
  });

  it('does not update PM task when agent failed', () => {
    const id = createAgent(db, {
      name: 'worker',
      parent: 'orch',
      brain_task: 'VNM-07.03',
    });
    updateAgentStatus(db, id, 'active');

    const result = handleAgentDone(db, id, { exit_code: 1 }, '/tmp');

    expect(result.taskUpdated).toBe(false);
  });

  it('does not update PM task when brain_task is null', () => {
    const id = createAgent(db, { name: 'worker', parent: 'orch' });
    updateAgentStatus(db, id, 'active');

    const result = handleAgentDone(db, id, { exit_code: 0 }, '/tmp');

    expect(result.taskUpdated).toBe(false);
  });

  it('skips already-completed agent without error', () => {
    const id = createAgent(db, { name: 'worker', parent: 'orch' });
    updateAgentStatus(db, id, 'active');
    updateAgentStatus(db, id, 'completed');

    const result = handleAgentDone(db, id, { exit_code: 0 }, '/tmp');

    expect(result.updated).toBe(false);
  });
});
