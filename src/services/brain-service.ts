import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { loadConfig, resolveInstance } from './config.js';
import type { ResolveOptions, InstancePaths } from './config.js';
import { BrainDB } from './brain-db.js';
import { createEmbedder } from '../adapters/index.js';
import { loadModules, runModuleMigrations } from '../modules/loader.js';
import type { ModuleRegistry } from '../modules/registry.js';
import type { Embedder, BrainConfig, SearchResult } from '../types.js';
import { search as runSearch } from './search.js';
import { collectAuditReport, collectDashboardData } from '../commands/audit.js';
import type { AuditReport, DashboardData, DashboardSession } from '../commands/audit.js';
import { getPmNotes, getEligibleTasks } from '../modules/pm/data/queries.js';
import type { TaskMetadata, ProjectMetadata } from '../modules/pm/types.js';
import { listAgents } from '../modules/agents/data.js';
import type { AgentRecord, AgentStatus } from '../modules/agents/types.js';
import {
  getSession,
  listSessions,
  getSessionsForTask,
} from '../modules/sessions/data/session-ops.js';
import type {
  SessionMetadata,
  SegmentMetadata,
  TokenSnapshot,
  SessionEvent,
} from '../modules/sessions/types.js';
import type {
  ConversationTurn,
  StructuredEventsOutput,
} from '../modules/sessions/ingestion/structured-events.js';
import type { SessionDetailData } from '../dashboard/types.js';
import { loadRegistry } from './instance-registry.js';

export interface DbService {
  db: BrainDB;
  config: BrainConfig;
  instance: InstancePaths;
  close(): void;
}

/** @deprecated Use BrainServiceClass instead. Kept for backward compatibility. */
export interface BrainService {
  db: BrainDB;
  embedder: Embedder;
  config: BrainConfig;
  modules: ModuleRegistry;
  instance: InstancePaths;
  close(): void;
}

export class BrainServiceClass {
  readonly db: BrainDB;
  readonly config: BrainConfig;
  readonly embedder: Embedder;
  readonly registry: ModuleRegistry;
  readonly instance: InstancePaths;
  private _closed = false;

  private constructor(
    db: BrainDB,
    config: BrainConfig,
    embedder: Embedder,
    registry: ModuleRegistry,
    instance: InstancePaths
  ) {
    this.db = db;
    this.config = config;
    this.embedder = embedder;
    this.registry = registry;
    this.instance = instance;
  }

  static async create(opts?: ResolveOptions): Promise<BrainServiceClass> {
    const instance = resolveInstance(opts);
    const config = loadConfig(instance);
    const db = new BrainDB(config.dbPath);
    const embedder = await createEmbedder(config);
    const { registry } = await loadModules();
    // Ensure all module schemas are up to date (CREATE IF NOT EXISTS is idempotent)
    runModuleMigrations(registry, db.rawDb, new Map());
    return new BrainServiceClass(db, config, embedder, registry, instance);
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.db.close();
  }

  get isOpen(): boolean {
    return !this._closed;
  }

  // ---------------------------------------------------------------------------
  // High-level API methods (thin wrappers over existing functions)
  // ---------------------------------------------------------------------------

  async search(
    query: string,
    opts?: { limit?: number; memories?: boolean }
  ): Promise<SearchResult[]> {
    try {
      const { results } = await runSearch(this.db, this.embedder, query, {
        limit: opts?.limit ?? 10,
      });
      return results;
    } catch {
      return [];
    }
  }

  dashboard(): { audit: AuditReport; status: Record<string, unknown>; dashboard: DashboardData } {
    const audit = collectAuditReport(this.db, this.config);
    const dashboard = collectDashboardData(this.db, this.config);
    return { audit, status: {}, dashboard };
  }

  pmStatus(prefix: string): ProjectMetadata | null {
    const notes = getPmNotes(this.db, 'project', { prefix: prefix.toUpperCase() });
    if (notes.length === 0) return null;
    try {
      return JSON.parse(notes[0].metadata!) as ProjectMetadata;
    } catch {
      return null;
    }
  }

  pmNext(prefix?: string): TaskMetadata[] {
    try {
      const resolvedPrefix =
        (prefix?.toUpperCase() ?? getPmNotes(this.db, 'project')[0])
          ? (JSON.parse(getPmNotes(this.db, 'project')[0].metadata!) as ProjectMetadata).prefix
          : null;
      if (!resolvedPrefix) return [];
      const notes = getEligibleTasks(this.db, resolvedPrefix);
      return notes.map((n) => JSON.parse(n.metadata!) as TaskMetadata);
    } catch {
      return [];
    }
  }

