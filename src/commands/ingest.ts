import { Command } from '@commander-js/extra-typings';
import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { withDb } from '../services/brain-service.js';
import type { InboxItem, InboxSource } from '../types.js';

const VALID_SOURCES: InboxSource[] = ['cli', 'rss', 'crawler', 'alert', 'api', 'file'];

export const ingestCommand = new Command('ingest')
  .description('Bulk-import files into the inbox')
  .argument('<files...>', 'Files to ingest')
  .option('--source <source>', 'Source label (file, crawler, api)', 'file')
  .option('--url <url>', 'Source URL for all items')
  .action(async (files, opts) => {
    const source = opts.source ?? 'file';
    if (!VALID_SOURCES.includes(source as InboxSource)) {
      process.stderr.write(
        `Error: invalid source "${source}". Valid: ${VALID_SOURCES.join(', ')}\n`
      );
      process.exitCode = 1;
      return;
    }

    await withDb(({ db }) => {
      let ingested = 0;

      for (const filePath of files) {
        const absPath = resolve(filePath);
        try {
          statSync(absPath);
        } catch {
          process.stderr.write(`Skipping: ${filePath} (not found)\n`);
          continue;
        }

        const content = readFileSync(absPath, 'utf-8');
        if (!content.trim()) {
          process.stderr.write(`Skipping: ${filePath} (empty)\n`);
          continue;
        }

        const item: InboxItem = {
          id: randomUUID(),
          content,
          title: basename(filePath, '.md'),
          source: source as InboxSource,
          sourceUrl: opts.url ?? null,
          sourceMeta: JSON.stringify({ originalPath: absPath }),
          status: 'pending',
          createdAt: new Date().toISOString(),
          processedAt: null,
        };

        db.addInboxItem(item);
        ingested++;
      }

      process.stdout.write(`Ingested ${ingested} item${ingested !== 1 ? 's' : ''} into inbox.\n`);
    });
  });
