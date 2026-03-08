import { Command } from '@commander-js/extra-typings';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { withBrain } from '../services/brain-service.js';
import { parentResolveOpts } from '../services/config.js';
import { detectFormat, convertToMarkdown } from '../services/format-adapters/index.js';
import { INDEXABLE_EXTENSIONS } from '../services/file-scanner.js';
import { indexSingleFile } from '../services/indexing.js';
import { runExtractionPipeline } from '../services/extraction-pipeline.js';
import { slugify } from '../utils.js';

interface ImportStats {
  imported: Map<string, number>;
  extracted: Map<string, number>;
  materialized: number;
  plainNotes: number;
  handlerDispatches: Map<string, number>;
  queuedFiles: Array<{ path: string; reason: string }>;
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
  .option('--dry-run', 'Show what would be imported without creating notes')
  .option('--tier <n>', 'Max extraction tier (1=deterministic, 2=+LLM, 3=full)', '3')
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
            await indexSingleFile(
              db,
              embedder,
              `url-${slugify(url)}.md`,
              markdown,
              hash,
              Date.now()
            );
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

    const maxTier = Math.max(1, Math.min(3, parseInt(opts.tier, 10) || 3)) as 1 | 2 | 3;
    const dryRun = opts.dryRun ?? false;

    await withBrain(async ({ db, embedder, config, modules }) => {
      const stats: ImportStats = {
        imported: new Map(),
        extracted: new Map(),
        materialized: 0,
        plainNotes: 0,
        handlerDispatches: new Map(),
        queuedFiles: [],
        skipped: [],
        noteIds: [],
      };

      // Ensure content handlers have config set (e.g. PmContentHandler)
      for (const { handler } of modules.getContentHandlers()) {
        if ('setConfig' in handler && typeof handler.setConfig === 'function') {
          (handler as { setConfig: (c: typeof config) => void }).setConfig(config);
        }
      }

      const SKIP_DIRS = new Set([
        'node_modules',
        '.git',
        '.hg',
        '.svn',
        'dist',
        'build',
        '.next',
        '.nuxt',
        '.output',
        '__pycache__',
        '.tox',
        'venv',
        '.venv',
        '.playwright-mcp',
      ]);

      const filePaths: string[] = [];
      for (const p of paths) {
        const abs = resolve(p);
        try {
          const s = statSync(abs);
          if (s.isDirectory()) {
            collectFiles(abs, filePaths, SKIP_DIRS);
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

        // Index the source note
        const title = basename(filePath).replace(/\.[^.]+$/, '');
        const outPath = join(config.notesDir, 'imports', `${slugify(title)}.md`);

        let sourceId: string;
        if (!dryRun) {
          mkdirSync(join(config.notesDir, 'imports'), { recursive: true });
          writeFileSync(outPath, markdown, 'utf-8');
          const hash = createHash('sha256').update(markdown).digest('hex');
          sourceId = await indexSingleFile(db, embedder, outPath, markdown, hash, Date.now());
        } else {
          sourceId = `dry-run-${slugify(title)}`;
        }

        stats.noteIds.push(sourceId);
        stats.imported.set(format, (stats.imported.get(format) ?? 0) + 1);

        // Run extraction pipeline
        const pipelineResult = dryRun
          ? await runDryExtraction(markdown, filePath, modules, embedder)
          : await runExtractionPipeline(
              markdown,
              filePath,
              modules,
              embedder,
              db,
              config,
              sourceId,
              { maxTier }
            );

        // Track extracted item types
        for (const item of pipelineResult.extracted) {
          stats.extracted.set(item.noteType, (stats.extracted.get(item.noteType) ?? 0) + 1);
        }

        // Track materialized count
        stats.materialized += pipelineResult.materializedNoteIds.length;
        stats.noteIds.push(...pipelineResult.materializedNoteIds);
        stats.queuedFiles.push(...pipelineResult.queuedFiles);

        // Track handler dispatches by checking which extracted items were materialized
        for (const { module, handler } of modules.getContentHandlers()) {
          const handledCount = pipelineResult.extracted.filter((item) =>
            handler.noteTypes.includes(item.noteType)
          ).length;
          if (handledCount > 0) {
            stats.handlerDispatches.set(
              module,
              (stats.handlerDispatches.get(module) ?? 0) + handledCount
            );
          }
        }

        // Write unhandled items as plain notes
        const handledTypes = new Set(
          modules.getContentHandlers().flatMap(({ handler }) => handler.noteTypes)
        );
        const unhandled = pipelineResult.extracted.filter(
          (item) => !handledTypes.has(item.noteType)
        );

        for (const item of unhandled) {
          if (dryRun) {
            stats.plainNotes++;
            continue;
          }
          const derivedTitle = slugify(item.title);
          const derivedPath = join(config.notesDir, 'imports', `${derivedTitle}.md`);
          const derivedMd = `---\ntitle: "${item.title}"\ntype: ${item.noteType}\ntier: fast\nstatus: draft\nrelated:\n  - ${sourceId}\n---\n\n${item.content}\n`;
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
          stats.plainNotes++;
        }
      }

      printOutput(stats, opts, dryRun, maxTier);
    }, resolveOpts);
  });

/** Walk a directory tree, skipping common non-content directories. */
function collectFiles(dir: string, out: string[], skipDirs: Set<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out, skipDirs);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      out.push(full);
    }
  }
}

