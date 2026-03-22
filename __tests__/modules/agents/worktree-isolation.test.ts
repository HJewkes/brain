import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { agentsMigrationV1, agentsMigrationV2 } from '../../../src/modules/agents/schema.js';
import { requireWorktreeIsolation } from '../../../src/modules/agents/worktree.js';
import { allocateWorktree as dbAllocate } from '../../../src/modules/agents/data.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn() };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDb(): ReturnType<typeof Database> {
  const db = new Database(':memory:');
  agentsMigrationV1.up(db);
  agentsMigrationV2.up(db);
  return db;
}

function insertAllocation(
  db: ReturnType<typeof Database>,
  taskId: string,
  worktreePath: string
): void {
  dbAllocate(db, {
    task_id: taskId,
    workstream: 'ws-1',
    worktree_path: worktreePath,
    branch: `agent/ws-1/${taskId}`,
    claim_token: `tok-${taskId}`,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('requireWorktreeIsolation', () => {
  let db: ReturnType<typeof Database>;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns null when no allocations exist', () => {
    const result = requireWorktreeIsolation(db, 'task-1');
    expect(result).toBeNull();
  });

  it('returns worktree path when task has its own allocation', () => {
    insertAllocation(db, 'task-1', '/worktrees/ws-1');

    const result = requireWorktreeIsolation(db, 'task-1');
    expect(result).toBe('/worktrees/ws-1');
  });

  it('returns worktree path even when other allocations exist', () => {
    insertAllocation(db, 'task-1', '/worktrees/ws-1');
    insertAllocation(db, 'task-2', '/worktrees/ws-2');

    const result = requireWorktreeIsolation(db, 'task-1');
    expect(result).toBe('/worktrees/ws-1');
  });

  it('throws when other allocations exist but task has none', () => {
    insertAllocation(db, 'task-other', '/worktrees/ws-other');

    expect(() => requireWorktreeIsolation(db, 'task-new')).toThrow('Worktree isolation required');
  });

  it('includes allocation count in error message', () => {
    insertAllocation(db, 'task-1', '/worktrees/ws-1');
    insertAllocation(db, 'task-2', '/worktrees/ws-2');

    expect(() => requireWorktreeIsolation(db, 'task-new')).toThrow('2 other allocation(s) active');
  });

  it('includes task ID in error message', () => {
    insertAllocation(db, 'task-other', '/worktrees/ws-other');

    expect(() => requireWorktreeIsolation(db, 'my-task-99')).toThrow('my-task-99');
  });
});
