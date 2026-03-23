import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  classifyIdentifier,
  buildResumptionPrompt,
  recordResumption,
  extractSessionSummary,
  findSessionLogPath,
} from '../../../src/modules/agents/resume.js';
import type { ResumptionEntry, SessionSummary } from '../../../src/modules/agents/resume.js';
import type { AgentRecord } from '../../../src/modules/agents/types.js';
import type { SessionMetadata } from '../../../src/modules/sessions/types.js';
import { ModuleRegistry } from '../../../src/modules/registry.js';
import { createModuleContext } from '../../../src/modules/context.js';
import { agentsModule } from '../../../src/modules/agents/index.js';
import { createAgent, getAgentContext } from '../../../src/modules/agents/data.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: 'agent-uuid-001',
    name: 'test-worker',
    parent: 'human',
    status: 'abandoned',
    brain_task: 'VNM-18.02',
    claim_token: null,
    branch: 'feat/test-branch',
    worktree_path: '/tmp/worktrees/feat-test-branch',
    ownership: null,
    dod_spec: null,
    pid: null,
    created_at: '2026-03-10T10:00:00.000Z',
    started_at: '2026-03-10T10:01:00.000Z',
    completed_at: null,
    summary: null,
    exit_reason: null,
    context: '{}',
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    session_id: 'sess-abc-001',
    display_id: 'SNS-001',
    project_dir: '/Users/hjewkes/Documents/projects/brain',
    status: 'completed',
    started_at: '2026-03-10T10:01:00.000Z',
    completed_at: '2026-03-10T11:00:00.000Z',
    duration_minutes: 59,
    tool_calls: 42,
    error_count: 2,
    summary: 'Implemented core feature and updated tests.',
    ...overrides,
  };
}

// ─── classifyIdentifier ──────────────────────────────────────────────────────

describe('classifyIdentifier', () => {
  it('classifies PR URL by http prefix', () => {
    expect(classifyIdentifier('https://github.com/org/repo/pull/42')).toBe('pr-url');
    expect(classifyIdentifier('http://github.com/org/repo/pull/1')).toBe('pr-url');
  });

  it('classifies task display_id by PROJECT-N.N pattern', () => {
    expect(classifyIdentifier('VNM-18.02')).toBe('task');
    expect(classifyIdentifier('ABC-1.1')).toBe('task');
  });

  it('classifies branch by presence of slash', () => {
    expect(classifyIdentifier('feat/new-feature')).toBe('branch');
    expect(classifyIdentifier('fix/bug-123')).toBe('branch');
  });

  it('classifies bare string as agent-id', () => {
    expect(classifyIdentifier('550e8400-e29b-41d4-a716-446655440000')).toBe('agent-id');
    expect(classifyIdentifier('some-agent-name')).toBe('agent-id');
  });
});

// ─── buildResumptionPrompt ────────────────────────────────────────────────────

describe('buildResumptionPrompt — full context', () => {
  const agent = makeAgent();
  const sessions = [makeSession()];
  const result = buildResumptionPrompt({
    agent,
    taskTitle: 'Build resume command',
    sessions,
    reason: 'pr-feedback',
    feedback: 'Rename the helper function',
  });

  it('includes agent name in heading', () => {
    expect(result.markdown).toContain('# Agent Resumption: test-worker');
  });

  it('includes reason and feedback', () => {
    expect(result.markdown).toContain('pr-feedback: Rename the helper function');
  });

  it('includes task with title', () => {
    expect(result.markdown).toContain('VNM-18.02 — Build resume command');
  });

  it('includes branch and worktree', () => {
    expect(result.markdown).toContain('feat/test-branch');
    expect(result.markdown).toContain('/tmp/worktrees/feat-test-branch');
  });

  it('includes session stats', () => {
    expect(result.markdown).toContain('Tool calls: 42');
    expect(result.markdown).toContain('Errors: 2');
    expect(result.markdown).toContain('59m');
  });

  it('includes PR feedback directive in what-to-do section', () => {
    expect(result.markdown).toContain('Address the following PR review feedback');
  });

  it('json output contains correct agent fields', () => {
    expect(result.json.agent.id).toBe('agent-uuid-001');
    expect(result.json.agent.task).toBe('VNM-18.02');
    expect(result.json.reason).toBe('pr-feedback');
    expect(result.json.feedback).toBe('Rename the helper function');
    expect(result.json.task_title).toBe('Build resume command');
    expect(result.json.sessions).toHaveLength(1);
    expect(result.json.sessions[0].display_id).toBe('SNS-001');
  });
});

