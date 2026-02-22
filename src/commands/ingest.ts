import { Command } from '@commander-js/extra-typings';
import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { loadConfig } from '../services/config.js';
import { BrainDB } from '../services/brain-db.js';
import type { InboxItem, InboxSource } from '../types.js';

export const ingestCommand = new Command('ingest')
  .description('Bulk-import files into the inbox')
  .argument('<files...>', 'Files to ingest')
  .option('--source <source>', 'Source label (file, crawler, api)', 'file')
  .option('--url <url>', 'Source URL for all items')
  .action((files, opts) => {
    const config = loadConfig();
    const db = new BrainDB(config.dbPath);
    let ingested = 0;

    try {
      for (const filePath of files) {
        const absPath = resolve(filePath);
        try {
          statSync(absPath);
        } catch {
          console.error(`Skipping: ${filePath} (not found)`);
          continue;
        }

        const content = readFileSync(absPath, 'utf-8');
        if (!content.trim()) {
          console.error(`Skipping: ${filePath} (empty)`);
          continue;
        }

        const item: InboxItem = {
          id: randomUUID(),
          content,
          title: basename(filePath, '.md'),
          source: (opts.source ?? 'file') as InboxSource,
          sourceUrl: opts.url ?? null,
          sourceMeta: JSON.stringify({ originalPath: absPath }),
          status: 'pending',
          createdAt: new Date().toISOString(),
          processedAt: null,
        };

        db.addInboxItem(item);
        ingested++;
      }

      console.log(`Ingested ${ingested} item${ingested !== 1 ? 's' : ''} into inbox.`);
    } finally {
      db.close();
    }
  });