/**
 * Dry-run extraction: runs the deterministic tier only (no DB writes).
 * Imports the tier function directly to avoid needing db/config.
 */
async function runDryExtraction(
  markdown: string,
  filePath: string,
  registry: Parameters<typeof runExtractionPipeline>[2],
  embedder: Parameters<typeof runExtractionPipeline>[3]
): Promise<{
  extracted: Array<{
    noteType: string;
    title: string;
    content: string;
    fields: Record<string, string>;
  }>;
  materializedNoteIds: string[];
  queuedFiles: Array<{ path: string; reason: string }>;
}> {
  const { extractDeterministic } = await import('../services/extraction-tiers/deterministic.js');
  const tier1 = await extractDeterministic(markdown, filePath, registry, embedder);

  const extracted = [...tier1.items];
  if (tier1.remainder && tier1.remainder.trim().length > 20) {
    extracted.push({
      noteType: 'note',
      title:
        filePath
          .split('/')
          .pop()
          ?.replace(/\.[^.]+$/, '') ?? 'Imported',
      content: tier1.remainder,
      fields: {},
    });
  }

  return { extracted, materializedNoteIds: [], queuedFiles: [] };
}

function printOutput(
  stats: ImportStats,
  opts: { json?: true; quiet?: true },
  dryRun: boolean,
  maxTier: 1 | 2 | 3
): void {
  if (opts.json) {
    const report = {
      dryRun,
      maxTier,
      imported: Object.fromEntries(stats.imported),
      extracted: Object.fromEntries(stats.extracted),
      materialized: stats.materialized,
      plainNotes: stats.plainNotes,
      handlers: Object.fromEntries(stats.handlerDispatches),
      queued: stats.queuedFiles,
      skipped: stats.skipped,
      noteIds: stats.noteIds,
    };
    process.stdout.write(JSON.stringify(report) + '\n');
    return;
  }

  if (opts.quiet) return;

  const total = [...stats.imported.values()].reduce((a, b) => a + b, 0);
  const prefix = dryRun ? '[dry-run] Would import' : 'Imported';
  const formats = [...stats.imported.entries()].map(([fmt, count]) => `${count} ${fmt}`).join(', ');

  process.stderr.write(`${prefix} ${total} file(s) (${formats})\n`);

  if (stats.extracted.size > 0) {
    const totalExtracted = [...stats.extracted.values()].reduce((a, b) => a + b, 0);
    const types = [...stats.extracted.entries()].map(([t, count]) => `${count} ${t}`).join(', ');
    process.stderr.write(`  Tier 1 (deterministic): ${totalExtracted} items (${types})\n`);
  }

  if (stats.materialized > 0) {
    process.stderr.write(`  Materialized: ${stats.materialized} note(s) via handlers\n`);
  }

  if (stats.plainNotes > 0) {
    const verb = dryRun ? 'Would write' : 'Wrote';
    process.stderr.write(`  ${verb}: ${stats.plainNotes} plain note(s)\n`);
  }

  if (stats.handlerDispatches.size > 0) {
    const handlers = [...stats.handlerDispatches.entries()]
      .map(([mod, count]) => `${count} via ${mod}`)
      .join(', ');
    process.stderr.write(`  Handlers: ${handlers}\n`);
  }

  if (stats.queuedFiles.length > 0) {
    process.stderr.write(`  Tier 3 (queued): ${stats.queuedFiles.length} file(s)\n`);
  }

  if (stats.skipped.length > 0) {
    process.stderr.write(`  Skipped: ${stats.skipped.length} file(s)\n`);
    for (const s of stats.skipped.slice(0, 5)) {
      process.stderr.write(`    ${s.path}: ${s.reason}\n`);
    }
    if (stats.skipped.length > 5) {
      process.stderr.write(`    ... and ${stats.skipped.length - 5} more\n`);
    }
  }
}