describe('buildResumptionPrompt — minimal context (no session, no task title)', () => {
  const agent = makeAgent({ brain_task: null, branch: null, worktree_path: null });
  const result = buildResumptionPrompt({
    agent,
    sessions: [],
    reason: 'manual',
  });

  it('renders without task or branch', () => {
    expect(result.markdown).toContain('**Task**: unknown');
    expect(result.markdown).toContain('**Branch**: none');
    expect(result.markdown).toContain('**Worktree**: none');
  });

  it('shows no session data message', () => {
    expect(result.markdown).toContain('No session data available.');
  });

  it('manual reason without feedback renders generic directive', () => {
    expect(result.markdown).toContain('Continue the work.');
  });

  it('json sessions array is empty', () => {
    expect(result.json.sessions).toHaveLength(0);
    expect(result.json.task_title).toBeUndefined();
    expect(result.json.feedback).toBeUndefined();
  });
});

describe('buildResumptionPrompt — reason directives', () => {
  it('build-failure includes fix directive', () => {
    const result = buildResumptionPrompt({
      agent: makeAgent(),
      sessions: [],
      reason: 'build-failure',
      feedback: 'Missing export in index.ts',
    });
    expect(result.markdown).toContain('Fix the build failure: Missing export in index.ts');
  });

  it('test-failure includes test fix directive', () => {
    const result = buildResumptionPrompt({
      agent: makeAgent(),
      sessions: [],
      reason: 'test-failure',
      feedback: '3 tests failing in session module',
    });
    expect(result.markdown).toContain('Fix the failing tests: 3 tests failing in session module');
  });

  it('manual with feedback uses continue directive', () => {
    const result = buildResumptionPrompt({
      agent: makeAgent(),
      sessions: [],
      reason: 'manual',
      feedback: 'Focus on the edge cases',
    });
    expect(result.markdown).toContain(
      'Continue with the following context: Focus on the edge cases'
    );
  });
});

describe('buildResumptionPrompt — multiple sessions', () => {
  it('mentions prior session count when more than one', () => {
    const sessions = [
      makeSession({ display_id: 'SNS-003' }),
      makeSession({ display_id: 'SNS-002' }),
      makeSession({ display_id: 'SNS-001' }),
    ];
    const result = buildResumptionPrompt({
      agent: makeAgent(),
      sessions,
      reason: 'manual',
    });
    expect(result.markdown).toContain('2 earlier session(s) on this task');
  });
});

// ─── recordResumption ─────────────────────────────────────────────────────────

function setupAgentDb(): { db: InstanceType<typeof Database>; agentId: string } {
  const registry = new ModuleRegistry();
  registry.registerModule(agentsModule);
  const ctx = createModuleContext(registry, 'agents');
  agentsModule.register(ctx);

  const db = new Database(':memory:');
  const migrations = registry.getMigrations('agents');
  for (const m of migrations) {
    m.migration.up(db);
  }

  const agentId = createAgent(db, { name: 'test-worker', parent: 'human' });
  return { db, agentId };
}

