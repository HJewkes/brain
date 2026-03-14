import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { renameProjectPrefix } from '../engine/rename-prefix.js';

export function createRenamePrefixCommand() {
  return new Command('rename-prefix')
    .description('Rename a project prefix (e.g., VNM -> BRN)')
    .argument('<old>', 'Current project prefix')
    .argument('<new>', 'New project prefix')
    .option('--dry-run', 'Preview changes without executing')
    .option('--json', 'Output JSON')
    .action(async (oldPrefix, newPrefix, opts) => {
      const upper = { old: oldPrefix.toUpperCase(), new: newPrefix.toUpperCase() };

      await withBrain(async (svc) => {
        try {
          const result = await renameProjectPrefix(
            svc.db,
            svc.config,
            svc.embedder,
            upper.old,
            upper.new,
            { dryRun: opts.dryRun }
          );

          if (opts.json) {
            process.stdout.write(JSON.stringify(result, null, 2) + '\n');
            return;
          }

          const verb = opts.dryRun ? 'Would rename' : 'Renamed';
          const lines = [
            `${verb} project prefix ${upper.old} -> ${upper.new}:`,
            `  Projects: ${result.projectsRenamed}`,
            `  Workstreams: ${result.workstreamsRenamed}`,
            `  Tasks: ${result.tasksRenamed}`,
          ];

          if (result.filesRenamed.length > 0) {
            lines.push(`  Files ${opts.dryRun ? 'to rename' : 'renamed'}:`);
            for (const file of result.filesRenamed) {
              lines.push(`    ${file}`);
            }
          }

          process.stdout.write(lines.join('\n') + '\n');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(`Error: ${message}\n`);
          process.exitCode = 1;
        }
      });
    });
}
