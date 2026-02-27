import { Command } from '@commander-js/extra-typings';
import { randomUUID } from 'node:crypto';
import { withDb } from '../services/brain-service.js';
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
      .action(async (url, opts) => {
        try {
          new URL(url);
        } catch {
          process.stderr.write(`Error: invalid URL: ${url}\n`);
          process.exitCode = 1;
          return;
        }

        await withDb(({ db }) => {
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
            process.stdout.write(`Added feed: ${name} (${feed.id})\n`);
          } catch (err) {
            if (err instanceof Error && err.message.includes('UNIQUE')) {
              process.stderr.write(`Error: feed URL already exists: ${url}\n`);
            } else {
              throw err;
            }
            process.exitCode = 1;
          }
        });
      })
  )
  .addCommand(
    new Command('list').description('List all subscribed feeds').action(async () => {
      await withDb(({ db }) => {
        const feeds = db.getFeeds();
        if (feeds.length === 0) {
          process.stdout.write('No feeds configured.\n');
          return;
        }

        for (const feed of feeds) {
          const polled = feed.lastPolled ? `last polled: ${feed.lastPolled}` : 'never polled';
          process.stdout.write(`${feed.name} [${feed.containerTag}]\n`);
          process.stdout.write(`  ${feed.url}\n`);
          process.stdout.write(`  ${polled} | id: ${feed.id}\n`);
          if (feed.filterPrompt) {
            process.stdout.write(`  filter: ${feed.filterPrompt}\n`);
          }
          process.stdout.write('\n');
        }
      });
    })
  )
  .addCommand(
    new Command('remove')
      .description('Unsubscribe from a feed')
      .argument('<id>', 'Feed ID to remove')
      .action(async (id) => {
        await withDb(({ db }) => {
          const feed = db.getFeedById(id);
          if (!feed) {
            process.stderr.write(`Error: feed "${id}" not found\n`);
            process.exitCode = 1;
            return;
          }
          db.removeFeed(id);
          process.stdout.write(`Removed feed: ${feed.name}\n`);
        });
      })
  );
