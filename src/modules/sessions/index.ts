import { Command } from '@commander-js/extra-typings';
import type { BrainModule, ModuleNoteType } from '../types.js';
import { SessionContentHandler } from './content-handler.js';
import { createSessionListCommand } from './commands/list.js';
import { createSessionShowCommand } from './commands/show.js';
import { createSessionIngestCommand } from './commands/ingest.js';
import { createSessionResumeCommand } from './commands/resume.js';
import { createSessionAnalyticsCommand } from './commands/analytics.js';
import { createSessionSnapshotCommand } from './commands/snapshot.js';
import { createSessionCommitCommand } from './commands/session-commit.js';
import { createSessionRestoreCommand } from './commands/restore.js';
import { createSessionStatsCommand } from './commands/stats.js';
import { createSessionBriefingCommand } from './commands/briefing.js';
import { sessionRestoreHandler } from './hooks/session-restore-handler.js';
import { sessionBriefingHandler } from './hooks/session-briefing-handler.js';
import { sessionCaptureHandler } from './hooks/session-capture-handler.js';
import { sessionStartHandler } from './hooks/session-start-handler.js';
import { sessionCompactHandler } from './hooks/session-compact-handler.js';
import { sessionEndHandler } from './hooks/session-end-handler.js';
import { sessionCommitHandler } from './hooks/session-commit-handler.js';
import { sessionPreCompactHandler } from './hooks/session-pre-compact-handler.js';

const SESSION_NOTE_TYPE: ModuleNoteType = {
  name: 'session',
  description: 'A recorded Claude coding session with analytics and linked entities',
  tier: 'slow',
  schema: {
    type: 'object',
    properties: {
      session_id: { type: 'string', description: 'Claude session UUID' },
      display_id: { type: 'string', description: 'Human-readable ID, e.g., SNS-001' },
      project_dir: { type: 'string', description: 'Absolute working directory path' },
      project: { type: 'string', description: 'PM project prefix' },
      workstream: { type: 'string', description: 'PM workstream display_id' },
      branch: { type: 'string', description: 'Git branch active during session' },
      worktree_path: { type: 'string', description: 'Worktree path if isolated' },
      status: {
        type: 'string',
        enum: ['active', 'completed', 'paused', 'abandoned'],
        description: 'Session lifecycle status',
      },
      started_at: { type: 'string', description: 'ISO 8601 session start time' },
      completed_at: { type: 'string', description: 'ISO 8601 session end time' },
      duration_minutes: { type: 'number', description: 'Wall-clock duration in minutes' },
      agent_model: { type: 'string', description: 'Model ID' },
      mode: { type: 'string', description: 'Execution mode: auto, plan, etc.' },
      compact_count: { type: 'number', description: 'Number of context compactions' },
      summary: { type: 'string', description: 'L0 one-liner ~100 tokens' },
      micro_summary_count: {
        type: 'number',
        description: 'PreCompact micro-summaries captured',
      },
      last_captured_at: {
        type: 'string',
        description: 'Most recent hook capture timestamp',
      },
      total_turns: { type: 'number', description: 'Total conversation turns' },
      tool_calls: { type: 'number', description: 'Total tool invocations' },
      error_count: { type: 'number', description: 'Total tool errors' },
      error_rate: { type: 'number', description: 'error_count / tool_calls' },
      tokens_input: { type: 'number', description: 'Cumulative input tokens' },
      tokens_output: { type: 'number', description: 'Cumulative output tokens' },
      tasks_worked: { type: 'array', description: 'PM task display_ids worked on' },
      tasks_completed: { type: 'array', description: 'PM task display_ids completed' },
      notes_created: { type: 'array', description: 'Note IDs created during session' },
      commits: { type: 'array', description: 'Git commit SHAs' },
      memories_extracted: { type: 'number', description: 'Memories extracted post-session' },
      plan_id: { type: 'string', description: 'Agent orchestration plan ID' },
      segment_count: { type: 'number', description: 'Number of segments in this session' },
      jsonl_path: { type: 'string', description: 'Absolute path to the source JSONL file' },
      jsonl_size_bytes: { type: 'number', description: 'JSONL file size at ingest time' },
      session_type: {
        type: 'string',
        enum: ['solo', 'coordinated', 'agent'],
        description: 'Session execution type',
      },
      outcome: {
        type: 'string',
        enum: ['success', 'partial', 'abandoned', 'unknown'],
        description: 'Session outcome classification',
      },
      cost_usd: { type: 'number', description: 'Estimated API cost in USD' },
      pr_links: { type: 'array', description: 'Pull request URLs opened during session' },
      instance_id: { type: 'string', description: 'Brain instance identifier' },
      files_written: { type: 'array', description: 'File paths written during session' },
    },
    required: ['session_id', 'status', 'started_at'],
  },
  directorySchema: {
    description: 'Session content directory for L1/L2 detail files',
    files: [
      { pattern: 'l1-overview.md', description: 'L1 structured summary (~2K tokens)' },
      { pattern: 'l2-timeline.md', description: 'L2 full event timeline and tool log' },
      {
        pattern: 'observations.md',
        description: 'Workflow-improvement observations linked to this session',
      },
    ],
  },
};

