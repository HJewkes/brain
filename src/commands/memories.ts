import { Command } from '@commander-js/extra-typings';
import { loadConfig } from '../services/config.js';
import { BrainDB } from '../services/brain-db.js';

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
      .action((opts) => {
        const config = loadConfig();
        const db = new BrainDB(config.dbPath);

        try {
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
            console.log('No memories found.');
            return;
          }

          for (const m of limited) {
            console.log(`[${m.containerTag}] ${m.memory}`);
            console.log(`  id: ${m.id} | source: ${m.sourceNoteId} | ${m.createdAt}`);
            if (m.parentMemoryId) {
              console.log(`  updated from: ${m.parentMemoryId}`);
            }
            console.log();
          }

          console.log(`Total: ${limited.length}${memories.length > limit ? ` (showing ${limit} of ${memories.length})` : ''}`);
        } finally {
          db.close();
        }
      })
  )
  .addCommand(
    new Command('history')
      .description('View version history of a memory')
      .argument('<id>', 'Memory ID or root memory ID')
      .option('--json', 'Output as JSON')
      .action((id, opts) => {
        const config = loadConfig();
        const db = new BrainDB(config.dbPath);

        try {
          const chain = db.getMemoryVersionChain(id);
          const history = db.getMemoryHistory(id);

          if (opts.json) {
            process.stdout.write(JSON.stringify({ chain, history }) + '\n');
            return;
          }

          if (chain.length === 0 && history.length === 0) {
            console.error(`No history found for memory "${id}"`);
            process.exitCode = 1;
            return;
          }

          if (chain.length > 0) {
            console.log('Version chain:');
            for (const m of chain) {
              const status = m.isLatest ? '(current)' : m.isForgotten ? '(forgotten)' : '(superseded)';
              console.log(`  ${status} ${m.memory}`);
              console.log(`    id: ${m.id} | ${m.createdAt}`);
            }
            console.log();
          }

          if (history.length > 0) {
            console.log('History events:');
            for (const h of history) {
              console.log(`  [${h.event}] ${h.createdAt} by ${h.actor}`);
              if (h.oldMemory) console.log(`    old: ${h.oldMemory}`);
              if (h.newMemory) console.log(`    new: ${h.newMemory}`);
            }
          }
        } finally {
          db.close();
        }
      })
  )
  .addCommand(
    new Command('stats')
      .description('Show memory statistics')
      .option('--json', 'Output as JSON')
      .action((opts) => {
        const config = loadConfig();
        const db = new BrainDB(config.dbPath);

        try {
          const forgotten = db.forgetExpiredMemories();
          const count = db.getMemoryCount();

          const stats = { activeMemories: count, expiredThisRun: forgotten };

          if (opts.json) {
            process.stdout.write(JSON.stringify(stats) + '\n');
            return;
          }

          console.log(`Active memories: ${count}`);
          if (forgotten > 0) {
            console.log(`Expired this run: ${forgotten}`);
          }
        } finally {
          db.close();
        }
      })
  );
