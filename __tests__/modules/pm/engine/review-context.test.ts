import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildDependencyPRContexts,
  buildDependencyContextString,
  renderDependencyContextBlock,
  type DependencyPRContext,
} from '../../../../src/modules/pm/engine/review-context.js';

function createNotesSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      file_path TEXT,
      title TEXT,
      type TEXT,
      module TEXT,
      module_instance TEXT,
      metadata TEXT,
      content_dir TEXT
    );
    CREATE TABLE delivery_states (
      agent_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      branch TEXT,
      status TEXT,
      pr_number INTEGER,
      pr_url TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function insertTask(
  db: Database.Database,
  opts: {
    id: string;
    title: string;
    displayId: string;
    status?: string;
    dependsOn?: string[];
    contentDir?: string | null;
  }
): void {
  db.prepare(
    `INSERT INTO notes (id, title, type, module, metadata, content_dir)
     VALUES (?, ?, 'task', 'pm', ?, ?)`
  ).run(
    opts.id,
    opts.title,
    JSON.stringify({
      display_id: opts.displayId,
      status: opts.status ?? 'pending',
      depends_on: opts.dependsOn ?? [],
    }),
    opts.contentDir ?? null
  );
}

function insertDelivery(
  db: Database.Database,
  opts: {
    agentId: string;
    taskId: string;
    branch?: string | null;
    prNumber?: number | null;
    prUrl?: string | null;
    updatedAt?: string;
  }
): void {
  db.prepare(
    `INSERT INTO delivery_states (agent_id, task_id, branch, status, pr_number, pr_url, updated_at)
     VALUES (?, ?, ?, 'pr-open', ?, ?, ?)`
  ).run(
    opts.agentId,
    opts.taskId,
    opts.branch ?? null,
    opts.prNumber ?? null,
    opts.prUrl ?? null,
    opts.updatedAt ?? new Date().toISOString()
  );
}

describe('buildDependencyPRContexts', () => {
  let db: Database.Database;
  let workDir: string;

  beforeEach(() => {
    db = new Database(':memory:');
    createNotesSchema(db);
    workDir = mkdtempSync(join(tmpdir(), 'review-context-'));
  });

  afterEach(() => {
    db.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('returns [] when the task has no recorded dependencies', () => {
    insertTask(db, { id: 'n1', title: 'Solo', displayId: 'VNM-56.42', dependsOn: [] });
    expect(buildDependencyPRContexts(db, 'VNM-56.42')).toEqual([]);
  });

  it('returns [] when the task does not exist', () => {
    expect(buildDependencyPRContexts(db, 'VNM-56.99')).toEqual([]);
  });

  it('returns one entry per upstream task with title, status, branch, and PR url', () => {
    insertTask(db, { id: 'dep1', title: 'Add fix_attempts column', displayId: 'VNM-56.24' });
    insertDelivery(db, {
      agentId: 'a1',
      taskId: 'VNM-56.24',
      branch: 'agent/VNM-56/VNM-56.24',
      prNumber: 142,
      prUrl: 'https://github.com/example/repo/pull/142',
    });
    insertTask(db, {
      id: 'cur',
      title: 'Use fix_attempts',
      displayId: 'VNM-56.42',
      dependsOn: ['VNM-56.24'],
    });

    const result = buildDependencyPRContexts(db, 'VNM-56.42');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      displayId: 'VNM-56.24',
      title: 'Add fix_attempts column',
      branch: 'agent/VNM-56/VNM-56.24',
      prNumber: 142,
      prUrl: 'https://github.com/example/repo/pull/142',
    });
  });

  it('includes the upstream summary.md when present and trims it', () => {
    const depDir = join(workDir, 'dep');
    mkdirSync(depDir, { recursive: true });
    const summary = 'Adds the fix_attempts column to delivery_states.\nMigration v4.';
    writeFileSync(join(depDir, 'summary.md'), summary);

    insertTask(db, {
      id: 'dep1',
      title: 'Migration',
      displayId: 'VNM-56.24',
      contentDir: depDir,
    });
    insertTask(db, {
      id: 'cur',
      title: 'Consumer',
      displayId: 'VNM-56.42',
      dependsOn: ['VNM-56.24'],
    });

    const result = buildDependencyPRContexts(db, 'VNM-56.42');
    expect(result[0].summary).toBe(summary);
  });

  it('still records the dependency display_id when the upstream task is not yet ingested', () => {
    insertTask(db, {
      id: 'cur',
      title: 'Consumer',
      displayId: 'VNM-56.42',
      dependsOn: ['VNM-99.01'],
    });

    const result = buildDependencyPRContexts(db, 'VNM-56.42');
    expect(result).toEqual<DependencyPRContext[]>([
      {
        displayId: 'VNM-99.01',
        title: 'VNM-99.01',
        status: 'unknown',
        branch: null,
        prNumber: null,
        prUrl: null,
        summary: null,
      },
    ]);
  });

  it('preserves order of depends_on and uses the most recent delivery_state row', () => {
    insertTask(db, { id: 'd1', title: 'Dep One', displayId: 'VNM-56.24' });
    insertTask(db, { id: 'd2', title: 'Dep Two', displayId: 'VNM-56.27' });
    insertDelivery(db, {
      agentId: 'old',
      taskId: 'VNM-56.24',
      branch: 'old-branch',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    insertDelivery(db, {
      agentId: 'new',
      taskId: 'VNM-56.24',
      branch: 'new-branch',
      prNumber: 200,
      updatedAt: '2026-04-01T00:00:00Z',
    });
    insertTask(db, {
      id: 'cur',
      title: 'Consumer',
      displayId: 'VNM-56.42',
      dependsOn: ['VNM-56.27', 'VNM-56.24'],
    });

    const result = buildDependencyPRContexts(db, 'VNM-56.42');
    expect(result.map((r) => r.displayId)).toEqual(['VNM-56.27', 'VNM-56.24']);
    expect(result[1].branch).toBe('new-branch');
    expect(result[1].prNumber).toBe(200);
  });
});

describe('renderDependencyContextBlock', () => {
  it('returns an empty string when there are no contexts', () => {
    expect(renderDependencyContextBlock([])).toBe('');
  });

  it('renders headings, status, branch, PR, and summary', () => {
    const block = renderDependencyContextBlock([
      {
        displayId: 'VNM-56.24',
        title: 'Add fix_attempts column',
        status: 'done',
        branch: 'agent/VNM-56/VNM-56.24',
        prNumber: 142,
        prUrl: 'https://github.com/example/repo/pull/142',
        summary: 'Adds the column.',
      },
    ]);

    expect(block).toContain('## Dependency PR Context');
    expect(block).toContain('### VNM-56.24 — Add fix_attempts column');
    expect(block).toContain('Status: done');
    expect(block).toContain('PR: https://github.com/example/repo/pull/142 (#142)');
    expect(block).toContain('Branch: `agent/VNM-56/VNM-56.24`');
    expect(block).toContain('Summary from upstream author:');
    expect(block).toContain('Adds the column.');
    expect(block.trimEnd().endsWith('---')).toBe(true);
  });
});

describe('buildDependencyContextString', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createNotesSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns "" when taskDisplayId is null/undefined', () => {
    expect(buildDependencyContextString(db, null)).toBe('');
    expect(buildDependencyContextString(db, undefined)).toBe('');
    expect(buildDependencyContextString(db, '')).toBe('');
  });

  it('returns "" when no dependencies exist', () => {
    insertTask(db, { id: 'n1', title: 'Solo', displayId: 'VNM-56.42' });
    expect(buildDependencyContextString(db, 'VNM-56.42')).toBe('');
  });

  it('returns rendered block when dependencies exist', () => {
    insertTask(db, { id: 'd1', title: 'Up', displayId: 'VNM-56.24' });
    insertTask(db, {
      id: 'cur',
      title: 'Consumer',
      displayId: 'VNM-56.42',
      dependsOn: ['VNM-56.24'],
    });
    const block = buildDependencyContextString(db, 'VNM-56.42');
    expect(block).toContain('## Dependency PR Context');
    expect(block).toContain('VNM-56.24');
  });

  it('does not throw when delivery_states table is missing', () => {
    const bareDb = new Database(':memory:');
    bareDb.exec(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        title TEXT,
        type TEXT,
        module TEXT,
        metadata TEXT,
        content_dir TEXT
      );
    `);
    bareDb
      .prepare(
        `INSERT INTO notes (id, title, type, module, metadata)
         VALUES ('d', 'Up', 'task', 'pm', ?)`
      )
      .run(JSON.stringify({ display_id: 'VNM-56.24', status: 'done', depends_on: [] }));
    bareDb
      .prepare(
        `INSERT INTO notes (id, title, type, module, metadata)
         VALUES ('c', 'Consumer', 'task', 'pm', ?)`
      )
      .run(
        JSON.stringify({
          display_id: 'VNM-56.42',
          status: 'pending',
          depends_on: ['VNM-56.24'],
        })
      );

    expect(() => buildDependencyContextString(bareDb, 'VNM-56.42')).not.toThrow();
    bareDb.close();
  });
});