const SESSION_SEGMENT_NOTE_TYPE: ModuleNoteType = {
  name: 'session-segment',
  description: 'A bounded segment within a session, split at context compaction boundaries',
  tier: 'slow',
  schema: {
    type: 'object',
    properties: {
      segment_index: { type: 'number', description: 'Segment index within parent session' },
      parent_session: { type: 'string', description: 'Parent session display_id' },
      started_at: { type: 'string', description: 'Segment start time' },
      ended_at: { type: 'string', description: 'Segment end time' },
      duration_minutes: { type: 'number', description: 'Segment duration' },
      boundary_type: { type: 'string', description: 'What caused this segment boundary' },
      tool_calls: { type: 'number', description: 'Tool calls in this segment' },
      error_count: { type: 'number', description: 'Errors in this segment' },
      tasks_worked: { type: 'array', description: 'Task IDs worked in this segment' },
      compaction_summary: { type: 'string', description: 'LLM compaction summary text' },
      jsonl_byte_start: { type: 'number', description: 'JSONL byte offset start' },
      jsonl_byte_end: { type: 'number', description: 'JSONL byte offset end' },
    },
    required: ['segment_index', 'parent_session', 'started_at'],
  },
};

export const sessionsModule: BrainModule = {
  name: 'sessions',
  version: '1.0.0',
  description: 'Claude session tracking and analytics',
  register(ctx) {
    ctx.registerNoteType(SESSION_NOTE_TYPE);
    ctx.registerNoteType(SESSION_SEGMENT_NOTE_TYPE);

    // Relations (8 total, 4 with inverses)
    ctx.registerRelationType({
      name: 'associated-with',
      description: 'Session worked on this task',
      inverse: 'has-session',
    });
    ctx.registerRelationType({
      name: 'has-session',
      description: 'Task has associated session',
      inverse: 'associated-with',
    });
    ctx.registerRelationType({
      name: 'continued-from',
      description: 'This session continues prior session work',
      inverse: 'continues',
    });
    ctx.registerRelationType({
      name: 'continues',
      description: 'Forward inverse of continued-from',
      inverse: 'continued-from',
    });
    ctx.registerRelationType({
      name: 'triggered-by',
      description: 'Session was prompted by a decision',
    });
    ctx.registerRelationType({
      name: 'recorded-in',
      description: 'Memory fact discovered during this session',
    });
    ctx.registerRelationType({
      name: 'produced',
      description: 'Note created during this session',
    });
    ctx.registerRelationType({
      name: 'committed-in',
      description: 'Git commits made in this session',
    });
    ctx.registerRelationType({
      name: 'has-segment',
      description: 'Session contains this segment',
      inverse: 'segment-of',
    });
    ctx.registerRelationType({
      name: 'segment-of',
      description: 'Segment belongs to this session',
      inverse: 'has-segment',
    });
    ctx.registerRelationType({
      name: 'next-segment',
      description: 'Next segment in session chain',
      inverse: 'prev-segment',
    });
    ctx.registerRelationType({
      name: 'prev-segment',
      description: 'Previous segment in session chain',
      inverse: 'next-segment',
    });
    ctx.registerRelationType({
      name: 'spawned-agent',
      description: 'Agent note spawned during this session',
      inverse: 'spawned-in',
    });
    ctx.registerRelationType({
      name: 'spawned-in',
      description: 'Session in which this agent was spawned',
      inverse: 'spawned-agent',
    });
    // observed-in / has-observation registered by workflow module to avoid duplicate registration

    ctx.registerExtractionStrategy({ shouldExtract: () => false });

    ctx.registerFilter({
      visibility: 'contextual',
      shouldIncludeInSearch(note, query) {
        const q = query.toLowerCase();
        return q.includes('session') || q.includes('yesterday') || q.includes('worked on');
      },
    });

    ctx.registerContentHandler(new SessionContentHandler());

    ctx.registerHookHandler(sessionStartHandler);
    ctx.registerHookHandler(sessionRestoreHandler);
    ctx.registerHookHandler(sessionBriefingHandler);
    ctx.registerHookHandler(sessionCaptureHandler);
    ctx.registerHookHandler(sessionCompactHandler);
    ctx.registerHookHandler(sessionPreCompactHandler);
    ctx.registerHookHandler(sessionEndHandler);
    ctx.registerHookHandler(sessionCommitHandler);

    // Migration v1: json_extract indexes for session frontmatter queries
    ctx.registerMigration({
      version: 1,
      description: 'Create sessions module frontmatter indexes',
      up: (db) => {
        const rawDb = db as { exec(sql: string): void };
        rawDb.exec(`
          CREATE INDEX IF NOT EXISTS idx_sessions_session_id
            ON notes(module, json_extract(metadata, '$.session_id'));
          CREATE INDEX IF NOT EXISTS idx_sessions_status
            ON notes(module, json_extract(metadata, '$.status'));
          CREATE INDEX IF NOT EXISTS idx_sessions_project_dir
            ON notes(module, json_extract(metadata, '$.project_dir'));
          CREATE INDEX IF NOT EXISTS idx_sessions_started_at
            ON notes(module, json_extract(metadata, '$.started_at'));
          CREATE INDEX IF NOT EXISTS idx_sessions_project
            ON notes(module, json_extract(metadata, '$.project'));
        `);
      },
    });

    // Migration v2: hook-based capture tables
    ctx.registerMigration({
      version: 2,
      description: 'Create session_events and session_chunks tables for live capture',
      up: (db) => {
        const rawDb = db as { exec(sql: string): void };
        rawDb.exec(`
          CREATE TABLE IF NOT EXISTS session_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT    NOT NULL,
            event_type  TEXT    NOT NULL,
            category    TEXT,
            data        TEXT    NOT NULL,
            timestamp   TEXT    NOT NULL,
            data_hash   TEXT    NOT NULL,
            UNIQUE(session_id, data_hash)
          );
          CREATE INDEX IF NOT EXISTS idx_session_events_session_id
            ON session_events(session_id);
          CREATE INDEX IF NOT EXISTS idx_session_events_timestamp
            ON session_events(session_id, timestamp);

          CREATE TABLE IF NOT EXISTS session_chunks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT    NOT NULL,
            chunk_index INTEGER NOT NULL,
            content     TEXT    NOT NULL,
            source      TEXT    NOT NULL CHECK(source IN ('compaction', 'periodic', 'manual')),
            timestamp   TEXT    NOT NULL,
            UNIQUE(session_id, chunk_index)
          );
          CREATE INDEX IF NOT EXISTS idx_session_chunks_session_id
            ON session_chunks(session_id);
        `);
      },
    });

    // Migration v3: analytics rollup DDL (table only, not populated until needed)
    ctx.registerMigration({
      version: 3,
      description: 'Create session_analytics_rollup table DDL for future use',
      up: (db) => {
        const rawDb = db as { exec(sql: string): void };
        rawDb.exec(`
          CREATE TABLE IF NOT EXISTS session_analytics_rollup (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            project_dir TEXT    NOT NULL,
            period      TEXT    NOT NULL,
            period_start TEXT   NOT NULL,
            session_count INTEGER NOT NULL DEFAULT 0,
            total_turns  INTEGER NOT NULL DEFAULT 0,
            total_errors INTEGER NOT NULL DEFAULT 0,
            avg_error_rate REAL NOT NULL DEFAULT 0,
            avg_duration_minutes REAL NOT NULL DEFAULT 0,
            top_tools   TEXT,
            friction_summary TEXT,
            computed_at TEXT    NOT NULL,
            UNIQUE(project_dir, period, period_start)
          );
        `);
      },
    });

    // Migration v4: structural events table for lightweight tool-call events
    ctx.registerMigration({
      version: 4,
      description: 'Create structural_events table for tool-call pattern matching',
      up: (db) => {
        const rawDb = db as { exec(sql: string): void };
        rawDb.exec(`
          CREATE TABLE IF NOT EXISTS structural_events (
            id          TEXT    PRIMARY KEY,
            session_id  TEXT    NOT NULL,
            event_type  TEXT    NOT NULL,
            detail      TEXT    NOT NULL,
            file_path   TEXT,
            timestamp   TEXT    NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_structural_events_session
            ON structural_events(session_id);
          CREATE INDEX IF NOT EXISTS idx_structural_events_type
            ON structural_events(session_id, event_type);
        `);
      },
    });

    // Migration v5: session_files table for tracking files touched per session
    ctx.registerMigration({
      version: 5,
      description: 'Create session_files table for per-session file access tracking',
      up: (db) => {
        const rawDb = db as { exec(sql: string): void };
        rawDb.exec(`
          CREATE TABLE IF NOT EXISTS session_files (
            session_id      TEXT NOT NULL,
            file_path       TEXT NOT NULL,
            operations      TEXT NOT NULL DEFAULT '[]',
            last_touched_at TEXT,
            PRIMARY KEY (session_id, file_path)
          );
          CREATE INDEX IF NOT EXISTS idx_session_files_path
            ON session_files(file_path);
          CREATE INDEX IF NOT EXISTS idx_session_files_session
            ON session_files(session_id);
        `);
      },
    });

    const sessionCmd = new Command('session').description(
      'Session tracking, analytics, and resumption'
    );
    sessionCmd.addCommand(createSessionListCommand());
    sessionCmd.addCommand(createSessionShowCommand());
    sessionCmd.addCommand(createSessionIngestCommand());
    sessionCmd.addCommand(createSessionResumeCommand());
    sessionCmd.addCommand(createSessionAnalyticsCommand());
    sessionCmd.addCommand(createSessionSnapshotCommand());
    sessionCmd.addCommand(createSessionCommitCommand());
    sessionCmd.addCommand(createSessionRestoreCommand());
    sessionCmd.addCommand(createSessionStatsCommand());
    sessionCmd.addCommand(createSessionBriefingCommand());

    ctx.registerCommand(sessionCmd);
  },
};
