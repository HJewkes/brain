import { Command } from '@commander-js/extra-typings';
import { listInstances, pruneStaleInstances } from '../services/instance-registry.js';
import { GLOBAL_BRAIN_DIR } from '../services/config.js';

const listSubcommand = new Command('list')
  .description('List all known brain instances')
  .option('--json', 'output as JSON')
  .option('--prune', 'remove stale entries (paths that no longer exist)')
  .action((opts) => {
    const globalDir = GLOBAL_BRAIN_DIR;

    if (opts.prune) {
      const pruned = pruneStaleInstances(globalDir);
      if (pruned > 0) {
        process.stderr.write(`Pruned ${pruned} stale instance(s)\n`);
      }
    }

    const instances = listInstances(globalDir);

    if (opts.json) {
      process.stdout.write(
        JSON.stringify({
          global: { path: globalDir, name: 'global' },
          instances,
        }) + '\n'
      );
    } else {
      process.stderr.write(`Global: ${globalDir}\n`);
      if (instances.length === 0) {
        process.stderr.write('No local instances registered.\n');
      } else {
        process.stderr.write(`\nLocal instances (${instances.length}):\n`);
        for (const inst of instances) {
          process.stderr.write(`  ${inst.name}: ${inst.path}\n`);
        }
      }
    }
  });

export const instancesCommand = new Command('instances')
  .description('Manage brain instances')
  .addCommand(listSubcommand);
