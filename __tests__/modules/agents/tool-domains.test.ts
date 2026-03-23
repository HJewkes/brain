import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  handleAgentDone,
  classifyToolDomain,
} from '../../../src/modules/agents/agent-done-handler.js';
import {
  createAgent,
  updateAgentStatus,
  setAgentContext,
  getAgentContext,
} from '../../../src/modules/agents/data.js';
import { agentsMigrationV1, agentsMigrationV2 } from '../../../src/modules/agents/schema.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  agentsMigrationV1.up(db);
  agentsMigrationV2.up(db);
  // Minimal notes table — tryComputeToolDomains queries notes with module='sessions'
  (db as unknown as { exec(sql: string): void }).exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id              TEXT PRIMARY KEY,
      file_path       TEXT NOT NULL UNIQUE,
      title           TEXT NOT NULL,
      type            TEXT NOT NULL,
      tier            TEXT NOT NULL,
      category        TEXT,
      tags            TEXT,
      summary         TEXT,
      confidence      TEXT,
      status          TEXT DEFAULT 'current',
      sources         TEXT,
      created_at      TEXT,
      modified_at     TEXT,
      last_reviewed   TEXT,
      review_interval TEXT,
      expires         TEXT,
      metadata        TEXT,
      module          TEXT,
      module_instance TEXT,
      content_dir     TEXT,
      l0_abstract     TEXT,
      l1_overview     TEXT
    )
  `);
  return db;
}

let noteCounter = 0;

function insertEvent(
  db: Database.Database,
  sessionId: string,
  toolName: string,
  command?: string
): void {
  noteCounter++;
  const noteId = `evt-${sessionId}-${toolName}-${noteCounter}`;
  const metadata = JSON.stringify({
    event_type: 'tool_call',
    session_id: sessionId,
    tool_name: toolName,
    ...(command ? { command } : {}),
  });
  db.prepare(
    `INSERT OR IGNORE INTO notes (id, file_path, title, type, tier, metadata, module, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    noteId,
    `/tmp/${noteId}.md`,
    toolName,
    'event',
    'fast',
    metadata,
    'sessions',
    new Date().toISOString()
  );
}

// ── classifyToolDomain unit tests ──────────────────────────────────────────────

describe('classifyToolDomain', () => {
  it('classifies Read as "read"', () => {
    expect(classifyToolDomain('Read')).toBe('read');
  });

  it('classifies Glob, Grep, Cat, Head, Tail as "read"', () => {
    for (const tool of ['Glob', 'Grep', 'Cat', 'Head', 'Tail']) {
      expect(classifyToolDomain(tool)).toBe('read');
    }
  });

  it('classifies Write, Edit, NotebookEdit as "write"', () => {
    for (const tool of ['Write', 'Edit', 'NotebookEdit']) {
      expect(classifyToolDomain(tool)).toBe('write');
    }
  });

  it('classifies bare Bash as "bash"', () => {
    expect(classifyToolDomain('Bash')).toBe('bash');
  });

  it('classifies WebSearch as "search"', () => {
    expect(classifyToolDomain('WebSearch')).toBe('search');
  });

  it('classifies WebFetch as "search"', () => {
    expect(classifyToolDomain('WebFetch')).toBe('search');
  });

  it('classifies tools containing "search" as "search"', () => {
    expect(classifyToolDomain('mcp__custom__searchDocs')).toBe('search');
  });

  it('classifies mcp__claude-in-chrome__ tools as "browser"', () => {
    expect(classifyToolDomain('mcp__claude-in-chrome__navigate')).toBe('browser');
  });

  it('classifies mcp__plugin_playwright_playwright__browser_ tools as "browser"', () => {
    expect(classifyToolDomain('mcp__plugin_playwright_playwright__browser_click')).toBe('browser');
  });

  it('classifies Agent, TeamCreate, SendMessage as "agent"', () => {
    for (const tool of ['Agent', 'TeamCreate', 'SendMessage']) {
      expect(classifyToolDomain(tool)).toBe('agent');
    }
  });

  it('classifies Bash with test command as "test"', () => {
    expect(classifyToolDomain('Bash', 'npx vitest run')).toBe('test');
    expect(classifyToolDomain('Bash', 'npm test')).toBe('test');
    expect(classifyToolDomain('Bash', 'pytest src/')).toBe('test');
    expect(classifyToolDomain('Bash', 'npx jest --watch')).toBe('test');
  });

  it('classifies Bash with git command as "git"', () => {
    expect(classifyToolDomain('Bash', 'git status')).toBe('git');
    expect(classifyToolDomain('Bash', 'git commit -m "fix"')).toBe('git');
  });

  it('returns null for unknown tools', () => {
    expect(classifyToolDomain('UnknownTool')).toBeNull();
    expect(classifyToolDomain('mcp__custom__widget')).toBeNull();
  });

  it('returns null for an empty tool name', () => {
    expect(classifyToolDomain('')).toBeNull();
  });

  it('multiple tools in the same domain each map to that domain', () => {
    expect(classifyToolDomain('Read')).toBe('read');
    expect(classifyToolDomain('Grep')).toBe('read');
    expect(classifyToolDomain('Glob')).toBe('read');
  });
});

