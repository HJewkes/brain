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
      termination_reason: {
        type: 'string',
        description: 'Why the loop stopped (if not completed)',
      },
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
      source_sessions: {
        type: 'array',
        description: 'Session display_ids that sourced this insight',
      },
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
      inverse: 'has-insight',
    });
    ctx.registerRelationType({
      name: 'has-insight',
      description: 'Session produced this insight',
      inverse: 'insight-from',
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
      .option('--json', 'Output as JSON')
      .action(async (cmdOpts) => {
        const { withDb } = await import('../../services/brain-service.js');
        await withDb(async (svc) => {
          const { getLastRunTime, isOnCooldown } = await import('./engine/run-tracker.js');
          const { loadBounds } = await import('./engine/bounds.js');
          const bounds = loadBounds();

          const sessionReviewLast = getLastRunTime(svc.db, 'session-review');
          const consolidationLast = getLastRunTime(svc.db, 'task-consolidation');
          const sessionReviewCooldown = isOnCooldown(svc.db, 'session-review', bounds.cooldownMs);
          const consolidationCooldown = isOnCooldown(
            svc.db,
            'task-consolidation',
            bounds.cooldownMs
          );

          if (cmdOpts.json) {
            process.stdout.write(
              JSON.stringify(
                {
                  sessionReview: {
                    lastRun: sessionReviewLast?.toISOString() ?? null,
                    onCooldown: sessionReviewCooldown,
                  },
                  taskConsolidation: {
                    lastRun: consolidationLast?.toISOString() ?? null,
                    onCooldown: consolidationCooldown,
                  },
                  bounds,
                },
                null,
                2
              ) + '\n'
            );
          } else {
            process.stdout.write('Autoloop Status\n');
            process.stdout.write(
              `  Session Review:      last=${sessionReviewLast?.toISOString() ?? 'never'}  cooldown=${sessionReviewCooldown ? 'yes' : 'no'}\n`
            );
            process.stdout.write(
              `  Task Consolidation:  last=${consolidationLast?.toISOString() ?? 'never'}  cooldown=${consolidationCooldown ? 'yes' : 'no'}\n`
            );
            process.stdout.write(
              `  Bounds: max_time=${bounds.maxDurationMs / 60000}m  max_notes=${bounds.maxNotesCreated}  cooldown=${bounds.cooldownMs / 60000}m\n`
            );
          }
        });
      });

    autoloopCmd
      .command('review')
      .description('Run session review loop (requires Ollama)')
      .option('--max-sessions <n>', 'Maximum sessions to review', '10')
      .option('--min-age <hours>', 'Minimum session age in hours', '1')
      .option('--json', 'Output as JSON')
      .action(async (cmdOpts) => {
        const { withBrain } = await import('../../services/brain-service.js');
        const { requireOllama } = await import('../../services/ollama.js');
        await withBrain(async (svc) => {
          const ollama = await requireOllama();
          if (!ollama) return;

          const { runSessionReviewLoop } = await import('./engine/review-loop.js');
          const report = await runSessionReviewLoop(svc.db, svc.config, svc.embedder, ollama, {
            maxSessions: parseInt(cmdOpts.maxSessions),
            minAgeHours: parseInt(cmdOpts.minAge),
          });

          if (cmdOpts.json) {
            process.stdout.write(JSON.stringify(report, null, 2) + '\n');
          } else {
            process.stdout.write(
              `Session Review: ${report.status} (${Math.round(report.durationMs / 1000)}s)\n`
            );
            process.stdout.write(`  Sessions reviewed: ${report.sessionsReviewed}\n`);
            process.stdout.write(`  Insights extracted: ${report.insightsExtracted}\n`);
            process.stdout.write(`  Notes created: ${report.notesCreated}\n`);
            if (report.errors.length > 0) {
              process.stdout.write(`  Errors: ${report.errors.length}\n`);
            }
            if (report.terminationReason) {
              process.stdout.write(`  Terminated: ${report.terminationReason}\n`);
            }
          }
        });
      });

    autoloopCmd
      .command('consolidate')
      .description('Run task consolidation loop')
      .option('--project <prefix>', 'Project prefix')
      .option('--workstream <n>', 'Workstream number')
      .option('--json', 'Output as JSON')
      .action(async (cmdOpts) => {
        const { withBrain } = await import('../../services/brain-service.js');
        await withBrain(async (svc) => {
          const { runTaskConsolidationLoop } = await import('./engine/consolidation-loop.js');
          const report = await runTaskConsolidationLoop(svc.db, svc.config, svc.embedder, {
            project: cmdOpts.project,
            workstream: cmdOpts.workstream ? parseInt(cmdOpts.workstream) : undefined,
          });

          if (cmdOpts.json) {
            process.stdout.write(JSON.stringify(report, null, 2) + '\n');
          } else {
            process.stdout.write(
              `Task Consolidation: ${report.status} (${Math.round(report.durationMs / 1000)}s)\n`
            );
            process.stdout.write(`  Tasks scanned: ${report.sessionsReviewed}\n`);
            process.stdout.write(`  Tasks enriched: ${report.tasksUpdated}\n`);
            if (report.errors.length > 0) {
              process.stdout.write(`  Errors: ${report.errors.length}\n`);
            }
          }
        });
      });

    autoloopCmd
      .command('dedup')
      .description('Detect duplicate/overlapping tasks across workstreams')
      .option('--project <prefix>', 'Project prefix')
      .option('--workstream <n>', 'Workstream number')
      .option('--threshold <n>', 'Similarity threshold (0.0-1.0)', '0.85')
      .option('--status <status>', 'Task status to scan', 'pending')
      .option('--json', 'Output as JSON')
      .action(async (cmdOpts) => {
        const { withBrain } = await import('../../services/brain-service.js');
        await withBrain(async (svc) => {
          const { scanForDuplicates } = await import('./engine/dedup-scanner.js');
          const result = await scanForDuplicates(svc.db, svc.embedder, {
            project: cmdOpts.project,
            workstream: cmdOpts.workstream ? parseInt(cmdOpts.workstream) : undefined,
            threshold: parseFloat(cmdOpts.threshold),
            status: cmdOpts.status,
          });

          if (cmdOpts.json) {
            process.stdout.write(JSON.stringify(result, null, 2) + '\n');
          } else {
            process.stdout.write(
              `Dedup Scan: ${result.totalScanned} tasks scanned, ${result.pairsFound} duplicate pairs found\n`
            );
            for (const pair of result.pairs) {
              process.stdout.write(
                `\n  ${pair.taskA} ↔ ${pair.taskB}  (similarity: ${pair.similarity})\n`
              );
              process.stdout.write(`    A: ${pair.titleA}\n`);
              process.stdout.write(`    B: ${pair.titleB}\n`);
              process.stdout.write(`    → ${pair.suggestion}: ${pair.rationale}\n`);
            }
            if (result.errors.length > 0) {
              process.stdout.write(`\nErrors: ${result.errors.join(', ')}\n`);
            }
          }
        });
      });

    ctx.registerCommand(autoloopCmd);
  },
};
