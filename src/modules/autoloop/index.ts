import { Command } from '@commander-js/extra-typings';
import type { BrainModule, ModuleNoteType } from '../types.js';

const AUTOLOOP_REPORT_NOTE_TYPE: ModuleNoteType = {
  name: 'autoloop-report',
  description: 'A completed autoloop run report with metrics and outcomes',
  tier: 'slow',
  schema: {
    type: 'object',
    properties: {
      loop_type: {
        type: 'string',
        enum: ['session-review', 'task-consolidation'],
        description: 'Type of autoloop that ran',
      },
      status: {
        type: 'string',
        enum: ['completed', 'partial', 'failed'],
        description: 'Run outcome status',
      },
      started_at: { type: 'string', description: 'ISO 8601 run start time' },
      completed_at: { type: 'string', description: 'ISO 8601 run end time' },
      duration_ms: { type: 'number', description: 'Run wall-clock duration in milliseconds' },
      sessions_reviewed: { type: 'number', description: 'Sessions processed in this run' },
      insights_extracted: { type: 'number', description: 'Insights generated' },
      tasks_updated: { type: 'number', description: 'Tasks modified (enriched, deduped, etc.)' },
      notes_created: { type: 'number', description: 'Brain notes created' },
      termination_reason: { type: 'string', description: 'Why the loop stopped (if not completed)' },
    },
    required: ['loop_type', 'status', 'started_at'],
  },
};

const AUTOLOOP_INSIGHT_NOTE_TYPE: ModuleNoteType = {
  name: 'autoloop-insight',
  description: 'An insight extracted from cross-session review with confidence scoring',
  tier: 'slow',
  schema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['pattern', 'friction', 'decision', 'learning', 'improvement'],
        description: 'Insight category',
      },
      confidence: { type: 'number', description: 'Confidence score 0.0–1.0' },
      source_sessions: { type: 'array', description: 'Session display_ids that sourced this insight' },
      source_session_count: { type: 'number', description: 'Number of sessions corroborating' },
      reviewed_in: { type: 'string', description: 'Autoloop report display_id' },
    },
    required: ['category', 'confidence'],
  },
};

export const autoloopModule: BrainModule = {
  name: 'autoloop',
  version: '0.1.0',
  description: 'Background agent autoloops for session review and task consolidation',
  register(ctx) {
    ctx.registerNoteType(AUTOLOOP_REPORT_NOTE_TYPE);
    ctx.registerNoteType(AUTOLOOP_INSIGHT_NOTE_TYPE);

    ctx.registerRelationType({
      name: 'reviewed-in',
      description: 'Session was reviewed in this autoloop report',
      inverse: 'reviewed-session',
    });
    ctx.registerRelationType({
      name: 'reviewed-session',
      description: 'Autoloop report reviewed this session',
      inverse: 'reviewed-in',
    });
    ctx.registerRelationType({
      name: 'enriched-by',
      description: 'Task was enriched by this autoloop report',
      inverse: 'enriched-task',
    });
    ctx.registerRelationType({
      name: 'enriched-task',
      description: 'Autoloop report enriched this task',
      inverse: 'enriched-by',
    });
    ctx.registerRelationType({
      name: 'insight-from',
      description: 'Insight was extracted from this session',
    });

    ctx.registerExtractionStrategy({ shouldExtract: () => false });

    ctx.registerFilter({
      visibility: 'private',
    });

    ctx.registerMigration({
      version: 1,
      description: 'Create autoloop_runs table for cooldown tracking',
      up: (db) => {
        const rawDb = db as { exec(sql: string): void };
        rawDb.exec(`
          CREATE TABLE IF NOT EXISTS autoloop_runs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            loop_type   TEXT    NOT NULL,
            status      TEXT    NOT NULL,
            started_at  TEXT    NOT NULL,
            completed_at TEXT,
            duration_ms INTEGER,
            report_note_id TEXT,
            UNIQUE(loop_type, started_at)
          );
          CREATE INDEX IF NOT EXISTS idx_autoloop_runs_type
            ON autoloop_runs(loop_type, started_at);
        `);
      },
    });

    const autoloopCmd = new Command('autoloop').description(
      'Background agent autoloops for session review and task consolidation'
    );

    autoloopCmd
      .command('status')
      .description('Show autoloop status and last run times')
      .action(() => {
        // Placeholder — will be implemented in VNM-45.16
        process.stdout.write('Autoloop status: not yet implemented\n');
      });

    ctx.registerCommand(autoloopCmd);
  },
};
