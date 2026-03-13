import { Command } from '@commander-js/extra-typings';
import { withDb } from '../../../services/brain-service.js';
import { detectResumableSession, generateRestoreContext } from '../engine/session-restore.js';
import type { RenderFormat } from '../engine/render.js';

export function createSessionRestoreCommand(): Command {
  return new Command('restore')
    .description('Restore session context for agent startup')
    .requiredOption('--project-dir <dir>', 'Project directory to match snapshots against')
    .option('--token-budget <n>', 'Token budget for context output', '4000')
    .option('--format <fmt>', 'Output format: xml, markdown, json', 'xml')
    .action(async (opts: { projectDir: string; tokenBudget?: string; format?: string }) => {
      const resumable = detectResumableSession(opts.projectDir);
      if (!resumable) return;

      await withDb(async (svc) => {
        const budget = parseInt(opts.tokenBudget ?? '4000', 10);
        const format = (opts.format ?? 'xml') as RenderFormat;
        const context = generateRestoreContext(
          svc.db,
          svc.config,
          resumable.sessionId,
          budget,
          format
        );
        if (context) {
          process.stdout.write(context + '\n');
        }
      });
    });
}
