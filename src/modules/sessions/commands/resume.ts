import { Command } from '@commander-js/extra-typings';
import { withDb } from '../../../services/brain-service.js';
import { resolveSessionRef } from '../engine/resolve-ref.js';
import { assembleSessionContext, applyTokenBudget } from '../engine/context-bundle.js';
import { renderSessionContext } from '../engine/render.js';
import type { RenderFormat } from '../engine/render.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSessionResumeCommand(): Command<any> {
  return new Command('resume')
    .description('Generate context bundle from a previous session')
    .argument('<ref>', 'Session reference: UUID, SNS-NNN, task ID, "yesterday", "last"')
    .option('--format <fmt>', 'Output format: markdown, xml, json', 'markdown')
    .option('--token-budget <n>', 'Token budget for context', '6000')
    .option('--project-dir <dir>', 'Filter by project directory')
    .option('--no-interactive', 'Auto-select most recent match')
    .option('--clipboard', 'Copy to clipboard (macOS)')
    .option('--json', 'Output JSON bundle')
    .action(
      async (
        ref: string,
        opts: {
          format?: string;
          tokenBudget?: string;
          projectDir?: string;
          interactive?: boolean;
          clipboard?: boolean;
          json?: boolean;
        }
      ) => {
        await withDb(async (svc) => {
          const matches = resolveSessionRef(svc.db, ref, {
            projectDir: opts.projectDir,
          });

          if (matches.length === 0) {
            process.stderr.write(
              `No sessions found for "${ref}". Try: brain session list --since 7d\n`
            );
            process.exitCode = 1;
            return;
          }

          // Auto-select most recent
          const session = matches[0];

          const bundle = assembleSessionContext(svc.db, svc.config, session);
          const budget = parseInt(opts.tokenBudget ?? '6000', 10);
          const budgeted = applyTokenBudget(bundle, budget);

          const format = (opts.json ? 'json' : (opts.format ?? 'markdown')) as RenderFormat;
          const output = renderSessionContext(budgeted, format);

          if (opts.clipboard && process.platform === 'darwin') {
            const { execSync } = await import('node:child_process');
            try {
              execSync('pbcopy', { input: output });
              process.stderr.write('Copied to clipboard.\n');
            } catch {
              process.stdout.write(output + '\n');
            }
          } else {
            process.stdout.write(output + '\n');
          }
        });
      }
    );
}
