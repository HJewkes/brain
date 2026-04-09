import type { ModuleMigration } from '../types.js';

export const agentsMigrationV1: ModuleMigration = {
  version: 1,
  description: 'Create agents and worktree_allocations tables',
  up: (db) => {
    const rawDb = db as { exec(sql: string): void };
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id            TEXT    PRIMARY KEY,
        name          TEXT    NOT NULL,
        parent        TEXT    NOT NULL DEFAULT '',
        status        TEXT    NOT NULL DEFAULT 'pending'
                              CHECK(status IN ('pending','active','completed','failed','abandoned')),
        brain_task    TEXT,
        claim_token   TEXT,
        branch        TEXT,
        worktree_path TEXT,
        ownership     TEXT,
        dod_spec      TEXT,
        pid           INTEGER,
        created_at    TEXT    NOT NULL,
        started_at    TEXT,
        completed_at  TEXT,
        summary       TEXT,
        exit_reason   TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

      CREATE TABLE IF NOT EXISTS worktree_allocations (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id       TEXT    NOT NULL UNIQUE,
        workstream    TEXT,
        worktree_path TEXT    NOT NULL,
        branch        TEXT    NOT NULL,
        claim_token   TEXT,
        created_at    TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_worktree_allocations_task_id
        ON worktree_allocations(task_id);
    `);
  },
};

export const agentsMigrationV2: ModuleMigration = {
  version: 2,
  description: 'Add extensible context JSON column to agents table',
  up: (db) => {
    const rawDb = db as { exec(sql: string): void };
    rawDb.exec(`ALTER TABLE agents ADD COLUMN context TEXT NOT NULL DEFAULT '{}'`);
  },
};

export const agentsMigrationV3: ModuleMigration = {
  version: 3,
  description: 'Create delivery_states table for delivery lifecycle tracking',
  up: (db) => {
    const rawDb = db as { exec(sql: string): void };
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS delivery_states (
        agent_id     TEXT PRIMARY KEY REFERENCES agents(id),
        task_id      TEXT NOT NULL,
        branch       TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'in-progress'
                     CHECK(status IN (
                       'in-progress','pushed','push-failed',
                       'pr-open','pr-failed','conflicted',
                       'merged','delivered','stalled','redispatched'
                     )),
        pr_number    INTEGER,
        pr_url       TEXT,
        pr_merged_at TEXT,
        delivered_at TEXT,
        retry_count  INTEGER NOT NULL DEFAULT 0,
        session_id   TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_delivery_status ON delivery_states(status);
      CREATE INDEX IF NOT EXISTS idx_delivery_task ON delivery_states(task_id);
    `);
  },
};
