import { Command } from '@commander-js/extra-typings';
import { withDb } from '../services/brain-service.js';
import { parentResolveOpts } from '../services/config.js';
import type { InboxStatus } from '../types.js';

const VALID_STATUSES: InboxStatus[] = ['pending', 'processing', 'indexed', 'failed', 'discarded'];

export const inboxCommand = new Command('inbox')
  .description('View and manage inbox items')
  .option('--status <status>', 'Filter by status (pending, processing, indexed, failed, discarded)')
  .option('--discard <id>', 'Discard an inbox item')
  .option('--delete <id>', 'Permanently delete an inbox item')
  .option('--count', 'Show count only')
  .action(async (opts, cmd) => {
    const actionFlags = [opts.discard, opts.delete, opts.count].filter(Boolean);
    if (actionFlags.length > 1) {
      process.stderr.write('Error: --discard, --delete, and --count are mutually exclusive\n');
      process.exitCode = 1;
      return;
    }

    if (opts.status && !VALID_STATUSES.includes(opts.status as InboxStatus)) {
      process.stderr.write(
        `Error: invalid status "${opts.status}". Valid: ${VALID_STATUSES.join(', ')}\n`
      );
      process.exitCode = 1;
      return;
    }

    await withDb(({ db }) => {
      if (opts.discard) {
        const item = db.getInboxItem(opts.discard);
        if (!item) {
          process.stderr.write(`Error: inbox item "${opts.discard}" not found\n`);
          process.exitCode = 1;
          return;
        }
        db.updateInboxStatus(opts.discard, 'discarded');
        process.stdout.write(`Discarded: ${opts.discard}\n`);
        return;
      }

      if (opts.delete) {
        const item = db.getInboxItem(opts.delete);
        if (!item) {
          process.stderr.write(`Error: inbox item "${opts.delete}" not found\n`);
          process.exitCode = 1;
          return;
        }
        db.deleteInboxItem(opts.delete);
        process.stdout.write(`Deleted: ${opts.delete}\n`);
        return;
      }

      const items = db.getInboxItems(opts.status as InboxStatus | undefined);

      if (opts.count) {
        process.stdout.write(String(items.length) + '\n');
        return;
      }

      if (items.length === 0) {
        process.stdout.write('Inbox is empty.\n');
        return;
      }

      for (const item of items) {
        const title = item.title ? ` — ${item.title}` : '';
        const preview = item.content.slice(0, 80).replace(/\n/g, ' ');
        process.stdout.write(`[${item.status}] ${item.id}${title}\n`);
        process.stdout.write(`  ${item.source} | ${item.createdAt}\n`);
        process.stdout.write(`  ${preview}${item.content.length > 80 ? '…' : ''}\n`);
        process.stdout.write('\n');
      }
    }, parentResolveOpts(cmd));
  });
