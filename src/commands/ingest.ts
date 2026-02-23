import { Command } from '@commander-js/extra-typings';
import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { withDb } from '../services/brain-service.js';
import type { InboxItem, InboxSource } from '../types.js';
import { VALID_INBOX_SOURCES } from '../types.js';

export const ingestCommand = new Command('ingest')
  .description('Bulk-import files into the inbox')
  .argument('[files...]', 'Files to ingest')
  .option('--source <source>', 'Source label (file, crawler, api)', 'file')
  .option('--url <url>', 'Source URL for all items')
  .option('--urls <file>', 'File containing URLs to import (one per line)')
  .action(async (files, opts) => {
    if (opts.urls) {
      await handleUrlsFile(opts.urls);
      return;
    }

    if (!files || files.length === 0) {
      process.stderr.write('Error: provide file arguments or use --urls <file>\n');
      process.exitCode = 1;
      return;
    }

    const source = opts.source ?? 'file';
    if (!VALID_INBOX_SOURCES.includes(source as InboxSource)) {
      process.stderr.write(
        `Error: invalid source "${source}". Valid: ${VALID_INBOX_SOURCES.join(', ')}\n`
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

async function handleUrlsFile(urlsPath: string): Promise<void> {
  const { fetchAndExtract } = await import('../services/web-extract.js');
  const urlFile = resolve(urlsPath);
  const content = readFileSync(urlFile, 'utf-8');
  const urls = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  await withDb(async ({ db }) => {
    let ingested = 0;
    let failed = 0;
    for (const url of urls) {
      try {
        const result = await fetchAndExtract(url);
        const title = result.metadata.title ?? url;
        const item: InboxItem = {
          id: randomUUID(),
          content: result.markdown || `Could not extract content from ${url}`,
          title,
          source: 'crawler' as InboxSource,
          sourceUrl: result.normalizedUrl,
          sourceMeta: null,
          status: 'pending',
          createdAt: new Date().toISOString(),
          processedAt: null,
        };
        db.addInboxItem(item);
        ingested++;
        process.stdout.write(`Fetched: ${url}\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Failed: ${url} — ${msg}\n`);
        failed++;
      }
    }
    process.stdout.write(`Ingested ${ingested} URL(s) into inbox.`);
    if (failed > 0) process.stdout.write(` ${failed} failed.`);
    process.stdout.write('\n');
  });
}
