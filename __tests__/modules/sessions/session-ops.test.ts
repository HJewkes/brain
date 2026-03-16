import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import {
  createSession,
  getSession,
  getSessionBySessionId,
  listSessions,
  updateSessionStatus,
  getSessionsForTask,
  linkSessionToTask,
} from '../../../src/modules/sessions/data/session-ops.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(() => {
  ({ dbPath, db } = createTestDb());
  notesDir = join(tmpdir(), `session-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('createSession', () => {
  it('creates a session note with correct metadata', async () => {
    const result = await createSession(db, config, embedder, {
      session_id: 'abc-123',
      project_dir: '/Users/test/project',
      status: 'completed',
      started_at: '2026-03-13T10:00:00Z',
      completed_at: '2026-03-13T11:00:00Z',
      duration_minutes: 60,
      branch: 'feat/search',
      agent_model: 'claude-opus-4-6',
      summary: 'Fixed search function',
      analytics: {
        total_turns: 10,
        tool_calls: 5,
        error_count: 1,
        tokens_input: 1000,
        tokens_output: 500,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.display_id).toMatch(/^SNS-\d{3}$/);
    expect(result.data.note_id).toBeTruthy();
  });

  it('rejects duplicate session_id', async () => {
    await createSession(db, config, embedder, {
      session_id: 'dup-1',
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-01-01T00:00:00Z',
    });

    const result = await createSession(db, config, embedder, {
      session_id: 'dup-1',
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-01-01T00:00:00Z',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DUPLICATE_SESSION');
  });

  it('round-trips all new metadata fields', async () => {
    const result = await createSession(db, config, embedder, {
      session_id: 'rt-fields',
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-03-15T10:00:00Z',
      completed_at: '2026-03-15T11:00:00Z',
      duration_minutes: 60,
      session_type: 'agent',
      outcome: 'success',
      cost_usd: 0.42,
      jsonl_path: '/tmp/sessions/abc.jsonl',
      jsonl_size_bytes: 123456,
      pr_links: ['https://github.com/org/repo/pull/1', 'https://github.com/org/repo/pull/2'],
      files_written: ['src/foo.ts', 'src/bar.ts'],
      segment_count: 3,
      instance_id: 'inst-abc-123',
      plan_id: 'plan-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const session = getSession(db, result.data.display_id);
    expect(session).not.toBeNull();
    expect(session!.session_type).toBe('agent');
    expect(session!.outcome).toBe('success');
    expect(session!.cost_usd).toBe(0.42);
    expect(session!.jsonl_path).toBe('/tmp/sessions/abc.jsonl');
    expect(session!.jsonl_size_bytes).toBe(123456);
    expect(session!.pr_links).toEqual([
      'https://github.com/org/repo/pull/1',
      'https://github.com/org/repo/pull/2',
    ]);
    expect(session!.files_written).toEqual(['src/foo.ts', 'src/bar.ts']);
    expect(session!.segment_count).toBe(3);
    expect(session!.instance_id).toBe('inst-abc-123');
  });

  it('omits new metadata fields when not provided', async () => {
    const result = await createSession(db, config, embedder, {
      session_id: 'rt-minimal',
      project_dir: '/test',
      status: 'active',
      started_at: '2026-03-15T10:00:00Z',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const session = getSession(db, result.data.display_id);
    expect(session).not.toBeNull();
    expect(session!.session_type).toBeUndefined();
    expect(session!.outcome).toBeUndefined();
    expect(session!.cost_usd).toBeUndefined();
    expect(session!.jsonl_path).toBeUndefined();
    expect(session!.jsonl_size_bytes).toBeUndefined();
    expect(session!.pr_links).toBeUndefined();
    expect(session!.files_written).toBeUndefined();
    expect(session!.segment_count).toBeUndefined();
    expect(session!.instance_id).toBeUndefined();
  });

  it('rejects missing session_id', async () => {
    const result = await createSession(db, config, embedder, {
      session_id: '',
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-01-01T00:00:00Z',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
  });
});

describe('getSession / getSessionBySessionId', () => {
  it('retrieves session by display_id', async () => {
    const created = await createSession(db, config, embedder, {
      session_id: 'sess-1',
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-01-01T00:00:00Z',
      summary: 'Test session',
    });
    if (!created.ok) throw new Error('Failed to create');

    const session = getSession(db, created.data.display_id);
    expect(session).not.toBeNull();
    expect(session!.session_id).toBe('sess-1');
    expect(session!.summary).toBe('Test session');
  });

  it('retrieves session by session_id', async () => {
    await createSession(db, config, embedder, {
      session_id: 'uuid-lookup',
      project_dir: '/test',
      status: 'active',
      started_at: '2026-01-01T00:00:00Z',
    });

    const session = getSessionBySessionId(db, 'uuid-lookup');
    expect(session).not.toBeNull();
    expect(session!.session_id).toBe('uuid-lookup');
  });

  it('returns null for missing session', () => {
    expect(getSession(db, 'SNS-999')).toBeNull();
    expect(getSessionBySessionId(db, 'nonexistent')).toBeNull();
  });
});

describe('listSessions', () => {
  it('lists all sessions sorted by started_at descending', async () => {
    await createSession(db, config, embedder, {
      session_id: 's1',
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-01-01T00:00:00Z',
    });
    await createSession(db, config, embedder, {
      session_id: 's2',
      project_dir: '/test',
      status: 'active',
      started_at: '2026-03-01T00:00:00Z',
    });
    await createSession(db, config, embedder, {
      session_id: 's3',
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-02-01T00:00:00Z',
    });

    const sessions = listSessions(db);
    expect(sessions).toHaveLength(3);
    expect(sessions[0].session_id).toBe('s2'); // most recent first
    expect(sessions[2].session_id).toBe('s1');
  });

  it('filters by status', async () => {
    await createSession(db, config, embedder, {
      session_id: 's1',
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-01-01T00:00:00Z',
    });
    await createSession(db, config, embedder, {
      session_id: 's2',
      project_dir: '/test',
      status: 'active',
      started_at: '2026-01-02T00:00:00Z',
    });

    const active = listSessions(db, { status: 'active' });
    expect(active).toHaveLength(1);
    expect(active[0].session_id).toBe('s2');
  });

  it('filters by projectDir', async () => {
    await createSession(db, config, embedder, {
      session_id: 's1',
      project_dir: '/project-a',
      status: 'completed',
      started_at: '2026-01-01T00:00:00Z',
    });
    await createSession(db, config, embedder, {
      session_id: 's2',
      project_dir: '/project-b',
      status: 'completed',
      started_at: '2026-01-02T00:00:00Z',
    });

    const filtered = listSessions(db, { projectDir: '/project-a' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].session_id).toBe('s1');
  });

  it('filters by since', async () => {
    await createSession(db, config, embedder, {
      session_id: 's1',
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-01-01T00:00:00Z',
    });
    await createSession(db, config, embedder, {
      session_id: 's2',
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-03-01T00:00:00Z',
    });

    const filtered = listSessions(db, { since: '2026-02-01T00:00:00Z' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].session_id).toBe('s2');
  });
});

describe('updateSessionStatus', () => {
  it('updates session status', async () => {
    const created = await createSession(db, config, embedder, {
      session_id: 's-update',
      project_dir: '/test',
      status: 'active',
      started_at: '2026-01-01T00:00:00Z',
    });
    if (!created.ok) throw new Error('Failed to create');

    const result = updateSessionStatus(db, created.data.display_id, 'completed', {
      completed_at: '2026-01-01T01:00:00Z',
      duration_minutes: 60,
      summary: 'Session completed',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe('completed');
    expect(result.data.completed_at).toBe('2026-01-01T01:00:00Z');
    expect(result.data.summary).toBe('Session completed');
  });

  it('returns NOT_FOUND for missing session', () => {
    const result = updateSessionStatus(db, 'SNS-999', 'completed');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('getSessionsForTask', () => {
  it('finds sessions linked to a task', async () => {
    await createSession(db, config, embedder, {
      session_id: 's-task-1',
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-01-01T00:00:00Z',
      tasks_worked: ['VNM-08.01', 'VNM-08.02'],
    });
    await createSession(db, config, embedder, {
      session_id: 's-task-2',
      project_dir: '/test',
      status: 'completed',
      started_at: '2026-01-02T00:00:00Z',
      tasks_completed: ['VNM-08.01'],
    });

    const sessions = getSessionsForTask(db, 'VNM-08.01');
    expect(sessions).toHaveLength(2);
  });

  it('returns empty for unlinked task', () => {
    expect(getSessionsForTask(db, 'VNM-99.01')).toHaveLength(0);
  });
});

describe('linkSessionToTask', () => {
  it('adds task to tasks_worked and returns ok', async () => {
    const created = await createSession(db, config, embedder, {
      session_id: 's-link',
      project_dir: '/test',
      status: 'active',
      started_at: '2026-01-01T00:00:00Z',
    });
    if (!created.ok) throw new Error('Failed');

    const result = linkSessionToTask(db, created.data.display_id, 'VNM-08.01');
    expect(result.ok).toBe(true);

    const session = getSession(db, created.data.display_id);
    expect(session!.tasks_worked).toContain('VNM-08.01');
  });

  it('is idempotent — linking same task twice does not duplicate', async () => {
    const created = await createSession(db, config, embedder, {
      session_id: 's-idem',
      project_dir: '/test',
      status: 'active',
      started_at: '2026-01-01T00:00:00Z',
    });
    if (!created.ok) throw new Error('Failed');

    linkSessionToTask(db, created.data.display_id, 'VNM-08.01');
    linkSessionToTask(db, created.data.display_id, 'VNM-08.01');

    const session = getSession(db, created.data.display_id);
    expect(session!.tasks_worked!.filter((t) => t === 'VNM-08.01')).toHaveLength(1);
  });

  it('fails for nonexistent session', () => {
    const result = linkSessionToTask(db, 'SNS-999', 'VNM-08.01');
    expect(result.ok).toBe(false);
  });
});
