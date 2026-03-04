import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../services/brain-service.js';
import { parentResolveOpts } from '../services/config.js';

export const notesCommand = new Command('notes')
  .description('List and browse notes')
  .enablePositionalOptions()
  .option('--module <name>', 'Filter by module (shorthand for "notes list --module")')
  .action(async (opts) => {
    if (opts.module) {
      const listCmd = notesCommand.commands.find((c) => c.name() === 'list')!;
      await listCmd.parseAsync(['node', 'brain', 'notes', 'list', '--module', opts.module], {
        from: 'node',
      });
    } else {
      notesCommand.outputHelp();
    }
  });

notesCommand
  .command('list')
  .description('List all notes')
  .option('--module <name>', 'Filter by module (e.g. pm)')
  .option('--type <type>', 'Filter by note type (e.g. note, task, project)')
  .option('--tier <tier>', 'Filter by tier (slow, fast)')
  .option('--limit <n>', 'Max results (default: 50)', '50')
  .option('--json', 'Output JSON')
  .action(async (opts, cmd) => {
    await withBrain(async ({ db }) => {
      let notes = db.getAllNotes();

      if (opts.module) {
        notes = notes.filter((n) => n.module === opts.module);
      }
      if (opts.type) {
        notes = notes.filter((n) => n.type === opts.type);
      }
      if (opts.tier) {
        notes = notes.filter((n) => n.tier === opts.tier);
      }

      const limit = parseInt(opts.limit, 10);
      const limited = notes.slice(0, limit);

      if (opts.json) {
        const output = limited.map((n) => ({
          id: n.id,
          title: n.title,
          type: n.type,
          tier: n.tier,
          module: n.module ?? null,
          filePath: n.filePath,
          modifiedAt: n.modifiedAt,
        }));
        process.stdout.write(JSON.stringify(output, null, 2) + '\n');
        return;
      }

      if (limited.length === 0) {
        process.stdout.write('No notes found.\n');
        return;
      }

      for (const n of limited) {
        const mod = n.module ? ` [${n.module}]` : '';
        const tier = n.tier ? ` (${n.tier})` : '';
        process.stdout.write(`${n.type}${mod}${tier}  ${n.title}\n`);
        process.stdout.write(`  ${n.filePath}\n`);
      }

      if (notes.length > limit) {
        process.stderr.write(
          `Showing ${limit} of ${notes.length} notes. Use --limit to see more.\n`
        );
      }
    }, parentResolveOpts(cmd));
  });
