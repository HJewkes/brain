import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { ModuleRegistry } from '../../../src/modules/registry.js';
import { createModuleContext } from '../../../src/modules/context.js';
import { runModuleMigrations } from '../../../src/modules/loader.js';
import { sessionsModule } from '../../../src/modules/sessions/index.js';

describe('sessions module', () => {
  let registry: ModuleRegistry;

  beforeEach(() => {
    registry = new ModuleRegistry();
    registry.registerModule(sessionsModule);
    const ctx = createModuleContext(registry, 'sessions');
    sessionsModule.register(ctx);
  });

  describe('registration', () => {
    it('registers the session note type', () => {
      const noteType = registry.getNoteType('session');
      expect(noteType).toBeDefined();
      expect(noteType!.name).toBe('session');
      expect(noteType!.tier).toBe('slow');
      expect(noteType!.schema).toBeDefined();
      expect(noteType!.schema!.required).toEqual(['session_id', 'status', 'started_at']);
    });

    it('registers directory schema for L1/L2 files', () => {
      const schema = registry.getDirectorySchema('session');
      expect(schema).toBeDefined();
      expect(schema!.files).toHaveLength(3);
      expect(schema!.files.map((f) => f.pattern)).toEqual([
        'l1-overview.md',
        'l2-timeline.md',
        'observations.md',
      ]);
    });

    it('registers all relation types', () => {
      const expected = [
        'associated-with',
        'has-session',
        'continued-from',
        'continues',
        'triggered-by',
        'recorded-in',
        'produced',
        'committed-in',
        'observed-in',
        'has-observation',
      ];
      for (const name of expected) {
        expect(registry.getRelationType(name)).toBeDefined();
      }
    });

    it('registers inverse relation pairs correctly', () => {
      expect(registry.getRelationType('associated-with')!.inverse).toBe('has-session');
      expect(registry.getRelationType('has-session')!.inverse).toBe('associated-with');
      expect(registry.getRelationType('continued-from')!.inverse).toBe('continues');
      expect(registry.getRelationType('continues')!.inverse).toBe('continued-from');
      expect(registry.getRelationType('observed-in')!.inverse).toBe('has-observation');
      expect(registry.getRelationType('has-observation')!.inverse).toBe('observed-in');
    });

    it('registers extraction strategy that always returns false', () => {
      const strategy = registry.getExtractionStrategy('sessions');
      expect(strategy).toBeDefined();
      expect(strategy!.shouldExtract({ id: 'x' } as never)).toBe(false);
    });

    it('registers contextual filter', () => {
      const filter = registry.getFilterForModule('sessions');
      expect(filter).toBeDefined();
      expect(filter!.visibility).toBe('contextual');
    });

    it('filter includes session-related queries', () => {
      const filter = registry.getFilterForModule('sessions')!;
      const note = {} as never;
      expect(filter.shouldIncludeInSearch!(note, 'show me session history')).toBe(true);
      expect(filter.shouldIncludeInSearch!(note, 'what did I work on yesterday')).toBe(true);
      expect(filter.shouldIncludeInSearch!(note, 'what was I worked on')).toBe(true);
    });

    it('filter excludes unrelated queries', () => {
      const filter = registry.getFilterForModule('sessions')!;
      const note = {} as never;
      expect(filter.shouldIncludeInSearch!(note, 'how does search work')).toBe(false);
      expect(filter.shouldIncludeInSearch!(note, 'fix the database')).toBe(false);
    });

    it('registers content handler for session type', () => {
      const handlers = registry.getContentHandlers();
      const sessionHandler = handlers.find((h) => h.handler.noteTypes.includes('session'));
      expect(sessionHandler).toBeDefined();
      expect(sessionHandler!.module).toBe('sessions');
    });

    it('registers the session command', () => {
      const commands = registry.getCommands();
      const sessionCmd = commands.find((c) => c.command.name() === 'session');
      expect(sessionCmd).toBeDefined();
      expect(sessionCmd!.module).toBe('sessions');
    });
  });

  describe('migrations', () => {
    it('registers 4 migrations', () => {
      const migrations = registry.getMigrations('sessions');
      expect(migrations).toHaveLength(4);
      expect(migrations.map((m) => m.migration.version)).toEqual([1, 2, 3, 4]);
    });

    it('v1 creates frontmatter indexes', () => {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          module TEXT,
          metadata TEXT
        )
      `);

      const migrations = registry.getMigrations('sessions');
      migrations[0].migration.up(db);

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_sessions_%'")
        .all() as Array<{ name: string }>;
      expect(indexes.map((i) => i.name).sort()).toEqual([
        'idx_sessions_project',
        'idx_sessions_project_dir',
        'idx_sessions_session_id',
        'idx_sessions_started_at',
        'idx_sessions_status',
      ]);

      db.close();
    });

    it('v2 creates session_events and session_chunks tables', () => {
      const db = new Database(':memory:');

      const migrations = registry.getMigrations('sessions');
      migrations[1].migration.up(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'session_%'")
        .all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name).sort()).toEqual(['session_chunks', 'session_events']);

      // Verify session_events dedup constraint
      db.prepare(
        "INSERT INTO session_events (session_id, event_type, category, data, timestamp, data_hash) VALUES ('s1', 'tool_use', 'Read', '{}', '2026-01-01T00:00:00Z', 'hash1')"
      ).run();
      expect(() =>
        db
          .prepare(
            "INSERT INTO session_events (session_id, event_type, category, data, timestamp, data_hash) VALUES ('s1', 'tool_use', 'Read', '{}', '2026-01-01T00:00:00Z', 'hash1')"
          )
          .run()
      ).toThrow();

      // Verify session_chunks source constraint
      expect(() =>
        db
          .prepare(
            "INSERT INTO session_chunks (session_id, chunk_index, content, source, timestamp) VALUES ('s1', 0, 'test', 'invalid', '2026-01-01T00:00:00Z')"
          )
          .run()
      ).toThrow();

      db.close();
    });

    it('v3 creates session_analytics_rollup table', () => {
      const db = new Database(':memory:');

      const migrations = registry.getMigrations('sessions');
      migrations[2].migration.up(db);

      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='session_analytics_rollup'"
        )
        .all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);

      db.close();
    });

    it('all migrations run idempotently', () => {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          module TEXT,
          metadata TEXT
        )
      `);

      const migrations = registry.getMigrations('sessions');
      // Run twice — should not throw
      for (const m of migrations) {
        m.migration.up(db);
      }
      for (const m of migrations) {
        m.migration.up(db);
      }

      db.close();
    });

    it('works with runModuleMigrations', () => {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          module TEXT,
          metadata TEXT
        )
      `);

      const applied = runModuleMigrations(registry, db, new Map());
      expect(applied).toHaveLength(4);
      expect(applied.map((a) => a.version)).toEqual([1, 2, 3, 4]);
      expect(applied.every((a) => a.module === 'sessions')).toBe(true);

      // Running again with current versions should apply nothing
      const versions = new Map([['sessions', 4]]);
      const reapplied = runModuleMigrations(registry, db, versions);
      expect(reapplied).toHaveLength(0);

      db.close();
    });
  });
});