describe('recordResumption', () => {
  let db: InstanceType<typeof Database>;
  let agentId: string;

  beforeEach(() => {
    ({ db, agentId } = setupAgentDb());
  });

  afterEach(() => {
    db.close();
  });

  it('sets resumption_reason on first call', () => {
    recordResumption(db, agentId, 'pr-feedback');
    const reason = getAgentContext(db, agentId, 'resumption_reason');
    expect(reason).toBe('pr-feedback');
  });

  it('increments resumption_count from zero', () => {
    recordResumption(db, agentId, 'manual');
    const count = getAgentContext(db, agentId, 'resumption_count');
    expect(count).toBe(1);
  });

  it('increments resumption_count on each call', () => {
    recordResumption(db, agentId, 'manual');
    recordResumption(db, agentId, 'build-failure');
    recordResumption(db, agentId, 'test-failure');
    const count = getAgentContext(db, agentId, 'resumption_count');
    expect(count).toBe(3);
  });

  it('appends entry to resumption_history on first call', () => {
    recordResumption(db, agentId, 'pr-feedback', 'Fix the typo');
    const history = getAgentContext(db, agentId, 'resumption_history') as ResumptionEntry[];
    expect(history).toHaveLength(1);
    expect(history[0].reason).toBe('pr-feedback');
    expect(history[0].feedback).toBe('Fix the typo');
    expect(history[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('accumulates history across multiple resumptions', () => {
    recordResumption(db, agentId, 'pr-feedback', 'Fix lint');
    recordResumption(db, agentId, 'build-failure');
    recordResumption(db, agentId, 'manual', 'Continue edge cases');

    const history = getAgentContext(db, agentId, 'resumption_history') as ResumptionEntry[];
    expect(history).toHaveLength(3);
    expect(history[0].reason).toBe('pr-feedback');
    expect(history[0].feedback).toBe('Fix lint');
    expect(history[1].reason).toBe('build-failure');
    expect(history[1].feedback).toBeUndefined();
    expect(history[2].reason).toBe('manual');
    expect(history[2].feedback).toBe('Continue edge cases');
  });

  it('updates resumption_reason to the most recent reason', () => {
    recordResumption(db, agentId, 'pr-feedback');
    recordResumption(db, agentId, 'build-failure');
    const reason = getAgentContext(db, agentId, 'resumption_reason');
    expect(reason).toBe('build-failure');
  });

  it('omits feedback from history entry when not provided', () => {
    recordResumption(db, agentId, 'manual');
    const history = getAgentContext(db, agentId, 'resumption_history') as ResumptionEntry[];
    expect(history[0].feedback).toBeUndefined();
  });
});

// ─── extractSessionSummary ────────────────────────────────────────────────────

function buildNotesTable(rawDb: InstanceType<typeof Database>): void {
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT,
      file_path TEXT,
      content TEXT,
      metadata TEXT,
      module TEXT,
      type TEXT,
      tier TEXT,
      created_at TEXT,
      modified_at TEXT,
      file_hash TEXT
    )
  `);
}

function insertSessionNote(
  rawDb: InstanceType<typeof Database>,
  meta: Record<string, unknown>
): void {
  rawDb
    .prepare(
      `INSERT INTO notes (id, title, file_path, content, metadata, module, type, tier, created_at, modified_at)
       VALUES (?, ?, ?, ?, ?, 'sessions', 'session', 'slow', ?, ?)`
    )
    .run(
      randomUUID(),
      `Session ${meta.display_id ?? 'X'}`,
      `/brain/modules/sessions/${meta.display_id ?? 'X'}.md`,
      '',
      JSON.stringify(meta),
      new Date().toISOString(),
      new Date().toISOString()
    );
}

describe('extractSessionSummary', () => {
  let rawDb: InstanceType<typeof Database>;

  beforeEach(() => {
    rawDb = new Database(':memory:');
    buildNotesTable(rawDb);
  });

  afterEach(() => {
    rawDb.close();
  });

  it('returns null when no session note exists', () => {
    const result = extractSessionSummary(rawDb, 'no-such-session');
    expect(result).toBeNull();
  });

  it('extracts basic fields from session note metadata', () => {
    const sessionId = 'sess-test-001';
    insertSessionNote(rawDb, {
      session_id: sessionId,
      display_id: 'SNS-001',
      started_at: '2026-03-10T10:00:00.000Z',
      duration_minutes: 45,
      tool_calls: 30,
      error_count: 1,
    });

    const result = extractSessionSummary(rawDb, sessionId);
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe(sessionId);
    expect(result!.startedAt).toBe('2026-03-10T10:00:00.000Z');
    expect(result!.duration).toBe('45m');
    expect(result!.toolCalls).toBe(30);
    expect(result!.errors).toBe(1);
  });

  it('deduplicates tasks_worked and tasks_completed into tasksReferenced', () => {
    insertSessionNote(rawDb, {
      session_id: 'sess-tasks-001',
      display_id: 'SNS-002',
      started_at: '2026-03-10T10:00:00.000Z',
      tasks_worked: ['VNM-18.01', 'VNM-18.02'],
      tasks_completed: ['VNM-18.01'],
    });

    const result = extractSessionSummary(rawDb, 'sess-tasks-001');
    expect(result!.tasksReferenced).toEqual(['VNM-18.01', 'VNM-18.02']);
  });

  it('returns empty filesModified when notes_created is absent', () => {
    insertSessionNote(rawDb, {
      session_id: 'sess-no-files',
      display_id: 'SNS-003',
      started_at: '2026-03-10T10:00:00.000Z',
    });

    const result = extractSessionSummary(rawDb, 'sess-no-files');
    expect(result!.filesModified).toEqual([]);
    expect(result!.prsCreated).toEqual([]);
  });

  it('populates filesModified from notes_created', () => {
    insertSessionNote(rawDb, {
      session_id: 'sess-files-001',
      display_id: 'SNS-004',
      started_at: '2026-03-10T10:00:00.000Z',
      notes_created: ['note-abc', 'note-def'],
    });

    const result = extractSessionSummary(rawDb, 'sess-files-001');
    expect(result!.filesModified).toEqual(['note-abc', 'note-def']);
  });

  it('extracts keyTools from analyticsExt.top_tools', () => {
    insertSessionNote(rawDb, {
      session_id: 'sess-tools-001',
      display_id: 'SNS-005',
      started_at: '2026-03-10T10:00:00.000Z',
      analyticsExt: {
        top_tools: [
          { name: 'Read', count: 20, error_rate: 0 },
          { name: 'Edit', count: 15, error_rate: 0.1 },
          { name: 'Bash', count: 10, error_rate: 0 },
        ],
      },
    });

    const result = extractSessionSummary(rawDb, 'sess-tools-001');
    expect(result!.keyTools).toEqual(['Read', 'Edit', 'Bash']);
  });

  it('limits keyTools to 5 entries', () => {
    insertSessionNote(rawDb, {
      session_id: 'sess-tools-002',
      display_id: 'SNS-006',
      started_at: '2026-03-10T10:00:00.000Z',
      analyticsExt: {
        top_tools: Array.from({ length: 8 }, (_, i) => ({
          name: `Tool${i}`,
          count: 10 - i,
          error_rate: 0,
        })),
      },
    });

    const result = extractSessionSummary(rawDb, 'sess-tools-002');
    expect(result!.keyTools).toHaveLength(5);
  });

  it('formats duration in hours and minutes', () => {
    insertSessionNote(rawDb, {
      session_id: 'sess-duration-001',
      display_id: 'SNS-007',
      started_at: '2026-03-10T10:00:00.000Z',
      duration_minutes: 90,
    });

    const result = extractSessionSummary(rawDb, 'sess-duration-001');
    expect(result!.duration).toBe('1h 30m');
  });

  it('returns unknown duration when not set', () => {
    insertSessionNote(rawDb, {
      session_id: 'sess-no-duration',
      display_id: 'SNS-008',
      started_at: '2026-03-10T10:00:00.000Z',
    });

    const result = extractSessionSummary(rawDb, 'sess-no-duration');
    expect(result!.duration).toBe('unknown');
  });
});

// ─── findSessionLogPath ───────────────────────────────────────────────────────

describe('findSessionLogPath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `brain-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when base dir does not exist', () => {
    const result = findSessionLogPath('any-session', '/nonexistent-dir/projects');
    expect(result).toBeNull();
  });

  it('returns null when no matching file exists', () => {
    mkdirSync(join(tmpDir, 'proj-a'));
    const result = findSessionLogPath('missing-session-id', tmpDir);
    expect(result).toBeNull();
  });

  it('finds a JSONL file at the top level of a project directory', () => {
    const sessionId = randomUUID();
    const projDir = join(tmpDir, '-Users-hjewkes-Documents-projects-brain');
    mkdirSync(projDir, { recursive: true });
    const expectedPath = join(projDir, `${sessionId}.jsonl`);
    writeFileSync(expectedPath, '{}');

    const result = findSessionLogPath(sessionId, tmpDir);
    expect(result).toBe(expectedPath);
  });

  it('finds a JSONL file in a sessions/ subdirectory', () => {
    const sessionId = randomUUID();
    const projDir = join(tmpDir, '-Users-hjewkes-Documents-projects-brain');
    const sessionsDir = join(projDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const expectedPath = join(sessionsDir, `${sessionId}.jsonl`);
    writeFileSync(expectedPath, '{}');

    const result = findSessionLogPath(sessionId, tmpDir);
    expect(result).toBe(expectedPath);
  });

  it('returns the first matching path when multiple projects are scanned', () => {
    const sessionId = randomUUID();
    // Two project directories — only the second has the file
    mkdirSync(join(tmpDir, 'proj-a'), { recursive: true });
    const projB = join(tmpDir, 'proj-b');
    mkdirSync(projB, { recursive: true });
    const expectedPath = join(projB, `${sessionId}.jsonl`);
    writeFileSync(expectedPath, '{}');

    const result = findSessionLogPath(sessionId, tmpDir);
    expect(result).toBe(expectedPath);
  });
});

// ─── buildResumptionPrompt with sessionSummaries ──────────────────────────────

describe('buildResumptionPrompt — with session summaries', () => {
  const agent = makeAgent();
  const sessions = [makeSession()];
  const sessionSummaries: SessionSummary[] = [
    {
      sessionId: 'sess-abc-001',
      startedAt: '2026-03-10T10:01:00.000Z',
      duration: '59m',
      toolCalls: 42,
      errors: 2,
      filesModified: ['src/modules/agents/resume.ts'],
      prsCreated: ['https://github.com/org/repo/pull/7'],
      tasksReferenced: ['VNM-18.01', 'VNM-18.02'],
      keyTools: ['Read', 'Edit', 'Bash'],
      logPath: '/home/user/.claude/projects/proj/sess-abc-001.jsonl',
    },
  ];

  const result = buildResumptionPrompt({
    agent,
    sessions,
    sessionSummaries,
    reason: 'manual',
  });

  it('includes key tools in tool calls line', () => {
    expect(result.markdown).toContain('Tool calls: 42 (Read, Edit, Bash)');
  });

  it('includes files modified', () => {
    expect(result.markdown).toContain('Files modified: src/modules/agents/resume.ts');
  });

  it('includes PRs created', () => {
    expect(result.markdown).toContain('PRs created: https://github.com/org/repo/pull/7');
  });

  it('includes tasks referenced', () => {
    expect(result.markdown).toContain('Tasks referenced: VNM-18.01, VNM-18.02');
  });

  it('includes session log path', () => {
    expect(result.markdown).toContain(
      'Session log: /home/user/.claude/projects/proj/sess-abc-001.jsonl'
    );
  });
});

describe('buildResumptionPrompt — session summary without log path', () => {
  it('omits session log line when logPath is null', () => {
    const summaries: SessionSummary[] = [
      {
        sessionId: 'sess-no-log',
        startedAt: '2026-03-10T10:00:00.000Z',
        duration: '30m',
        toolCalls: 10,
        errors: 0,
        filesModified: [],
        prsCreated: [],
        tasksReferenced: [],
        keyTools: [],
        logPath: null,
      },
    ];
    const result = buildResumptionPrompt({
      agent: makeAgent(),
      sessions: [makeSession()],
      sessionSummaries: summaries,
      reason: 'manual',
    });
    expect(result.markdown).not.toContain('Session log:');
  });
});
