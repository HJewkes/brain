import { Command } from '@commander-js/extra-typings';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { withDb } from '../services/brain-service.js';
import type { InboxItem, InboxSource } from '../types.js';
import { VALID_INBOX_SOURCES } from '../types.js';

export const quickCommand = new Command('quick')
  .description('Quickly capture a thought into the inbox')
  .argument('<text...>', 'Text to capture (or pipe via stdin)')
  .option('--title <title>', 'Optional title for the item')
  .option('--source <source>', 'Source label (cli, api, alert)', 'cli')
  .option('--url <url>', 'Source URL for reference')
  .action(async (textParts, opts) => {
    let content: string;

    if (textParts.length > 0) {
      content = textParts.join(' ');
    } else if (!process.stdin.isTTY) {
      content = readFileSync(0, 'utf-8').trim();
    } else {
      process.stderr.write('Error: provide text as arguments or pipe via stdin\n');
      process.exitCode = 1;
      return;
    }

    if (!content) {
      process.stderr.write('Error: empty content\n');
      process.exitCode = 1;
      return;
    }

    const source = opts.source ?? 'cli';
    if (!VALID_INBOX_SOURCES.includes(source as InboxSource)) {
      process.stderr.write(
        `Error: invalid source "${source}". Valid: ${VALID_INBOX_SOURCES.join(', ')}\n`
      );
      process.exitCode = 1;
      return;
    }

    await withDb(({ db }) => {
      const item: InboxItem = {
        id: randomUUID(),
        content,
        title: opts.title ?? null,
        source: source as InboxSource,
        sourceUrl: opts.url ?? null,
        sourceMeta: null,
        status: 'pending',
        createdAt: new Date().toISOString(),
        processedAt: null,
      };

      db.addInboxItem(item);
      process.stdout.write(`Captured to inbox: ${item.id}\n`);
    });
  });
