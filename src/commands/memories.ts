import { Command } from '@commander-js/extra-typings';
import { withDb } from '../services/brain-service.js';

export const memoriesCommand = new Command('memories')
  .description('View and manage extracted memories')
  .addCommand(
    new Command('list')
      .description('List active memories')
      .option('--container <tag>', 'Filter by container tag')
      .option('--since <date>', 'Only memories created after this date')
      .option('--note <id>', 'Only memories from a specific note')
      .option('--json', 'Output as JSON')
      .option('--limit <n>', 'Max results', '50')
      .action(async (opts) => {
        await withDb(({ db }) => {
          db.forgetExpiredMemories();

          let memories;
          if (opts.note) {
            memories = db.getMemoriesForNote(opts.note);
          } else if (opts.since) {
            memories = db.getMemoriesSince(opts.since, opts.container);
          } else {
            memories = db.getLatestMemories(opts.container);
          }

          const limit = parseInt(opts.limit, 10);
          const limited = memories.slice(0, limit);

          if (opts.json) {
            process.stdout.write(JSON.stringify(limited) + '\n');
            return;
          }

          if (limited.length === 0) {
            process.stdout.write('No memories found.\n');
            return;
          }

          for (const m of limited) {
            process.stdout.write(`[${m.containerTag}] ${m.memory}\n`);
            process.stdout.write(`  id: ${m.id} | source: ${m.sourceNoteId} | ${m.createdAt}\n`);
            if (m.parentMemoryId) {
              process.stdout.write(`  updated from: ${m.parentMemoryId}\n`);
            }
            process.stdout.write('\n');
          }

          process.stdout.write(
            `Total: ${limited.length}${memories.length > limit ? ` (showing ${limit} of ${memories.length})` : ''}\n`
          );
        });
      })
  )
  .addCommand(
    new Command('history')
      .description('View version history of a memory')
      .argument('<id>', 'Memory ID or root memory ID')
      .option('--json', 'Output as JSON')
      .action(async (id, opts) => {
        await withDb(({ db }) => {
          const chain = db.getMemoryVersionChain(id);
          const history = db.getMemoryHistory(id);

          if (opts.json) {
            process.stdout.write(JSON.stringify({ chain, history }) + '\n');
            return;
          }

          if (chain.length === 0 && history.length === 0) {
            process.stderr.write(`No history found for memory "${id}"\n`);
            process.exitCode = 1;
            return;
          }

          if (chain.length > 0) {
            process.stdout.write('Version chain:\n');
            for (const m of chain) {
              const status = m.isLatest
                ? '(current)'
                : m.isForgotten
                  ? '(forgotten)'
                  : '(superseded)';
              process.stdout.write(`  ${status} ${m.memory}\n`);
              process.stdout.write(`    id: ${m.id} | ${m.createdAt}\n`);
            }
            process.stdout.write('\n');
          }

          if (history.length > 0) {
            process.stdout.write('History events:\n');
            for (const h of history) {
              process.stdout.write(`  [${h.event}] ${h.createdAt} by ${h.actor}\n`);
              if (h.oldMemory) process.stdout.write(`    old: ${h.oldMemory}\n`);
              if (h.newMemory) process.stdout.write(`    new: ${h.newMemory}\n`);
            }
          }
        });
      })
  )
  .addCommand(
    new Command('stats')
      .description('Show memory statistics')
      .option('--json', 'Output as JSON')
      .action(async (opts) => {
        await withDb(({ db }) => {
          const forgotten = db.forgetExpiredMemories();
          const count = db.getMemoryCount();

          const stats = { activeMemories: count, expiredThisRun: forgotten };

          if (opts.json) {
            process.stdout.write(JSON.stringify(stats) + '\n');
            return;
          }

          process.stdout.write(`Active memories: ${count}\n`);
          if (forgotten > 0) {
            process.stdout.write(`Expired this run: ${forgotten}\n`);
          }
        });
      })
  );
