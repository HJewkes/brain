import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolveInstance, loadConfig } from '../../services/config.js';
import {
  getAgent,
  updateAgentStatus,
  releaseWorktree as dbReleaseWorktree,
  getAgentContext,
  setAgentContext,
} from './data.js';
import type { AgentRecord } from './types.js';

/**
 * Open a writable DB connection for hook context.
 * Returns null if the DB file does not exist.
 */
function openDb(cwd: string): Database.Database | null {
  try {
    const instance = resolveInstance({ cwd });
    const config = loadConfig(instance);
    if (!existsSync(config.dbPath)) return null;
    return new Database(config.dbPath);
  } catch {
    return null;
  }
}

/**
 * Release worktree allocation in DB for the agent's task.
 * Physical worktree removal is left to cleanup — we only clear the DB record
 * to avoid git operations in a hook that must not fail.
 */
function tryReleaseWorktree(db: Database.Database, agent: AgentRecord): void {
  if (!agent.brain_task) return;
  try {
    dbReleaseWorktree(db, agent.brain_task);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[agent-done] worktree release failed for task ${agent.brain_task}: ${msg}\n`
    );
  }
}

/**
 * Mark the PM task as done by shelling out to the CLI.
 * Returns the number of newly eligible tasks surfaced in stderr output, or 0.
 */
function tryUpdatePmTask(taskId: string, cwd: string): number {
  try {
    const output = execFileSync('node', [process.argv[1], 'pm', 'task', 'status', taskId, 'done'], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5000,
    });
    const stderrText = typeof output === 'string' ? output : '';
    const match = stderrText.match(/Newly eligible: (.+)/);
    if (match) {
      const ids = match[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return ids.length;
    }
    return 0;
  } catch (err) {
    // Capture stderr from execFileSync errors
    const stderrText = (err as { stderr?: string }).stderr ?? '';
    const match = stderrText.match(/Newly eligible: (.+)/);
    if (match) {
      const ids = match[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return ids.length;
    }
    return 0;
  }
}

/**
 * Fire session commit as a non-blocking side effect.
 */
function trySessionCommit(cwd: string): void {
  try {
    execFileSync('node', [process.argv[1], 'session', 'commit'], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5000,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[agent-done] session commit failed: ${msg}\n`);
  }
}

export interface AgentDoneInput {
  agent_id?: string;
  exit_code?: number;
  summary?: string;
}

export interface AgentDoneResult {
  agentId: string | null;
  status: 'completed' | 'failed';
  updated: boolean;
  worktreeReleased: boolean;
  taskUpdated: boolean;
  cascadeCount: number;
}

/**
 * Core agent-done logic, extracted for testability.
 * Accepts a DB instance directly so tests can pass an in-memory DB.
 */
export function handleAgentDone(
  db: Database.Database,
  agentId: string,
  parsed: AgentDoneInput,
  cwd: string
): AgentDoneResult {
  const exitCode = parsed.exit_code ?? 0;
  const status = exitCode === 0 ? 'completed' : 'failed';
  const summary = parsed.summary;

  const result: AgentDoneResult = {
    agentId,
    status,
    updated: false,
    worktreeReleased: false,
    taskUpdated: false,
    cascadeCount: 0,
  };

  const agent = getAgent(db, agentId);
  if (!agent || agent.status !== 'active') {
    return result;
  }

  // Mark agent completed/failed
  updateAgentStatus(db, agentId, status, {
    summary,
    exit_reason: status === 'failed' ? `exit_code=${exitCode}` : undefined,
  });
  result.updated = true;

  // Release worktree allocation (DB record only)
  if (agent.brain_task) {
    tryReleaseWorktree(db, agent);
    result.worktreeReleased = true;
  }

  // Update PM task status
  if (agent.brain_task && status === 'completed') {
    const cascadeCount = tryUpdatePmTask(agent.brain_task, cwd);
    result.taskUpdated = true;
    result.cascadeCount = cascadeCount;
    if (cascadeCount > 0) {
      process.stderr.write(
        `Post-merge cascade: ${cascadeCount} task${cascadeCount !== 1 ? 's' : ''} unblocked\n`
      );
    }
  }

  // Verify observability linkage before aggregation
  const sessionId = getAgentContext(db, agentId, 'session_id') as string | undefined;
  if (!sessionId) {
    process.stderr.write(
      `[agent-done] Agent ${agentId} has no session_id — token/artifact tracking will be empty\n`
    );
  }

  // Snapshot session token totals into agent context
  trySnapshotSessionTokens(db, agentId);

  // Compute tool domains from session events
  tryComputeToolDomains(db, agentId);

  // Extract artifact summary from session events
  tryExtractArtifacts(db, agentId);

  // Session commit (fire-and-forget)
  trySessionCommit(cwd);

  return result;
}

