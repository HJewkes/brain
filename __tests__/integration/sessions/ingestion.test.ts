import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { loadModules } from '../../../src/modules/loader.js';
import { createTestDb, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { sessionsModule } from '../../../src/modules/sessions/index.js';
import { runIngestionPipeline } from '../../../src/modules/sessions/ingestion/pipeline.js';
import {
  listSessions,
  getSession,
  getSessionBySessionId,
} from '../../../src/modules/sessions/data/session-ops.js';
import { resolveSessionRef } from '../../../src/modules/sessions/engine/resolve-ref.js';
import { assembleSessionContext } from '../../../src/modules/sessions/engine/context-bundle.js';
import { renderSessionContext } from '../../../src/modules/sessions/engine/render.js';

const FIXTURE_PATH = join(
  import.meta.dirname ?? '__tests__/modules/sessions/fixtures',
  '..',
  '..',
  'modules',
  'sessions',
  'fixtures',
  'sample.jsonl'
);

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
let claudeProjectsDir: string;
const embedder = createMockEmbedder();

function setupClaudeProjectDir(jsonlContent: string, sessionId?: string): string {
  const projectHash = `-Users-test-project`;
  const projectDir = join(claudeProjectsDir, projectHash);
  mkdirSync(projectDir, { recursive: true });

  const sid = sessionId ?? randomUUID();
  const filePath = join(projectDir, `${sid}.jsonl`);
  writeFileSync(filePath, jsonlContent, 'utf-8');
  return sid;
}

beforeEach(async () => {
  ({ db } = createTestDb());
  db.setEmbeddingModel(embedder.model, embedder.dimensions);

  notesDir = join(tmpdir(), `sessions-integ-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });

  claudeProjectsDir = join(tmpdir(), `claude-projects-${randomUUID()}`);
  mkdirSync(claudeProjectsDir, { recursive: true });

  config = {
    notesDir,
    dbPath: '',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await loadModules({ modules: [sessionsModule] });
});

afterEach(() => {
  db.close();
  for (const dir of [notesDir, claudeProjectsDir]) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('Session ingestion pipeline integration', () => {
  it('ingests sample.jsonl fixture end-to-end', async () => {
    const projectHash = `-Users-test-project`;
    const projectDir = join(claudeProjectsDir, projectHash);
    mkdirSync(projectDir, { recursive: true });
    copyFileSync(FIXTURE_PATH, join(projectDir, 'test-session-001.jsonl'));

    const report = await runIngestionPipeline(db, config, embedder, null, {
      skipSummaries: true,
      claudeProjectsDir,
    });

    expect(report.discovered).toBe(1);
    expect(report.ingested).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.errors).toHaveLength(0);

    // Verify session was created in DB
    const session = getSessionBySessionId(db, 'test-session-001');
    expect(session).not.toBeNull();
    expect(session!.status).toBe('completed');
    expect(session!.project_dir).toBe('/Users/test/project');

    // Verify getSession by display_id works
    const byDisplay = getSession(db, session!.display_id);
    expect(byDisplay).not.toBeNull();
    expect(byDisplay!.session_id).toBe('test-session-001');

    // Verify L2 content file was written
    const l2Path = join(notesDir, 'modules', 'sessions', session!.display_id, 'l2-timeline.md');
    expect(existsSync(l2Path)).toBe(true);
    const l2Content = readFileSync(l2Path, 'utf-8');
    expect(l2Content).toContain('Session Timeline');
    expect(l2Content).toContain('Tool Call Log');
  });

  it('is idempotent on re-ingest', async () => {
    const projectHash = `-Users-test-project`;
    const projectDir = join(claudeProjectsDir, projectHash);
    mkdirSync(projectDir, { recursive: true });
    copyFileSync(FIXTURE_PATH, join(projectDir, 'test-session-001.jsonl'));

    const opts = { skipSummaries: true, claudeProjectsDir };

    const first = await runIngestionPipeline(db, config, embedder, null, opts);
    expect(first.ingested).toBe(1);

    const second = await runIngestionPipeline(db, config, embedder, null, opts);
    expect(second.discovered).toBe(1);
    expect(second.skipped).toBe(1);
    expect(second.ingested).toBe(0);

    const sessions = listSessions(db);
    expect(sessions).toHaveLength(1);
  });

  it('skips trivial sessions with less than 2 user turns', async () => {
    const trivialJsonl = [
      JSON.stringify({
        uuid: 'u1',
        sessionId: 'trivial-session',
        type: 'user',
        timestamp: '2026-03-13T10:00:00.000Z',
        cwd: '/Users/test/project',
        version: '1.0.0',
        message: { role: 'user', content: 'Hello' },
      }),
      JSON.stringify({
        uuid: 'a1',
        parentUuid: 'u1',
        sessionId: 'trivial-session',
        type: 'assistant',
        timestamp: '2026-03-13T10:00:05.000Z',
        message: {
          model: 'claude-opus-4-6',
          id: 'msg_1',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello!' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      }),
    ].join('\n');

    setupClaudeProjectDir(trivialJsonl, 'trivial-session');

    const report = await runIngestionPipeline(db, config, embedder, null, {
      skipSummaries: true,
      claudeProjectsDir,
    });

    expect(report.discovered).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.ingested).toBe(0);

    const sessions = listSessions(db);
    expect(sessions).toHaveLength(0);
  });

  it('lists sessions with filters after ingestion', async () => {
    const projectHash = `-Users-test-project`;
    const projectDir = join(claudeProjectsDir, projectHash);
    mkdirSync(projectDir, { recursive: true });
    copyFileSync(FIXTURE_PATH, join(projectDir, 'test-session-001.jsonl'));

    await runIngestionPipeline(db, config, embedder, null, {
      skipSummaries: true,
      claudeProjectsDir,
    });

    // Filter by status
    const completed = listSessions(db, { status: 'completed' });
    expect(completed).toHaveLength(1);

    const active = listSessions(db, { status: 'active' });
    expect(active).toHaveLength(0);

    // Filter by projectDir
    const byProject = listSessions(db, { projectDir: '/Users/test/project' });
    expect(byProject).toHaveLength(1);

    const otherProject = listSessions(db, { projectDir: '/Users/other/project' });
    expect(otherProject).toHaveLength(0);

    // Filter by since (before session start)
    const sinceEarly = listSessions(db, { since: '2026-03-13T09:00:00.000Z' });
    expect(sinceEarly).toHaveLength(1);

    // Filter by since (after session start)
    const sinceLate = listSessions(db, { since: '2026-03-14T00:00:00.000Z' });
    expect(sinceLate).toHaveLength(0);
  });

  it('resolves session ref and renders context', async () => {
    const projectHash = `-Users-test-project`;
    const projectDir = join(claudeProjectsDir, projectHash);
    mkdirSync(projectDir, { recursive: true });
    copyFileSync(FIXTURE_PATH, join(projectDir, 'test-session-001.jsonl'));

    await runIngestionPipeline(db, config, embedder, null, {
      skipSummaries: true,
      claudeProjectsDir,
    });

    const session = getSessionBySessionId(db, 'test-session-001')!;

    // Resolve by display_id
    const byDisplayId = resolveSessionRef(db, session.display_id);
    expect(byDisplayId).toHaveLength(1);
    expect(byDisplayId[0].session_id).toBe('test-session-001');

    // Resolve by "last"
    const last = resolveSessionRef(db, 'last');
    expect(last).toHaveLength(1);
    expect(last[0].session_id).toBe('test-session-001');

    // Assemble context
    const bundle = assembleSessionContext(db, config, session);
    expect(bundle.session.display_id).toBe(session.display_id);
    expect(bundle.gitState.branch).toBe('feat/session');

    // Render markdown
    const md = renderSessionContext(bundle, 'markdown');
    expect(md).toContain(`# Session ${session.display_id}`);
    expect(md).toContain('## Session Info');
    expect(md).toContain('**Status**: completed');

    // Render XML
    const xml = renderSessionContext(bundle, 'xml');
    expect(xml).toContain('<session_context>');
    expect(xml).toContain('status="completed"');

    // Render JSON
    const json = renderSessionContext(bundle, 'json');
    const parsed = JSON.parse(json);
    expect(parsed.session.session_id).toBe('test-session-001');
  });

  it('deletes session note via db.deleteNote', async () => {
    const projectHash = `-Users-test-project`;
    const projectDir = join(claudeProjectsDir, projectHash);
    mkdirSync(projectDir, { recursive: true });
    copyFileSync(FIXTURE_PATH, join(projectDir, 'test-session-001.jsonl'));

    await runIngestionPipeline(db, config, embedder, null, {
      skipSummaries: true,
      claudeProjectsDir,
    });

    const session = getSessionBySessionId(db, 'test-session-001')!;
    const noteIds = db.getModuleNoteIds({ module: 'sessions', type: 'session' });
    expect(noteIds).toHaveLength(1);

    db.deleteNote(noteIds[0]);

    const afterDelete = db.getModuleNoteIds({ module: 'sessions', type: 'session' });
    expect(afterDelete).toHaveLength(0);

    const gone = getSession(db, session.display_id);
    expect(gone).toBeNull();
  });
});
