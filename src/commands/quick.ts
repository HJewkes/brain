import { Command } from '@commander-js/extra-typings';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../services/config.js';
import { BrainDB } from '../services/brain-db.js';
import type { InboxItem, InboxSource } from '../types.js';

export const quickCommand = new Command('quick')
  .description('Quickly capture a thought into the inbox')
  .argument('<text...>', 'Text to capture (or pipe via stdin)')
  .option('--title <title>', 'Optional title for the item')
  .option('--source <source>', 'Source label (cli, api, alert)', 'cli')
  .option('--url <url>', 'Source URL for reference')
  .action((textParts, opts) => {
    let content: string;

    if (textParts.length > 0) {
      content = textParts.join(' ');
    } else if (!process.stdin.isTTY) {
      content = readFileSync(0, 'utf-8').trim();
    } else {
      console.error('Error: provide text as arguments or pipe via stdin');
      process.exitCode = 1;
      return;
    }

    if (!content) {
      console.error('Error: empty content');
      process.exitCode = 1;
      return;
    }

    const config = loadConfig();
    const db = new BrainDB(config.dbPath);

    try {
      const item: InboxItem = {
        id: randomUUID(),
        content,
        title: opts.title ?? null,
        source: (opts.source ?? 'cli') as InboxSource,
        sourceUrl: opts.url ?? null,
        sourceMeta: null,
        status: 'pending',
        createdAt: new Date().toISOString(),
        processedAt: null,
      };

      db.addInboxItem(item);
      console.log(`Captured to inbox: ${item.id}`);
    } finally {
      db.close();
    }
  });
