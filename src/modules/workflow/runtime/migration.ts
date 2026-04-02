import type { ModuleMigration } from '../../types.js';

/**
 * Migration V1: Create workflow_runs table for the imperative workflow runtime.
 * Single table stores run state, step memoization cache, and active agent tracking.
 */
export const workflowRuntimeMigrationV1: ModuleMigration = {
  version: 100,
  description: 'Create workflow_runs table for imperative workflow runtime',
  up: (db) => {
    const rawDb = db as { exec(sql: string): void };
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_name TEXT NOT NULL,
        context JSON NOT NULL,
        status TEXT NOT NULL DEFAULT 'running'
          CHECK(status IN ('running', 'completed', 'failed', 'paused')),
        current_step TEXT,
        step_results JSON NOT NULL DEFAULT '{}',
        active_agent JSON,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
    `);
  },
};
