import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ModuleRegistry } from '../../../src/modules/registry.js';
import { createModuleContext } from '../../../src/modules/context.js';
import { agentsModule } from '../../../src/modules/agents/index.js';
import {
  createAgent,
  getAgent,
  getAgentContext,
  setAgentContext,
} from '../../../src/modules/agents/data.js';

function setupDb(registry: ModuleRegistry): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  const migrations = registry.getMigrations('agents');
  for (const m of migrations) {
    m.migration.up(db);
  }
  return db;
}

describe('agent context', () => {
  let registry: ModuleRegistry;
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    registry = new ModuleRegistry();
    registry.registerModule(agentsModule);
    const ctx = createModuleContext(registry, 'agents');
    agentsModule.register(ctx);
    db = setupDb(registry);
  });

  afterEach(() => {
    db.close();
  });

  // ── Migration ─────────────────────────────────────────────────────────────

  describe('migration v2', () => {
    it('adds context column with default empty JSON object', () => {
      const id = createAgent(db, { name: 'ctx-agent', parent: 'root' });
      const agent = getAgent(db, id);
      expect(agent).not.toBeNull();
      expect(agent!.context).toBe('{}');
    });

    it('v2 migration is registered', () => {
      const migrations = registry.getMigrations('agents');
      expect(migrations.length).toBeGreaterThanOrEqual(2);
      const v2 = migrations.find((m) => m.migration.version === 2);
      expect(v2).toBeDefined();
      expect(v2!.migration.description).toContain('context');
    });
  });

  // ── getAgentContext ─────────────────────────────────────────────────────────

  describe('getAgentContext', () => {
    it('returns empty object for a new agent', () => {
      const id = createAgent(db, { name: 'ctx-agent', parent: 'root' });
      const ctx = getAgentContext(db, id);
      expect(ctx).toEqual({});
    });

    it('returns undefined for nonexistent agent', () => {
      const result = getAgentContext(db, 'nonexistent-id');
      expect(result).toBeUndefined();
    });

    it('returns specific key value when key is provided', () => {
      const id = createAgent(db, { name: 'ctx-agent', parent: 'root' });
      setAgentContext(db, id, 'tool_count', 42);

      const value = getAgentContext(db, id, 'tool_count');
      expect(value).toBe(42);
    });

    it('returns undefined for missing key', () => {
      const id = createAgent(db, { name: 'ctx-agent', parent: 'root' });
      const value = getAgentContext(db, id, 'missing_key');
      expect(value).toBeUndefined();
    });
  });

  // ── setAgentContext ─────────────────────────────────────────────────────────

  describe('setAgentContext', () => {
    it('sets a string value', () => {
      const id = createAgent(db, { name: 'ctx-agent', parent: 'root' });
      setAgentContext(db, id, 'last_file', '/src/main.ts');

      const ctx = getAgentContext(db, id) as Record<string, unknown>;
      expect(ctx.last_file).toBe('/src/main.ts');
    });

    it('sets a numeric value', () => {
      const id = createAgent(db, { name: 'ctx-agent', parent: 'root' });
      setAgentContext(db, id, 'error_count', 3);

      const value = getAgentContext(db, id, 'error_count');
      expect(value).toBe(3);
    });

    it('sets a boolean value', () => {
      const id = createAgent(db, { name: 'ctx-agent', parent: 'root' });
      setAgentContext(db, id, 'has_errors', true);

      const value = getAgentContext(db, id, 'has_errors');
      expect(value).toBe(true);
    });

    it('sets an object value', () => {
      const id = createAgent(db, { name: 'ctx-agent', parent: 'root' });
      const toolStats = { reads: 10, writes: 3, searches: 5 };
      setAgentContext(db, id, 'tool_stats', toolStats);

      const value = getAgentContext(db, id, 'tool_stats');
      expect(value).toEqual(toolStats);
    });

    it('sets an array value', () => {
      const id = createAgent(db, { name: 'ctx-agent', parent: 'root' });
      setAgentContext(db, id, 'files_accessed', ['/src/a.ts', '/src/b.ts']);

      const value = getAgentContext(db, id, 'files_accessed');
      expect(value).toEqual(['/src/a.ts', '/src/b.ts']);
    });

    it('merges multiple keys without overwriting', () => {
      const id = createAgent(db, { name: 'ctx-agent', parent: 'root' });
      setAgentContext(db, id, 'key_a', 'value_a');
      setAgentContext(db, id, 'key_b', 'value_b');

      const ctx = getAgentContext(db, id) as Record<string, unknown>;
      expect(ctx.key_a).toBe('value_a');
      expect(ctx.key_b).toBe('value_b');
    });

    it('overwrites existing key value', () => {
      const id = createAgent(db, { name: 'ctx-agent', parent: 'root' });
      setAgentContext(db, id, 'count', 1);
      setAgentContext(db, id, 'count', 2);

      const value = getAgentContext(db, id, 'count');
      expect(value).toBe(2);
    });

    it('is a no-op for nonexistent agent', () => {
      expect(() => setAgentContext(db, 'nonexistent', 'key', 'value')).not.toThrow();
    });

    it('sets null value', () => {
      const id = createAgent(db, { name: 'ctx-agent', parent: 'root' });
      setAgentContext(db, id, 'cleared', null);

      const value = getAgentContext(db, id, 'cleared');
      expect(value).toBeNull();
    });
  });
});