// ---------------------------------------------------------------------------
// Tool domain classification
// ---------------------------------------------------------------------------

export const DOMAIN_PATTERNS: Array<{
  domain: string;
  test: (toolName: string, command?: string) => boolean;
}> = [
  { domain: 'read', test: (t) => ['Read', 'Glob', 'Grep', 'Cat', 'Head', 'Tail'].includes(t) },
  { domain: 'write', test: (t) => ['Write', 'Edit', 'NotebookEdit'].includes(t) },
  {
    domain: 'search',
    test: (t) => ['WebSearch', 'WebFetch'].includes(t) || t.toLowerCase().includes('search'),
  },
  {
    domain: 'browser',
    test: (t) =>
      t.startsWith('mcp__claude-in-chrome__') ||
      t.startsWith('mcp__plugin_playwright_playwright__browser_'),
  },
  {
    domain: 'agent',
    test: (t) => ['Agent', 'TeamCreate', 'TeamDelete', 'SendMessage'].includes(t),
  },
  {
    domain: 'test',
    test: (t, cmd) => t === 'Bash' && !!cmd && /\b(vitest|jest|pytest|test)\b/i.test(cmd),
  },
  { domain: 'git', test: (t, cmd) => t === 'Bash' && !!cmd && /\bgit\s/.test(cmd) },
  { domain: 'bash', test: (t) => t === 'Bash' },
];

export function classifyToolDomain(toolName: string, command?: string): string | null {
  for (const { domain, test } of DOMAIN_PATTERNS) {
    if (test(toolName, command)) return domain;
  }
  return null;
}

function trySnapshotSessionTokens(db: Database.Database, agentId: string): void {
  try {
    const sessions = (getAgentContext(db, agentId, 'sessions') as string[] | undefined) ?? [];
    if (sessions.length === 0) return;

    const placeholders = sessions.map(() => '?').join(',');
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(json_extract(n.metadata, '$.tokens_input')), 0) as tokens_in,
           COALESCE(SUM(json_extract(n.metadata, '$.tokens_output')), 0) as tokens_out,
           COALESCE(SUM(json_extract(n.metadata, '$.tool_calls')), 0) as tools,
           COALESCE(SUM(json_extract(n.metadata, '$.error_count')), 0) as errors
         FROM notes n
         WHERE n.module = 'sessions'
           AND json_extract(n.metadata, '$.session_id') IN (${placeholders})`
      )
      .get(...sessions) as
      | { tokens_in: number; tokens_out: number; tools: number; errors: number }
      | undefined;

    if (row) {
      setAgentContext(db, agentId, 'tokens_input', row.tokens_in);
      setAgentContext(db, agentId, 'tokens_output', row.tokens_out);
      setAgentContext(db, agentId, 'total_tool_calls', row.tools);
      setAgentContext(db, agentId, 'total_errors', row.errors);
    }
  } catch {
    // Non-fatal
  }
}

function tryComputeToolDomains(db: Database.Database, agentId: string): void {
  try {
    const sessions = (getAgentContext(db, agentId, 'sessions') as string[] | undefined) ?? [];
    if (sessions.length === 0) return;

    const placeholders = sessions.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT DISTINCT
           json_extract(n.metadata, '$.tool_name') as tool,
           json_extract(n.metadata, '$.command') as command
         FROM notes n
         WHERE n.module = 'sessions'
           AND json_extract(n.metadata, '$.event_type') = 'tool_call'
           AND json_extract(n.metadata, '$.session_id') IN (${placeholders})`
      )
      .all(...sessions) as Array<{ tool: string; command?: string }>;

    const domains = new Set<string>();
    for (const row of rows) {
      const domain = classifyToolDomain(row.tool, row.command);
      if (domain) domains.add(domain);
    }

    if (domains.size > 0) {
      setAgentContext(db, agentId, 'tool_domains', Array.from(domains));
    }
  } catch {
    // Non-fatal
  }
}

