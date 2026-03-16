import { statSync, readFileSync } from 'node:fs';
import type { BrainDB } from '../services/brain-db.js';
import type { BrainConfig } from '../types.js';
import { listAgents, getAgentContext } from '../modules/agents/data.js';
import { getPmNotes as _getPmNotes } from '../modules/pm/data/queries.js';

export interface AuditNotes {
  total: number;
  byTier: Record<string, number>;
  byType: Record<string, number>;
  byModule: Record<string, number>;
  staleCount: number;
}

export interface AuditMemories {
  total: number;
  active: number;
  forgotten: number;
  byCategory: Record<string, number>;
}

export interface AuditSearch {
  ftsCount: number;
  trigramCount: number;
  vectorCount: number;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
}

export interface AuditStorage {
  dbPath: string;
  dbSizeBytes: number;
  chunkCount: number;
  inboxPending: number;
  inboxTotal: number;
  feedCount: number;
}

export interface AuditTasks {
  total: number;
  byStatus: Record<string, number>;
}

export interface AuditRelations {
  byType: Record<string, number>;
  total: number;
}

export interface AuditReport {
  generatedAt: string;
  schemaVersion: string | null;
  notesDir: string;
  notes: AuditNotes;
  memories: AuditMemories;
  search: AuditSearch;
  storage: AuditStorage;
  tasks: AuditTasks;
  relations: AuditRelations;
}

function collectNotes(db: BrainDB): AuditNotes {
  const notes = db.getAllNotes();
  const byTier: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byModule: Record<string, number> = {};
  let staleCount = 0;
  const now = Date.now();

  for (const n of notes) {
    byTier[n.tier] = (byTier[n.tier] ?? 0) + 1;
    byType[n.type] = (byType[n.type] ?? 0) + 1;
    const mod = n.module ?? 'knowledge';
    byModule[mod] = (byModule[mod] ?? 0) + 1;

    if (n.lastReviewed && n.reviewInterval) {
      const days = parseFloat(n.reviewInterval) || 30;
      const due = new Date(n.lastReviewed).getTime() + days * 86_400_000;
      if (due < now) staleCount++;
    }
  }

  return { total: notes.length, byTier, byType, byModule, staleCount };
}

function collectMemories(db: BrainDB): AuditMemories {
  const all = db.getLatestMemories();
  const total = db.getMemoryCount();
  const byCategory: Record<string, number> = {};

  for (const m of all) {
    const cat = m.category ?? 'uncategorized';
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }

  return {
    total,
    active: all.length,
    forgotten: total - all.length,
    byCategory,
  };
}

function collectSearch(db: BrainDB): AuditSearch {
  const model = db.getEmbeddingModel();
  const tables = db.listTables();
  const hasFts = tables.includes('notes_fts');
  const hasTrigram = tables.includes('notes_fts_trigram');
  const hasVector = tables.includes('chunk_vectors');

  return {
    ftsCount: hasFts ? db.getNoteCount() : 0,
    trigramCount: hasTrigram ? db.getNoteCount() : 0,
    vectorCount: hasVector ? db.getChunkCount() : 0,
    embeddingModel: model?.model ?? null,
    embeddingDimensions: model?.dimensions ?? null,
  };
}

function collectStorage(db: BrainDB, config: BrainConfig): AuditStorage {
  let dbSizeBytes = 0;
  try {
    dbSizeBytes = statSync(config.dbPath).size;
  } catch {
    // DB might be :memory: in tests
  }

  const inboxAll = db.getInboxItems();
  const inboxPending = db.getInboxItems('pending');

  return {
    dbPath: config.dbPath,
    dbSizeBytes,
    chunkCount: db.getChunkCount(),
    inboxPending: inboxPending.length,
    inboxTotal: inboxAll.length,
    feedCount: db.getFeeds().length,
  };
}

function collectTasks(db: BrainDB): AuditTasks {
  const taskNotes = db.getModuleNoteIds({ module: 'pm', type: 'task' });
  const byStatus: Record<string, number> = {};
  const notesMap = db.getNotesByIds(taskNotes);

  for (const [, note] of notesMap) {
    let status = 'unknown';
    if (note.metadata) {
      try {
        const meta = JSON.parse(note.metadata) as Record<string, unknown>;
        status = (meta.status as string) ?? 'unknown';
      } catch {
        /* use default */
      }
    }
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }

  return { total: taskNotes.length, byStatus };
}

function collectRelations(db: BrainDB): AuditRelations {
  const relations = db.getRelationsFiltered({});
  const byType: Record<string, number> = {};

  for (const r of relations) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
  }

  return { byType, total: relations.length };
}

// ---------------------------------------------------------------------------
// Dashboard data — richer data for prototype views
// ---------------------------------------------------------------------------

export interface DashboardTask {
  id: string;
  title: string;
  col: string;
  workstream: string;
  agent: string | null;
  branch: string | null;
  priority: string;
  deps: string[];
  queueAge: number | null;
  pr: { url: string; reviewer: string; reviewStatus: string } | null;
  description?: string;
}

