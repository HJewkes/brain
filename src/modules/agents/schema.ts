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
    const rawDb = db as {
      exec(sql: string): void;
      prepare(sql: string): { all(...args: unknown[]): unknown[] };
    };
    const cols = rawDb.prepare('PRAGMA table_info(agents)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'context')) {
      rawDb.exec(`ALTER TABLE agents ADD COLUMN context TEXT NOT NULL DEFAULT '{}'`);
    }
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

export const agentsMigrationV4: ModuleMigration = {
  version: 4,
  description: 'Add review tier, fix tracking, and human signal columns to delivery_states',
  up: (db) => {
    const rawDb = db as {
      exec(sql: string): void;
      prepare(sql: string): { all(...args: unknown[]): unknown[] };
    };

    // Recreate delivery_states without the CHECK constraint on status, so
    // application-level validation in recordDelivery can evolve the set of
    // valid statuses without schema churn. Also adds the new columns used by
    // the review/merge workflow.
    try {
      rawDb.exec(`
        CREATE TABLE delivery_states_v4 (
          agent_id        TEXT PRIMARY KEY REFERENCES agents(id),
          task_id         TEXT NOT NULL,
          branch          TEXT NOT NULL,
          status          TEXT NOT NULL DEFAULT 'in-progress',
          pr_number       INTEGER,
          pr_url          TEXT,
          pr_merged_at    TEXT,
          delivered_at    TEXT,
          retry_count     INTEGER NOT NULL DEFAULT 0,
          session_id      TEXT,
          review_tier     TEXT,
          review_score    INTEGER,
          fix_attempts    INTEGER NOT NULL DEFAULT 0,
          review_agent_id TEXT,
          stall_reason    TEXT,
          human_signal    TEXT,
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO delivery_states_v4
          (agent_id, task_id, branch, status, pr_number, pr_url,
           pr_merged_at, delivered_at, retry_count, session_id,
           review_tier, review_score, fix_attempts, review_agent_id,
           stall_reason, human_signal, created_at, updated_at)
          SELECT agent_id, task_id, branch, status, pr_number, pr_url,
                 pr_merged_at, delivered_at, retry_count, session_id,
                 NULL, NULL, 0, NULL, NULL, NULL,
                 created_at, updated_at
          FROM delivery_states;
        DROP TABLE delivery_states;
        ALTER TABLE delivery_states_v4 RENAME TO delivery_states;
        CREATE INDEX IF NOT EXISTS idx_delivery_status ON delivery_states(status);
        CREATE INDEX IF NOT EXISTS idx_delivery_task ON delivery_states(task_id);
      `);
    } catch {
      // Already migrated — ensure any missing columns are present via ALTER.
      const cols = rawDb.prepare('PRAGMA table_info(delivery_states)').all() as {
        name: string;
      }[];
      const existing = new Set(cols.map((c) => c.name));
      if (!existing.has('review_tier')) {
        rawDb.exec(`ALTER TABLE delivery_states ADD COLUMN review_tier TEXT`);
      }
      if (!existing.has('review_score')) {
        rawDb.exec(`ALTER TABLE delivery_states ADD COLUMN review_score INTEGER`);
      }
      if (!existing.has('fix_attempts')) {
        rawDb.exec(
          `ALTER TABLE delivery_states ADD COLUMN fix_attempts INTEGER NOT NULL DEFAULT 0`
        );
      }
      if (!existing.has('review_agent_id')) {
        rawDb.exec(`ALTER TABLE delivery_states ADD COLUMN review_agent_id TEXT`);
      }
      if (!existing.has('stall_reason')) {
        rawDb.exec(`ALTER TABLE delivery_states ADD COLUMN stall_reason TEXT`);
      }
      if (!existing.has('human_signal')) {
        rawDb.exec(`ALTER TABLE delivery_states ADD COLUMN human_signal TEXT`);
      }
    }
  },
};
