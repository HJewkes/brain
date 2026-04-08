import type Database from 'better-sqlite3';
import { spawnSync, execFileSync } from 'node:child_process';
import { recordDelivery, getDelivery, type DeliveryRecord } from './delivery.js';

interface AgentRow {
  id: string;
  brain_task?: string | null;
  worktree_path?: string | null;
  [key: string]: unknown;
}

interface PrViewResult {
  state: string;
  mergedAt?: string | null;
}

export function reconcileDeliveries(db: Database.Database, _projectPath: string): void {
  const rows = db
    .prepare("SELECT * FROM delivery_states WHERE status = 'pr-open'")
    .all() as DeliveryRecord[];

  for (const row of rows) {
    if (!row.pr_number) continue;
    const result = spawnSync('gh', [
      'pr',
      'view',
      String(row.pr_number),
      '--json',
      'state,mergedAt',
    ]);
    if (result.status !== 0) continue;
    let prData: PrViewResult;
    try {
      prData = JSON.parse(String(result.stdout)) as PrViewResult;
    } catch {
      continue;
    }
    if (prData.state === 'MERGED') {
      recordDelivery(db, row.agent_id, {
        status: 'merged',
        pr_merged_at: prData.mergedAt ?? new Date().toISOString(),
      });
    }
  }
}

export function cleanupAfterMerge(
  db: Database.Database,
  agent: AgentRow,
  projectPath: string
): void {
  if (!agent.brain_task) return;

  const delivery = getDelivery(db, agent.id);
  if (delivery) {
    recordDelivery(db, agent.id, {
      status: 'delivered',
      delivered_at: new Date().toISOString(),
    });
  }

  db.prepare('DELETE FROM worktree_allocations WHERE task_id = ?').run(agent.brain_task);

  if (agent.worktree_path) {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', agent.worktree_path], {
        cwd: projectPath,
      });
    } catch {
      // Worktree may already be removed
    }
  }
}
