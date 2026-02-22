import { Command } from '@commander-js/extra-typings';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../services/config.js';
import { BrainDB } from '../services/brain-db.js';
import type { FeedRecord } from '../types.js';

export const feedCommand = new Command('feed')
  .description('Manage RSS feed subscriptions')
  .addCommand(
    new Command('add')
      .description('Subscribe to an RSS feed')
      .argument('<url>', 'Feed URL')
      .option('--name <name>', 'Display name for the feed')
      .option('--tag <tag>', 'Container tag for namespacing', 'default')
      .option('--filter <prompt>', 'Filter prompt to select relevant items')
      .action((url, opts) => {
        const config = loadConfig();
        const db = new BrainDB(config.dbPath);

        try {
          const name = opts.name ?? new URL(url).hostname;
          const feed: FeedRecord = {
            id: randomUUID(),
            url,
            name,
            containerTag: opts.tag ?? 'default',
            filterPrompt: opts.filter ?? null,
            lastPolled: null,
            createdAt: new Date().toISOString(),
          };

          db.addFeed(feed);
          console.log(`Added feed: ${name} (${feed.id})`);
        } catch (err) {
          if (err instanceof Error && err.message.includes('UNIQUE')) {
            console.error(`Error: feed URL already exists: ${url}`);
          } else {
            throw err;
          }
          process.exitCode = 1;
        } finally {
          db.close();
        }
      })
  )
  .addCommand(
    new Command('list')
      .description('List all subscribed feeds')
      .action(() => {
        const config = loadConfig();
        const db = new BrainDB(config.dbPath);

        try {
          const feeds = db.getFeeds();
          if (feeds.length === 0) {
            console.log('No feeds configured.');
            return;
          }

          for (const feed of feeds) {
            const polled = feed.lastPolled ? `last polled: ${feed.lastPolled}` : 'never polled';
            console.log(`${feed.name} [${feed.containerTag}]`);
            console.log(`  ${feed.url}`);
            console.log(`  ${polled} | id: ${feed.id}`);
            if (feed.filterPrompt) {
              console.log(`  filter: ${feed.filterPrompt}`);
            }
            console.log();
          }
        } finally {
          db.close();
        }
      })
  )
  .addCommand(
    new Command('remove')
      .description('Unsubscribe from a feed')
      .argument('<id>', 'Feed ID to remove')
      .action((id) => {
        const config = loadConfig();
        const db = new BrainDB(config.dbPath);

        try {
          const feed = db.getFeedById(id);
          if (!feed) {
            console.error(`Error: feed "${id}" not found`);
            process.exitCode = 1;
            return;
          }
          db.removeFeed(id);
          console.log(`Removed feed: ${feed.name}`);
        } finally {
          db.close();
        }
      })
  );