// ── handleAgentDone integration: tool_domains stored in context ────────────────

describe('handleAgentDone — tool_domains', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('stores tool_domains from session events in agent context', () => {
    const sessionId = 'test-session-001';
    const agentId = createAgent(db, { name: 'worker', parent: 'orch' });
    updateAgentStatus(db, agentId, 'active');
    setAgentContext(db, agentId, 'sessions', [sessionId]);

    insertEvent(db, sessionId, 'Read');
    insertEvent(db, sessionId, 'Bash', 'git status');
    insertEvent(db, sessionId, 'Write');

    handleAgentDone(db, agentId, { exit_code: 0 }, '/tmp');

    const domains = getAgentContext(db, agentId, 'tool_domains') as string[];
    expect(domains).toBeDefined();
    expect(domains).toContain('read');
    expect(domains).toContain('write');
    expect(domains).toContain('git');
  });

  it('deduplicates domains when multiple tools map to the same domain', () => {
    const sessionId = 'test-session-002';
    const agentId = createAgent(db, { name: 'worker', parent: 'orch' });
    updateAgentStatus(db, agentId, 'active');
    setAgentContext(db, agentId, 'sessions', [sessionId]);

    // Read, Grep, Glob all → "read"
    insertEvent(db, sessionId, 'Read');
    insertEvent(db, sessionId, 'Grep');
    insertEvent(db, sessionId, 'Glob');

    handleAgentDone(db, agentId, { exit_code: 0 }, '/tmp');

    const domains = getAgentContext(db, agentId, 'tool_domains') as string[];
    expect(domains.filter((d) => d === 'read').length).toBe(1);
  });

  it('stores empty array when no sessions are linked', () => {
    const agentId = createAgent(db, { name: 'worker', parent: 'orch' });
    updateAgentStatus(db, agentId, 'active');

    handleAgentDone(db, agentId, { exit_code: 0 }, '/tmp');

    // No tool_domains set when there are no linked sessions
    const domains = getAgentContext(db, agentId, 'tool_domains');
    expect(domains).toBeUndefined();
  });

  it('handles unknown tool names gracefully — omits them from domains', () => {
    const sessionId = 'test-session-003';
    const agentId = createAgent(db, { name: 'worker', parent: 'orch' });
    updateAgentStatus(db, agentId, 'active');
    setAgentContext(db, agentId, 'sessions', [sessionId]);

    insertEvent(db, sessionId, 'SomeUnknownTool');
    insertEvent(db, sessionId, 'Read');

    handleAgentDone(db, agentId, { exit_code: 0 }, '/tmp');

    const domains = getAgentContext(db, agentId, 'tool_domains') as string[];
    expect(domains).toContain('read');
    // Unknown tool should not produce a domain entry
    expect(domains.includes('SomeUnknownTool')).toBe(false);
  });

  it('aggregates tool events across multiple sessions', () => {
    const session1 = 'multi-session-001';
    const session2 = 'multi-session-002';
    const agentId = createAgent(db, { name: 'worker', parent: 'orch' });
    updateAgentStatus(db, agentId, 'active');
    setAgentContext(db, agentId, 'sessions', [session1, session2]);

    insertEvent(db, session1, 'Bash', 'npx vitest run');
    insertEvent(db, session2, 'WebSearch');

    handleAgentDone(db, agentId, { exit_code: 0 }, '/tmp');

    const domains = getAgentContext(db, agentId, 'tool_domains') as string[];
    expect(domains).toContain('test');
    expect(domains).toContain('search');
  });
});
