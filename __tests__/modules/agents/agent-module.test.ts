import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ModuleRegistry } from '../../../src/modules/registry.js';
import { createModuleContext } from '../../../src/modules/context.js';
import { runModuleMigrations } from '../../../src/modules/loader.js';
import { agentsModule } from '../../../src/modules/agents/index.js';
import {
  createAgent,
  getAgent,
  listAgents,
  updateAgentStatus,
  allocateWorktree,
  releaseWorktree,
  getWorktreeAllocations,
  countActiveAgents,
} from '../../../src/modules/agents/data.js';

describe('agents module', () => {
  let registry: ModuleRegistry;

  beforeEach(() => {
    registry = new ModuleRegistry();
    registry.registerModule(agentsModule);
    const ctx = createModuleContext(registry, 'agents');
    agentsModule.register(ctx);
  });

  // ── Registration ─────────────────────────────────────────────────────────

  describe('registration', () => {
    it('has correct name and version', () => {
      const mod = registry.getModule('agents');
      expect(mod).toBeDefined();
      expect(mod!.name).toBe('agents');
      expect(mod!.version).toBe('0.1.0');
    });

    it('registers the agent note type as fast/private', () => {
      const noteType = registry.getNoteType('agent');
      expect(noteType).toBeDefined();
      expect(noteType!.tier).toBe('fast');

      const filter = registry.getFilterForModule('agents');
      expect(filter!.visibility).toBe('private');
    });

    it('registers the worktree-allocation note type as fast', () => {
      const noteType = registry.getNoteType('worktree-allocation');
      expect(noteType).toBeDefined();
      expect(noteType!.tier).toBe('fast');
    });

    it('registers extraction strategy that always returns false', () => {
      const strategy = registry.getExtractionStrategy('agents');
      expect(strategy).toBeDefined();
      expect(strategy!.shouldExtract({ id: 'x' } as never)).toBe(false);
    });

    it('registers 3 migrations', () => {
      const migrations = registry.getMigrations('agents');
      expect(migrations).toHaveLength(3);
      expect(migrations[0].migration.version).toBe(1);
      expect(migrations[1].migration.version).toBe(2);
      expect(migrations[2].migration.version).toBe(3);
    });

    it('registers hook handlers for pre-tool-use and agent-done', () => {
      const handlers = registry.getHookHandlers();
      const agentHandlers = handlers.filter((h) => h.module === 'agents');
      expect(agentHandlers).toHaveLength(2);
      const events = agentHandlers.map((h) => h.handler.event).sort();
      expect(events).toEqual(['agent-done', 'pre-tool-use']);
    });
  });

  // ── Migration ─────────────────────────────────────────────────────────────

  describe('migration', () => {
    it('v1 creates agents and worktree_allocations tables', () => {
      const db = new Database(':memory:');

      const migrations = registry.getMigrations('agents');
      migrations[0].migration.up(db);

      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agents','worktree_allocations') ORDER BY name"
        )
        .all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name)).toEqual(['agents', 'worktree_allocations']);

      db.close();
    });

    it('v1 creates status index on agents', () => {
      const db = new Database(':memory:');
      const migrations = registry.getMigrations('agents');
      migrations[0].migration.up(db);

      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_agents_status'")
        .get() as { name: string } | undefined;
      expect(idx).toBeDefined();

      db.close();
    });

    it('migration is idempotent', () => {
      const db = new Database(':memory:');
      const migrations = registry.getMigrations('agents');
      expect(() => {
        migrations[0].migration.up(db);
        migrations[0].migration.up(db);
      }).not.toThrow();
      db.close();
    });

    it('works with runModuleMigrations', () => {
      const db = new Database(':memory:');
      const applied = runModuleMigrations(registry, db, new Map());
      expect(applied).toHaveLength(3);
      expect(applied[0].module).toBe('agents');
      expect(applied[0].version).toBe(1);
      expect(applied[1].module).toBe('agents');
      expect(applied[1].version).toBe(2);
      expect(applied[2].module).toBe('agents');
      expect(applied[2].version).toBe(3);

      const reapplied = runModuleMigrations(registry, db, new Map([['agents', 3]]));
      expect(reapplied).toHaveLength(0);

      db.close();
    });
  });

  // ── CRUD ─────────────────────────────────────────────────────────────────

  describe('agent CRUD', () => {
    let db: ReturnType<typeof Database>;

    beforeEach(() => {
      db = new Database(':memory:');
      const migrations = registry.getMigrations('agents');
      for (const m of migrations) m.migration.up(db);
    });

    afterEach(() => {
      db.close();
    });

    it('createAgent inserts a record and returns an ID', () => {
      const id = createAgent(db, { name: 'impl-agent', parent: 'orchestrator' });
      expect(id).toBeTruthy();
      expect(id).toHaveLength(36); // UUID format
    });

    it('getAgent retrieves the created record', () => {
      const id = createAgent(db, {
        name: 'impl-agent',
        parent: 'orchestrator',
        brain_task: 'VNM-07.03',
        branch: 'worktree/vnm-07/task-03',
        ownership: ['src/modules/agents/'],
      });

      const agent = getAgent(db, id);
      expect(agent).not.toBeNull();
      expect(agent!.id).toBe(id);
      expect(agent!.name).toBe('impl-agent');
      expect(agent!.parent).toBe('orchestrator');
      expect(agent!.brain_task).toBe('VNM-07.03');
      expect(agent!.branch).toBe('worktree/vnm-07/task-03');
      expect(agent!.status).toBe('pending');
      // ownership stored as JSON string
      expect(JSON.parse(agent!.ownership!)).toEqual(['src/modules/agents/']);
    });

    it('getAgent returns null for unknown ID', () => {
      const result = getAgent(db, 'nonexistent-id');
      expect(result).toBeNull();
    });

    it('listAgents returns all agents', () => {
      createAgent(db, { name: 'agent-a', parent: 'root' });
      createAgent(db, { name: 'agent-b', parent: 'root' });
      createAgent(db, { name: 'agent-c', parent: 'root' });

      const agents = listAgents(db);
      expect(agents).toHaveLength(3);
      expect(agents.map((a) => a.name).sort()).toEqual(['agent-a', 'agent-b', 'agent-c']);
    });

    it('listAgents filters by status', () => {
      const idA = createAgent(db, { name: 'agent-a', parent: 'root' });
      const idB = createAgent(db, { name: 'agent-b', parent: 'root' });
      createAgent(db, { name: 'agent-c', parent: 'root' });

      updateAgentStatus(db, idA, 'active');
      updateAgentStatus(db, idB, 'active');

      const active = listAgents(db, { status: 'active' });
      expect(active).toHaveLength(2);
      const pending = listAgents(db, { status: 'pending' });
      expect(pending).toHaveLength(1);
    });

    it('updateAgentStatus transitions to active and sets started_at', () => {
      const id = createAgent(db, { name: 'agent-x', parent: 'root' });
      updateAgentStatus(db, id, 'active', { pid: 12345 });

      const agent = getAgent(db, id);
      expect(agent!.status).toBe('active');
      expect(agent!.started_at).toBeTruthy();
      expect(agent!.pid).toBe(12345);
    });

    it('updateAgentStatus transitions to completed and sets completed_at and summary', () => {
      const id = createAgent(db, { name: 'agent-x', parent: 'root' });
      updateAgentStatus(db, id, 'active');
      updateAgentStatus(db, id, 'completed', {
        summary: 'All tests passed',
        exit_reason: 'success',
      });

      const agent = getAgent(db, id);
      expect(agent!.status).toBe('completed');
      expect(agent!.completed_at).toBeTruthy();
      expect(agent!.summary).toBe('All tests passed');
      expect(agent!.exit_reason).toBe('success');
    });

    it('updateAgentStatus transitions to failed', () => {
      const id = createAgent(db, { name: 'agent-x', parent: 'root' });
      updateAgentStatus(db, id, 'failed', { exit_reason: 'timeout' });

      const agent = getAgent(db, id);
      expect(agent!.status).toBe('failed');
      expect(agent!.completed_at).toBeTruthy();
      expect(agent!.exit_reason).toBe('timeout');
    });
  });

  // ── Worktree allocation ───────────────────────────────────────────────────

  describe('worktree allocation', () => {
    let db: ReturnType<typeof Database>;

    beforeEach(() => {
      db = new Database(':memory:');
      const migrations = registry.getMigrations('agents');
      for (const m of migrations) m.migration.up(db);
    });

    afterEach(() => {
      db.close();
    });

    it('allocateWorktree inserts a record', () => {
      allocateWorktree(db, {
        task_id: 'VNM-07.03',
        workstream: 'vnm-07',
        worktree_path: '/tmp/worktrees/vnm-07',
        branch: 'worktree/vnm-07/task-03',
        claim_token: 'tok-abc',
      });

      const allocs = getWorktreeAllocations(db);
      expect(allocs).toHaveLength(1);
      expect(allocs[0].task_id).toBe('VNM-07.03');
      expect(allocs[0].workstream).toBe('vnm-07');
      expect(allocs[0].branch).toBe('worktree/vnm-07/task-03');
    });

    it('allocateWorktree is idempotent (INSERT OR REPLACE)', () => {
      allocateWorktree(db, {
        task_id: 'VNM-07.03',
        worktree_path: '/tmp/worktrees/vnm-07',
        branch: 'worktree/vnm-07/task-03',
      });
      allocateWorktree(db, {
        task_id: 'VNM-07.03',
        worktree_path: '/tmp/worktrees/vnm-07-v2',
        branch: 'worktree/vnm-07/task-03-v2',
      });

      const allocs = getWorktreeAllocations(db);
      expect(allocs).toHaveLength(1);
      expect(allocs[0].worktree_path).toBe('/tmp/worktrees/vnm-07-v2');
    });

    it('releaseWorktree removes the record', () => {
      allocateWorktree(db, {
        task_id: 'VNM-07.03',
        worktree_path: '/tmp/worktrees/vnm-07',
        branch: 'feat/vnm-07',
      });

      releaseWorktree(db, 'VNM-07.03');

      const allocs = getWorktreeAllocations(db);
      expect(allocs).toHaveLength(0);
    });

    it('releaseWorktree is a no-op for unknown task_id', () => {
      expect(() => releaseWorktree(db, 'unknown-task')).not.toThrow();
    });

    it('getWorktreeAllocations returns multiple allocations ordered by created_at', () => {
      allocateWorktree(db, {
        task_id: 'VNM-07.01',
        worktree_path: '/tmp/worktrees/vnm-07',
        branch: 'feat/01',
      });
      allocateWorktree(db, {
        task_id: 'VNM-07.02',
        worktree_path: '/tmp/worktrees/vnm-08',
        branch: 'feat/02',
      });

      const allocs = getWorktreeAllocations(db);
      expect(allocs).toHaveLength(2);
      expect(allocs[0].task_id).toBe('VNM-07.01');
      expect(allocs[1].task_id).toBe('VNM-07.02');
    });
  });

  // ── countActiveAgents ─────────────────────────────────────────────────────

  describe('countActiveAgents', () => {
    let db: ReturnType<typeof Database>;

    beforeEach(() => {
      db = new Database(':memory:');
      const migrations = registry.getMigrations('agents');
      for (const m of migrations) m.migration.up(db);
    });

    afterEach(() => {
      db.close();
    });

    it('returns 0 when no agents exist', () => {
      expect(countActiveAgents(db)).toBe(0);
    });

    it('counts only active agents', () => {
      const id1 = createAgent(db, { name: 'a', parent: 'root' });
      const id2 = createAgent(db, { name: 'b', parent: 'root' });
      const id3 = createAgent(db, { name: 'c', parent: 'root' });

      updateAgentStatus(db, id1, 'active');
      updateAgentStatus(db, id2, 'active');
      updateAgentStatus(db, id3, 'completed');

      expect(countActiveAgents(db)).toBe(2);
    });

    it('count decreases after agent completes', () => {
      const id = createAgent(db, { name: 'a', parent: 'root' });
      updateAgentStatus(db, id, 'active');
      expect(countActiveAgents(db)).toBe(1);

      updateAgentStatus(db, id, 'completed');
      expect(countActiveAgents(db)).toBe(0);
    });
  });
});
