import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { requireOllama } from '../../../services/ollama.js';
import { runIngestionPipeline } from '../ingestion/pipeline.js';
import { parseSinceDate } from '../utils.js';

export function createSessionIngestCommand(): Command {
  return new Command('ingest')
    .description('Ingest Claude session logs into brain')
    .option('--all', 'Ingest all discovered sessions')
    .option('--project-dir <dir>', 'Filter by project directory')
    .option('--since <date>', 'Only sessions modified after date (ISO or relative: 7d, 30d)')
    .option('--dry-run', 'Preview without making changes')
    .option('--skip-summaries', 'Skip LLM summary generation')
    .option('--verbose', 'Show detailed progress')
    .option('--json', 'Output JSON report')
    .action(
      async (opts: {
        all?: boolean;
        projectDir?: string;
        since?: string;
        dryRun?: boolean;
        skipSummaries?: boolean;
        verbose?: boolean;
        json?: boolean;
      }) => {
        const report = await withBrain(async (svc) => {
          const ollama = opts.skipSummaries ? null : await requireOllama();

          return runIngestionPipeline(svc.db, svc.config, svc.embedder, ollama, {
            projectDir: opts.projectDir,
            since: opts.since ? parseSinceDate(opts.since) : undefined,
            dryRun: opts.dryRun,
            skipSummaries: opts.skipSummaries,
            verbose: opts.verbose,
          });
        });

        if (opts.json) {
          process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        } else {
          process.stdout.write(
            `Discovered: ${report.discovered}, Ingested: ${report.ingested}, Skipped: ${report.skipped}\n`
          );
          if (report.errors.length > 0) {
            process.stderr.write(`Errors: ${report.errors.length}\n`);
            for (const e of report.errors) {
              process.stderr.write(`  ${e.sessionId}: ${e.error}\n`);
            }
          }
        }
      }
    );
}