export interface DashboardAgent {
  id: string;
  name: string;
  status: string;
  task: string | null;
  branch: string | null;
  tokensIn: number;
  tokensOut: number;
  toolCalls: number;
  errors: number;
  toolDomains: string[];
}

export interface SessionTimelineEvent {
  timestamp: string;
  toolName: string;
  outcome: 'success' | 'error';
  durationMs?: number;
}

export interface DashboardSession {
  id: string;
  displayId: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  tokensIn: number;
  tokensOut: number;
  toolCalls: number;
  errors: number;
  events?: SessionTimelineEvent[];
  tasksWorked?: string[];
  tasksCompleted?: string[];
  commits?: string[];
  subagentCount?: number;
}

export interface DashboardStageTransition {
  taskId: string;
  fromState: string;
  toState: string;
  agentId: string | null;
  timestamp: string;
}

export interface DashboardData {
  tasks: DashboardTask[];
  agents: DashboardAgent[];
  sessions: DashboardSession[];
  stageHistory: DashboardStageTransition[];
  workstreams: Record<string, { name: string; project: string }>;
}

function readNoteBody(filePath: string): string | undefined {
  try {
    const content = readFileSync(filePath, 'utf-8');
    // Strip YAML frontmatter (between --- delimiters)
    const match = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
    return match ? match[1].trim() : content.trim();
  } catch {
    return undefined;
  }
}

function mapTaskColumn(status: string, deps: string[], doneIds: Set<string>): string {
  if (status === 'done' || status === 'cancelled' || status === 'pruned') return 'done';
  if (status === 'blocked') return 'blocked';
  if (deps.length > 0 && !deps.every((d) => doneIds.has(d))) return 'blocked';
  if (status === 'in-progress') return 'inprogress';
  if (status === 'claimed') return 'inprogress';
  return 'ready';
}

function collectDashboardTasks(db: BrainDB): {
  tasks: DashboardTask[];
  workstreams: Record<string, { name: string; project: string }>;
} {
  const taskNoteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
  if (taskNoteIds.length === 0) return { tasks: [], workstreams: {} };

  const taskNotes = db.getNotesByIds(taskNoteIds);
  const doneIds = new Set<string>();
  const allMeta: Array<{ meta: Record<string, unknown>; filePath: string; noteId: string }> = [];

  // Build noteId → display_id map and collect metadata
  const noteIdToDisplayId = new Map<string, string>();
  for (const [noteId, note] of taskNotes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    const displayId = meta.display_id as string;
    allMeta.push({ meta, filePath: note.filePath, noteId });
    noteIdToDisplayId.set(noteId, displayId);
    if (meta.status === 'done') doneIds.add(displayId);
  }

  // Query depends_on relations from the relations table
  const depRelations = db.getRelationsFiltered({ type: 'depends_on' });
  const depsByNoteId = new Map<string, string[]>();
  for (const rel of depRelations) {
    const targetDisplayId = noteIdToDisplayId.get(rel.targetId);
    if (!targetDisplayId) continue;
    const existing = depsByNoteId.get(rel.sourceId) ?? [];
    existing.push(targetDisplayId);
    depsByNoteId.set(rel.sourceId, existing);
  }

  const now = Date.now();
  const tasks: DashboardTask[] = allMeta.map(({ meta, filePath, noteId }) => {
    const deps = depsByNoteId.get(noteId) ?? [];
    const status = meta.status as string;
    const modified = meta.modified as string | undefined;
    const ageMs = modified ? now - new Date(modified).getTime() : 0;
    const description = readNoteBody(filePath);

    return {
      id: meta.display_id as string,
      title: (meta.title as string) ?? (meta.display_id as string),
      col: mapTaskColumn(status, deps, doneIds),
      workstream:
        (meta.workstream_display_id as string) ??
        `${meta.project}-${String(meta.workstream).padStart(2, '0')}`,
      agent: (meta.claimed_by as string) ?? null,
      branch: (meta.branch as string) ?? null,
      priority: (meta.priority as string) ?? 'medium',
      deps,
      queueAge:
        status === 'pending' && deps.every((d) => doneIds.has(d))
          ? Math.round(ageMs / 60000)
          : null,
      pr: null,
      description,
    };
  });

  const wsNoteIds = db.getModuleNoteIds({ module: 'pm', type: 'workstream' });
  const wsNotes = wsNoteIds.length > 0 ? db.getNotesByIds(wsNoteIds) : new Map();
  const workstreams: Record<string, { name: string; project: string }> = {};
  for (const [, note] of wsNotes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    const wsId = meta.display_id as string;
    workstreams[wsId] = {
      name: (meta.title as string) ?? wsId,
      project: (meta.project as string) ?? '',
    };
  }

  return { tasks, workstreams };
}