// ---------------------------------------------------------------------------
// Artifact extraction
// ---------------------------------------------------------------------------

export interface AgentArtifacts {
  filesCreated: string[];
  filesModified: string[];
  testsAdded: string[];
  prsCreated: string[];
  notesCreated: string[];
  commandsUsed: string[];
}

function isTestFile(path: string): boolean {
  return path.includes('__tests__/') || path.endsWith('.test.ts') || path.endsWith('.test.js');
}

export function tryExtractArtifacts(db: Database.Database, agentId: string): void {
  try {
    const sessions = (getAgentContext(db, agentId, 'sessions') as string[] | undefined) ?? [];
    if (sessions.length === 0) return;

    const placeholders = sessions.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT
           json_extract(n.metadata, '$.tool_name') as tool,
           json_extract(n.metadata, '$.file_path') as file_path,
           json_extract(n.metadata, '$.pr_url') as pr_url,
           json_extract(n.metadata, '$.note_path') as note_path
         FROM notes n
         WHERE n.module = 'sessions'
           AND json_extract(n.metadata, '$.event_type') = 'tool_call'
           AND json_extract(n.metadata, '$.session_id') IN (${placeholders})`
      )
      .all(...sessions) as Array<{
      tool: string;
      file_path?: string;
      pr_url?: string;
      note_path?: string;
    }>;

    const artifacts: AgentArtifacts = {
      filesCreated: [],
      filesModified: [],
      testsAdded: [],
      prsCreated: [],
      notesCreated: [],
      commandsUsed: [],
    };

    const seenTools = new Set<string>();
    for (const row of rows) {
      if (row.tool) seenTools.add(row.tool);

      if (row.file_path) {
        if (isTestFile(row.file_path)) {
          if (!artifacts.testsAdded.includes(row.file_path)) {
            artifacts.testsAdded.push(row.file_path);
          }
        } else if (row.tool === 'Write') {
          if (!artifacts.filesCreated.includes(row.file_path)) {
            artifacts.filesCreated.push(row.file_path);
          }
        } else if (row.tool === 'Edit' || row.tool === 'NotebookEdit') {
          if (!artifacts.filesModified.includes(row.file_path)) {
            artifacts.filesModified.push(row.file_path);
          }
        }
      }

      if (row.pr_url && !artifacts.prsCreated.includes(row.pr_url)) {
        artifacts.prsCreated.push(row.pr_url);
      }

      if (row.note_path && !artifacts.notesCreated.includes(row.note_path)) {
        artifacts.notesCreated.push(row.note_path);
      }
    }

    artifacts.commandsUsed = Array.from(seenTools);
    setAgentContext(db, agentId, 'artifacts', artifacts);
  } catch {
    // Non-fatal
  }
}

/**
 * Hook entry point — opens its own DB connection, delegates to handleAgentDone,
 * and returns a summary string. Never throws.
 */
export function runAgentDoneHook(
  parsed: AgentDoneInput,
  cwd: string
): { status: 'completed' | 'failed'; agentId: string | null; message: string } {
  const agentId = (parsed.agent_id as string | undefined) ?? process.env.BRAIN_AGENT_ID ?? null;

  if (!agentId) {
    return { status: 'completed', agentId: null, message: 'No agent ID available' };
  }

  let db: Database.Database | null = null;
  try {
    db = openDb(cwd);
    if (!db) {
      return { status: 'completed', agentId, message: 'DB not available' };
    }

    const result = handleAgentDone(db, agentId, parsed, cwd);
    const parts = [`agent=${agentId}`, `status=${result.status}`];
    if (result.updated) parts.push('db-updated');
    if (result.worktreeReleased) parts.push('worktree-released');
    if (result.taskUpdated) parts.push('task-updated');
    if (result.cascadeCount > 0) parts.push(`cascade=${result.cascadeCount}`);

    return { status: result.status, agentId, message: parts.join(', ') };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[agent-done] handler error for ${agentId}: ${msg}\n`);
    return { status: 'failed', agentId, message: `handler error: ${msg}` };
  } finally {
    db?.close();
  }
}
