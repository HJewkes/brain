import { Command } from '@commander-js/extra-typings';
import { loadConfig } from '../services/config.js';
import { BrainDB } from '../services/brain-db.js';
import type { InboxStatus } from '../types.js';

const VALID_STATUSES: InboxStatus[] = ['pending', 'processing', 'indexed', 'failed', 'discarded'];

export const inboxCommand = new Command('inbox')
  .description('View and manage inbox items')
  .option('--status <status>', 'Filter by status (pending, processing, indexed, failed, discarded)')
  .option('--discard <id>', 'Discard an inbox item')
  .option('--delete <id>', 'Permanently delete an inbox item')
  .option('--count', 'Show count only')
  .action((opts) => {
    if (opts.status && !VALID_STATUSES.includes(opts.status as InboxStatus)) {
      console.error(
        `Error: invalid status "${opts.status}". Valid: ${VALID_STATUSES.join(', ')}`
      );
      process.exitCode = 1;
      return;
    }

    const config = loadConfig();
    const db = new BrainDB(config.dbPath);

    try {
      if (opts.discard) {
        const item = db.getInboxItem(opts.discard);
        if (!item) {
          console.error(`Error: inbox item "${opts.discard}" not found`);
          process.exitCode = 1;
          return;
        }
        db.updateInboxStatus(opts.discard, 'discarded');
        console.log(`Discarded: ${opts.discard}`);
        return;
      }

      if (opts.delete) {
        const item = db.getInboxItem(opts.delete);
        if (!item) {
          console.error(`Error: inbox item "${opts.delete}" not found`);
          process.exitCode = 1;
          return;
        }
        db.deleteInboxItem(opts.delete);
        console.log(`Deleted: ${opts.delete}`);
        return;
      }

      const items = db.getInboxItems(opts.status as InboxStatus | undefined);

      if (opts.count) {
        console.log(String(items.length));
        return;
      }

      if (items.length === 0) {
        console.log('Inbox is empty.');
        return;
      }

      for (const item of items) {
        const title = item.title ? ` — ${item.title}` : '';
        const preview = item.content.slice(0, 80).replace(/\n/g, ' ');
        console.log(`[${item.status}] ${item.id}${title}`);
        console.log(`  ${item.source} | ${item.createdAt}`);
        console.log(`  ${preview}${item.content.length > 80 ? '…' : ''}`);
        console.log();
      }
    } finally {
      db.close();
    }
  });