function collectDashboardAgents(db: BrainDB): DashboardAgent[] {
  try {
    const rawDb = (db as unknown as { db: unknown }).db;
    const agents = listAgents(rawDb);
    return agents.map((a) => {
      const tokensIn = (getAgentContext(rawDb, a.id, 'tokens_input') as number) ?? 0;
      const tokensOut = (getAgentContext(rawDb, a.id, 'tokens_output') as number) ?? 0;
      const toolCalls = (getAgentContext(rawDb, a.id, 'total_tool_calls') as number) ?? 0;
      const errors = (getAgentContext(rawDb, a.id, 'total_errors') as number) ?? 0;
      const toolDomains = (getAgentContext(rawDb, a.id, 'tool_domains') as string[]) ?? [];

      return {
        id: a.id,
        name: a.name,
        status: a.status,
        task: a.brain_task ?? null,
        branch: a.branch ?? null,
        tokensIn,
        tokensOut,
        toolCalls,
        errors,
        toolDomains,
      };
    });
  } catch {
    return [];
  }
}

const TOOL_LOG_RE =
  /^- (\d{2}:\d{2}:\d{2}) (\w+)(?: ERROR| PENDING)? \((\d+)ms\)(?:\s*\[offset:\d+\])?/;

function parseL2Timeline(
  notesDir: string,
  displayId: string,
  startDate: string
): SessionTimelineEvent[] {
  const timelinePath = `${notesDir}/modules/sessions/${displayId}/l2-timeline.md`;
  let content: string;
  try {
    content = readFileSync(timelinePath, 'utf-8');
  } catch {
    return [];
  }

  const logStart = content.indexOf('## Tool Call Log');
  if (logStart < 0) return [];

  const logSection = content.slice(logStart);
  const nextSection = logSection.indexOf('\n## ', 1);
  const logText = nextSection > 0 ? logSection.slice(0, nextSection) : logSection;

  const datePrefix = startDate.slice(0, 10);
  const events: SessionTimelineEvent[] = [];

  for (const line of logText.split('\n')) {
    const m = TOOL_LOG_RE.exec(line.trim());
    if (!m) continue;
    const isError = line.includes(' ERROR ');
    events.push({
      timestamp: `${datePrefix}T${m[1]}`,
      toolName: m[2],
      outcome: isError ? 'error' : 'success',
      durationMs: parseInt(m[3], 10),
    });
  }

  return events;
}

function collectDashboardSessions(db: BrainDB, notesDir: string): DashboardSession[] {
  const sessionNoteIds = db.getModuleNoteIds({ module: 'sessions', type: 'session' });
  if (sessionNoteIds.length === 0) return [];

  const sessionNotes = db.getNotesByIds(sessionNoteIds);
  const sessions: DashboardSession[] = [];

  for (const [, note] of sessionNotes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    const sessionId = (meta.session_id as string) ?? note.id;
    const displayId = (meta.display_id as string) ?? '';
    const startedAt = (meta.started_at as string) ?? '';
    sessions.push({
      id: sessionId,
      displayId,
      status: (meta.status as string) ?? 'unknown',
      startedAt,
      endedAt: (meta.ended_at as string) ?? null,
      tokensIn: (meta.tokens_input as number) ?? 0,
      tokensOut: (meta.tokens_output as number) ?? 0,
      toolCalls: (meta.tool_calls as number) ?? 0,
      errors: (meta.error_count as number) ?? 0,
      events: parseL2Timeline(notesDir, displayId, startedAt),
    });
  }

  return sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 50);
}

function collectStageHistory(db: BrainDB): DashboardStageTransition[] {
  const activityNoteIds = db.getModuleNoteIds({ module: 'pm', type: 'activity' });
  if (activityNoteIds.length === 0) return [];

  const activityNotes = db.getNotesByIds(activityNoteIds);
  const transitions: DashboardStageTransition[] = [];

  for (const [, note] of activityNotes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (!meta.task_id || !meta.from_state || !meta.to_state) continue;

    transitions.push({
      taskId: meta.task_id as string,
      fromState: meta.from_state as string,
      toState: meta.to_state as string,
      agentId: (meta.agent_id as string) ?? null,
      timestamp: (meta.created as string) ?? '',
    });
  }

  return transitions.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 200);
}

export function collectDashboardData(db: BrainDB, config?: BrainConfig): DashboardData {
  const notesDir = config?.notesDir ?? '';
  const { tasks, workstreams } = collectDashboardTasks(db);
  return {
    tasks,
    agents: collectDashboardAgents(db),
    sessions: collectDashboardSessions(db, notesDir),
    stageHistory: collectStageHistory(db),
    workstreams,
  };
}

export function collectAuditReport(db: BrainDB, config: BrainConfig): AuditReport {
  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: db.getMetaValue('schema_version'),
    notesDir: config.notesDir,
    notes: collectNotes(db),
    memories: collectMemories(db),
    search: collectSearch(db),
    storage: collectStorage(db, config),
    tasks: collectTasks(db),
    relations: collectRelations(db),
  };
}
