import type { ModuleMigration } from '../types.js';

export const agentsMigration: ModuleMigration = {
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