  pmTaskList(opts?: { workstream?: string; status?: string }): TaskMetadata[] {
    try {
      const filters: Record<string, unknown> = {};
      if (opts?.status) filters['status'] = opts.status;
      if (opts?.workstream) filters['workstream_display_id'] = opts.workstream;
      const notes = getPmNotes(this.db, 'task', Object.keys(filters).length ? filters : undefined);
      return notes.map((n) => JSON.parse(n.metadata!) as TaskMetadata);
    } catch {
      return [];
    }
  }

  sessionList(opts?: { limit?: number; status?: string }): DashboardSession[] {
    try {
      const all = collectDashboardData(this.db, this.config).sessions;
      const filtered = opts?.status ? all.filter((s) => s.status === opts.status) : all;
      return opts?.limit ? filtered.slice(0, opts.limit) : filtered;
    } catch {
      return [];
    }
  }

  agentList(opts?: { status?: AgentStatus }): AgentRecord[] {
    try {
      const rawDb = (this.db as unknown as { db: unknown }).db;
      return listAgents(rawDb, opts?.status ? { status: opts.status } : undefined);
    } catch {
      return [];
    }
  }

  sessionGet(displayId: string): SessionMetadata | null {
    try {
      return getSession(this.db, displayId);
    } catch {
      return null;
    }
  }

  agentFind(identifier: string): AgentRecord | null {
    try {
      const rawDb = (this.db as unknown as { db: unknown }).db;
      const all = listAgents(rawDb);
      return (
        all.find(
          (a) => a.id === identifier || a.name === identifier || a.brain_task === identifier
        ) ?? null
      );
    } catch {
      return null;
    }
  }

  sessionSegments(displayId: string): SegmentMetadata[] {
    try {
      const noteIds = this.db.getModuleNoteIds({ module: 'sessions', type: 'session-segment' });
      if (noteIds.length === 0) return [];
      const notes = this.db.getNotesByIds(noteIds);
      const results: SegmentMetadata[] = [];
      for (const [, note] of notes) {
        if (!note.metadata) continue;
        const meta = JSON.parse(note.metadata) as Record<string, unknown>;
        if (meta.parent_session === displayId) {
          results.push(meta as unknown as SegmentMetadata);
        }
      }
      return results.sort((a, b) => a.segment_index - b.segment_index);
    } catch {
      return [];
    }
  }

