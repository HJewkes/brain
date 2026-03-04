import { Command } from '@commander-js/extra-typings';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { withBrain } from '../services/brain-service.js';
import { parentResolveOpts } from '../services/config.js';
import { detectFormat, convertToMarkdown } from '../services/format-adapters/index.js';
import { INDEXABLE_EXTENSIONS } from '../services/file-scanner.js';
import { indexSingleFile } from '../services/indexing.js';
import { splitDocument } from '../services/document-splitter.js';
import { slugify } from '../utils.js';
import type { ContentClass } from '../types.js';

interface ImportStats {
  imported: Map<string, number>;
  derived: number;
  skipped: Array<{ path: string; reason: string }>;
  noteIds: string[];
}

export const importCommand = new Command('import')
  .description('Import files into the brain (converts, classifies, indexes)')
  .argument('[paths...]', 'Files or directories to import')
  .option('--urls <file>', 'File containing URLs to import (one per line)')
  .option('--source <source>', 'Source label for provenance tracking', 'file')
  .option('--quiet', 'Suppress output')
  .option('--json', 'Output result as JSON')
  .action(async (paths, opts, cmd) => {
    const resolveOpts = parentResolveOpts(cmd);

    if (opts.urls) {
      const { fetchAndExtract } = await import('../services/web-extract.js');
      await withBrain(async ({ db, embedder }) => {
        const urlFile = resolve(opts.urls!);
        const content = readFileSync(urlFile, 'utf-8');
        const urls = content
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'));
        let imported = 0;
        let failed = 0;
        for (const url of urls) {
          try {
            const result = await fetchAndExtract(url);
            const markdown = result.markdown || `Could not extract content from ${url}`;
            const hash = createHash('sha256').update(markdown).digest('hex');
            await indexSingleFile(db, embedder, `url-${slugify(url)}.md`, markdown, hash, Date.now());
            imported++;
            if (!opts.quiet) process.stdout.write(`Fetched: ${url}\n`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(`Failed: ${url} — ${msg}\n`);
            failed++;
          }
        }
        if (!opts.quiet) {
          process.stdout.write(`Imported ${imported} URL(s).`);
          if (failed > 0) process.stdout.write(` ${failed} failed.`);
          process.stdout.write('\n');
        }
      }, resolveOpts);
      return;
    }

    if (!paths || paths.length === 0) {
      process.stderr.write('Error: provide file/directory arguments or use --urls <file>\n');
      process.exitCode = 1;
      return;
    }

    await withBrain(async ({ db, embedder, config, modules }) => {
      const stats: ImportStats = { imported: new Map(), derived: 0, skipped: [], noteIds: [] };
      const contentHandlers = modules.getContentHandlers();

      const filePaths: string[] = [];
      for (const p of paths) {
        const abs = resolve(p);
        try {
          const s = statSync(abs);
          if (s.isDirectory()) {
            const entries = readdirSync(abs, { recursive: true }) as string[];
            for (const e of entries) {
              filePaths.push(join(abs, e));
            }
          } else {
            filePaths.push(abs);
          }
        } catch {
          stats.skipped.push({ path: p, reason: 'not found' });
        }
      }

      for (const filePath of filePaths) {
        const ext = extname(filePath).toLowerCase();

        if (!INDEXABLE_EXTENSIONS.has(ext)) {
          stats.skipped.push({ path: filePath, reason: `unsupported (${ext})` });
          continue;
        }

        try {
          if (statSync(filePath).isDirectory()) continue;
        } catch {
          stats.skipped.push({ path: filePath, reason: 'not found' });
          continue;
        }

        const rawContent = readFileSync(filePath, 'utf-8');
        if (!rawContent.trim()) {
          stats.skipped.push({ path: filePath, reason: 'empty' });
          continue;
        }

        const format = detectFormat(filePath, rawContent);
        const { markdown } = convertToMarkdown(filePath, rawContent);

        const splitResult = await splitDocument(markdown, filePath, embedder);

        const title = basename(filePath).replace(/\.[^.]+$/, '');
        const outPath = join(config.notesDir, 'imports', `${slugify(title)}.md`);
        mkdirSync(join(config.notesDir, 'imports'), { recursive: true });
        writeFileSync(outPath, markdown, 'utf-8');

        const hash = createHash('sha256').update(markdown).digest('hex');
        const sourceId = await indexSingleFile(db, embedder, outPath, markdown, hash, Date.now());
        stats.noteIds.push(sourceId);
        stats.imported.set(format, (stats.imported.get(format) ?? 0) + 1);

        for (const derived of splitResult.derivedNotes) {
          const handler = contentHandlers.find(
            (h) =>
              h.handler.contentClasses.includes(derived.contentClass) &&
              h.handler.canHandle({
                content: derived.content,
                contentClass: derived.contentClass,
                confidence: derived.confidence,
                method: 'deterministic',
                heading: null,
              })
          );

          if (handler) {
            const ids = await handler.handler.materialize(
              db,
              embedder,
              derived.content,
              {
                content: derived.content,
                contentClass: derived.contentClass,
                confidence: derived.confidence,
                method: 'deterministic',
                heading: null,
              },
              sourceId
            );
            stats.noteIds.push(...ids);
          } else {
            const derivedTitle = slugify(derived.suggestedTitle);
            const derivedPath = join(config.notesDir, 'imports', `${derivedTitle}.md`);
            const derivedMd = `---\ntitle: "${derived.suggestedTitle}"\ntype: ${derived.suggestedType}\ntier: fast\nstatus: draft\nrelated:\n  - ${sourceId}\n---\n\n${derived.content}\n`;
            writeFileSync(derivedPath, derivedMd, 'utf-8');
            const dHash = createHash('sha256').update(derivedMd).digest('hex');
            const derivedId = await indexSingleFile(
              db,
              embedder,
              derivedPath,
              derivedMd,
              dHash,
              Date.now()
            );
            db.upsertRelations(derivedId, [
              { sourceId: derivedId, targetId: sourceId, type: 'derived-from' },
            ]);
            stats.noteIds.push(derivedId);
          }
          stats.derived++;
        }
      }

      if (!opts.quiet) {
        const total = [...stats.imported.values()].reduce((a, b) => a + b, 0);
        process.stderr.write(`Imported ${total} file(s)`);
        if (stats.derived > 0) process.stderr.write(`, ${stats.derived} derived note(s)`);
        if (stats.skipped.length > 0) process.stderr.write(`, skipped ${stats.skipped.length}`);
        process.stderr.write('\n');
      }
    }, resolveOpts);
  });