  sessionSegmentGet(
    displayId: string,
    index: number
  ): { metadata: SegmentMetadata; body: string } | null {
    try {
      const noteIds = this.db.getModuleNoteIds({ module: 'sessions', type: 'session-segment' });
      if (noteIds.length === 0) return null;
      const notes = this.db.getNotesByIds(noteIds);
      for (const [, note] of notes) {
        if (!note.metadata) continue;
        const meta = JSON.parse(note.metadata) as Record<string, unknown>;
        if (meta.parent_session === displayId && meta.segment_index === index) {
          const body = existsSync(note.filePath) ? readFileSync(note.filePath, 'utf-8') : '';
          return { metadata: meta as unknown as SegmentMetadata, body };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  sessionsByFile(
    filePath: string
  ): Array<{ displayId: string; startedAt: string; operations: string[] }> {
    try {
      type FileRow = { session_id: string; operations: string };
      const rawDb = (
        this.db as unknown as {
          db: { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } };
        }
      ).db;
      const rows = rawDb
        .prepare('SELECT DISTINCT session_id, operations FROM session_files WHERE file_path = ?')
        .all(filePath) as FileRow[];

      const sessions = listSessions(this.db);
      const sessionMap = new Map(sessions.map((s) => [s.session_id, s]));

      return rows.flatMap((row) => {
        const session = sessionMap.get(row.session_id);
        if (!session) return [];
        return [
          {
            displayId: session.display_id,
            startedAt: session.started_at,
            operations: JSON.parse(row.operations) as string[],
          },
        ];
      });
    } catch {
      return [];
    }
  }

  sessionsByTask(taskId: string): SessionMetadata[] {
    try {
      return getSessionsForTask(this.db, taskId);
    } catch {
      return [];
    }
  }

  sessionFiles(
    displayId: string
  ): Array<{ filePath: string; operations: string[]; lastTouchedAt: string }> {
    try {
      const session = getSession(this.db, displayId);
      if (!session) return [];

      type FileRow = { file_path: string; operations: string; last_touched_at: string };
      const rawDb = (
        this.db as unknown as {
          db: { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } };
        }
      ).db;
      const rows = rawDb
        .prepare(
          'SELECT file_path, operations, last_touched_at FROM session_files WHERE session_id = ? ORDER BY last_touched_at DESC'
        )
        .all(session.session_id) as FileRow[];

      return rows.map((r) => ({
        filePath: r.file_path,
        operations: JSON.parse(r.operations) as string[],
        lastTouchedAt: r.last_touched_at,
      }));
    } catch {
      return [];
    }
  }

  sessionEvents(displayId: string): SessionEvent[] {
    try {
      const session = getSession(this.db, displayId);
      if (!session) return [];
      const rawDb = (
        this.db as unknown as {
          db: { prepare: (sql: string) => { all: (...args: unknown[]) => SessionEvent[] } };
        }
      ).db;
      return rawDb
        .prepare('SELECT * FROM session_events WHERE session_id = ? ORDER BY timestamp ASC')
        .all(session.session_id);
    } catch {
      return [];
    }
  }

  sessionTurns(displayId: string, from?: number, limit?: number): ConversationTurn[] {
    try {
      const filePath = join(
        this.config.notesDir,
        'modules',
        'sessions',
        displayId,
        'structured-events.json'
      );
      if (!existsSync(filePath)) return [];
      const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as StructuredEventsOutput;
      let turns = raw.turns ?? [];
      if (from !== undefined) {
        turns = turns.filter((t) => t.index >= from);
      }
      if (limit !== undefined) {
        turns = turns.slice(0, limit);
      }
      return turns;
    } catch {
      return [];
    }
  }

  sessionTokenTimeline(displayId: string): TokenSnapshot[] {
    try {
      const filePath = join(
        this.config.notesDir,
        'modules',
        'sessions',
        displayId,
        'structured-events.json'
      );
      if (!existsSync(filePath)) return [];
      const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as StructuredEventsOutput;
      return raw.tokenTimeline ?? [];
    } catch {
      return [];
    }
  }

  sessionDetail(displayId: string): SessionDetailData | null {
    try {
      const session = getSession(this.db, displayId);
      if (!session) return null;

      const camelSession = {
        sessionId: session.session_id,
        displayId: session.display_id,
        projectDir: session.project_dir,
        project: session.project ?? null,
        workstream: session.workstream ?? null,
        status: session.status,
        startedAt: session.started_at,
        completedAt: session.completed_at ?? null,
        durationMinutes: session.duration_minutes ?? null,
        branch: session.branch ?? null,
        worktreePath: session.worktree_path ?? null,
        agentModel: session.agent_model ?? null,
        mode: session.mode ?? null,
        compactCount: session.compact_count ?? 0,
        summary: session.summary ?? null,
        totalTurns: session.total_turns ?? 0,
        toolCalls: session.tool_calls ?? 0,
        errorCount: session.error_count ?? 0,
        errorRate: session.error_rate ?? 0,
        tokensInput: session.tokens_input ?? 0,
        tokensOutput: session.tokens_output ?? 0,
        tasksWorked: session.tasks_worked ?? [],
        tasksCompleted: session.tasks_completed ?? [],
        notesCreated: session.notes_created ?? [],
        commits: session.commits ?? [],
        memoriesExtracted: session.memories_extracted ?? 0,
      };

      const eventsPath = join(
        this.config.notesDir,
        'modules',
        'sessions',
        displayId,
        'structured-events.json'
      );

      if (!existsSync(eventsPath)) {
        return {
          session: camelSession,
          turns: [],
          tokenTimeline: [],
          compactions: [],
          taskEvents: [],
          agentEvents: [],
          subagents: [],
          frictionSignals: [],
          totalToolCalls: camelSession.toolCalls,
          totalErrors: camelSession.errorCount,
          errorRate: camelSession.errorRate,
        };
      }

      const events = JSON.parse(readFileSync(eventsPath, 'utf-8')) as StructuredEventsOutput;

      const totalToolCalls = events.turns.reduce((sum, t) => sum + t.toolCalls.length, 0);
      const totalErrors = events.turns.reduce(
        (sum, t) => sum + t.toolCalls.filter((tc) => tc.outcome === 'error').length,
        0
      );

      return {
        session: camelSession,
        turns: events.turns.map((t) => ({
          index: t.index,
          userMessage: t.userText ?? '',
          assistantResponse: t.assistantText ?? '',
          toolCalls: t.toolCalls.map((tc, i) => ({
            id: tc.id || `${tc.toolName}-${t.timestamp}-${i}`,
            timestamp: t.timestamp,
            toolName: tc.toolName,
            inputSummary: tc.inputSummary ?? '',
            outcome: tc.outcome,
            errorMessage: tc.errorMessage ?? null,
            durationMs: tc.durationMs ?? null,
            byteOffset: tc.byteOffset ?? null,
            agentId: tc.agentId ?? null,
          })),
          timestamp: t.timestamp,
          tokenUsage: null,
        })),
        tokenTimeline: events.tokenTimeline.map((ts) => ({
          timestamp: ts.timestamp,
          cumulativeInput: ts.cumulativeInput,
          cumulativeOutput: ts.cumulativeOutput,
          messageInput: 0,
          messageOutput: 0,
          isCompaction: false,
        })),
        compactions: events.compactions.map((c) => ({
          timestamp: c.timestamp,
          turnIndex: c.index,
          tokensBefore: 0,
          tokensAfter: 0,
          summaryPreview: '',
        })),
        taskEvents: events.taskEvents.map((te) => ({
          taskId: te.taskId,
          action:
            te.type === 'task_claim'
              ? ('started' as const)
              : te.type === 'task_done'
                ? ('completed' as const)
                : ('added' as const),
          timestamp: te.timestamp,
          detail: null,
        })),
        agentEvents: events.agentEvents.map((ae) => ({
          agentId: ae.detail,
          action: ae.type === 'agent_spawn' ? ('spawned' as const) : ('completed' as const),
          timestamp: ae.timestamp,
          taskId: null,
          model: null,
        })),
        subagents: [],
        frictionSignals: [],
        totalToolCalls,
        totalErrors,
        errorRate: totalToolCalls > 0 ? totalErrors / totalToolCalls : 0,
      };
    } catch {
      return null;
    }
  }

  async attachFederatedInstances(): Promise<string[]> {
    const globalDir = join(homedir(), '.brain');
    const registry = loadRegistry(globalDir);
    const attached: string[] = [];

    for (const instance of registry.instances) {
      if (instance.path === this.instance.root) continue; // skip self
      try {
        const dbPath = join(instance.path, 'brain.db');
        if (!existsSync(dbPath)) continue;
        const rawDb = (this.db as unknown as { db: Database.Database }).db;
        rawDb.exec(`ATTACH DATABASE '${dbPath}' AS "${instance.name}"`);
        attached.push(instance.name);
      } catch {
        // Non-fatal: instance may be locked or corrupt
      }
    }
    return attached;
  }

  federatedSearch(
    query: string,
    opts?: { limit?: number }
  ): Array<SearchResult & { instance: string }> {
    const limit = opts?.limit ?? 10;
    const rawDb = (this.db as unknown as { db: Database.Database }).db;

    // Collect attached schema names via PRAGMA database_list
    const dbList = rawDb.prepare('PRAGMA database_list').all() as Array<{
      seq: number;
      name: string;
      file: string;
    }>;
    const schemas = dbList.map((r) => r.name).filter((n) => n !== 'main' && n !== 'temp');

    const results: Array<SearchResult & { instance: string }> = [];
    for (const schema of schemas) {
      try {
        const rows = rawDb
          .prepare(
            `SELECT n.id, n.file_path, n.title, n.tier, n.tags, n.type
           FROM "${schema}".notes n
           JOIN "${schema}".notes_fts f ON f.note_id = n.id
           WHERE notes_fts MATCH ?
           LIMIT ?`
          )
          .all(query, limit) as Array<{
          id: string;
          file_path: string;
          title: string | null;
          tier: string;
          tags: string | null;
          type: string;
        }>;

        for (const row of rows) {
          results.push({
            score: 1,
            filePath: row.file_path,
            noteId: row.id,
            heading: row.title ?? null,
            excerpt: '',
            tier: row.tier as SearchResult['tier'],
            tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
            confidence: null,
            matchSource: 'bm25',
            instance: schema,
          });
        }
      } catch {
        // Schema may not have notes_fts or notes table — skip
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}

// ---------------------------------------------------------------------------
// Singleton / keep-alive factory for long-running processes (MCP server, etc.)
// ---------------------------------------------------------------------------

let _instance: BrainServiceClass | null = null;

export async function getSharedInstance(opts?: ResolveOptions): Promise<BrainServiceClass> {
  if (_instance && _instance.isOpen) return _instance;
  _instance = await BrainServiceClass.create(opts);
  return _instance;
}

export function closeSharedInstance(): void {
  if (_instance) {
    _instance.close();
    _instance = null;
  }
}

export async function withBrain<T>(
  fn: (svc: BrainService) => T | Promise<T>,
  resolveOpts?: ResolveOptions
): Promise<T> {
  const service = await BrainServiceClass.create(resolveOpts);
  const svc: BrainService = {
    db: service.db,
    embedder: service.embedder,
    config: service.config,
    modules: service.registry,
    instance: service.instance,
    close() {
      service.close();
    },
  };
  try {
    return await fn(svc);
  } finally {
    service.close();
  }
}

export async function withDb<T>(
  fn: (svc: DbService) => T | Promise<T>,
  resolveOpts?: ResolveOptions
): Promise<T> {
  const instance = resolveInstance(resolveOpts);
  const config = loadConfig(instance);
  const db = new BrainDB(config.dbPath);
  const svc: DbService = {
    db,
    config,
    instance,
    close() {
      db.close();
    },
  };
  try {
    return await fn(svc);
  } finally {
    svc.close();
  }
}
