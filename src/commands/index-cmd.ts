import { Command } from '@commander-js/extra-typings';
import { readFileSync, watch } from 'node:fs';
import { basename } from 'node:path';
import { loadConfig } from '../services/config.js';
import { BrainDB } from '../services/brain-db.js';
import { createEmbedder } from '../adapters/index.js';
import { createOllamaClient } from '../services/ollama.js';
import { extractMemoriesFromNote } from '../services/memory-extractor.js';
import { scanForChanges } from '../services/file-scanner.js';
import {
  indexSingleFile,
  indexFiles,
  processInbox,
  generateNoteIndex,
} from '../services/indexing.js';
import type { Embedder } from '../types.js';

export const indexCommand = new Command('index')
  .description('Index new and modified notes')
  .option('--force', 'force full re-index (clears all chunks/vectors)')
  .option('--quiet', 'suppress output')
  .option('--json', 'output result as JSON')
  .option('--inbox', 'also process pending inbox items into notes')
  .option('--extract', 'extract memories from indexed notes after indexing')
  .option('--extract-model <model>', 'Ollama model for extraction (default: qwen2.5:3b)')
  .option('--extract-tag <tag>', 'container tag for extracted memories', 'default')
  .option('--watch', 'watch for file changes and re-index automatically')
  .action(async (opts) => {
    const config = loadConfig();
    const db = new BrainDB(config.dbPath);
    const embedder = createEmbedder(config);

    try {
      const result = await indexFiles(db, embedder, config.notesDir, {
        force: opts.force,
      });

      let inboxProcessed = 0;
      if (opts.inbox) {
        inboxProcessed = await processInbox(db, config.notesDir, embedder);
      }

      let memoriesExtracted = 0;
      if (opts.extract && result.indexedNoteIds.length > 0) {
        memoriesExtracted = await extractFromNotes(
          db,
          embedder,
          result.indexedNoteIds,
          config.ollamaUrl,
          opts.extractModel ?? config.ollamaModel,
          opts.extractTag ?? 'default',
          opts.quiet
        );
      }

      generateNoteIndex(db, config.notesDir);

      const summary = {
        indexed: result.indexed,
        deleted: result.deleted,
        unchanged: result.unchanged,
        inboxProcessed,
        memoriesExtracted,
        total: db.getAllNotes().length,
      };

      if (opts.json) {
        process.stdout.write(JSON.stringify(summary) + '\n');
      } else if (!opts.quiet) {
        process.stderr.write(
          `Indexed ${result.indexed} file(s), deleted ${result.deleted}, unchanged ${result.unchanged}\n`
        );
        if (inboxProcessed > 0) {
          process.stderr.write(`Inbox: processed ${inboxProcessed} item(s)\n`);
        }
        if (memoriesExtracted > 0) {
          process.stderr.write(`Memories: extracted ${memoriesExtracted} from indexed notes\n`);
        }
        process.stderr.write(`Total notes: ${summary.total}\n`);
      }

      if (opts.watch) {
        startWatcher(db, embedder, config.notesDir);
        await new Promise(() => {});
      }
    } finally {
      db.close();
    }
  });

function startWatcher(db: BrainDB, embedder: Embedder, notesDir: string): void {
  process.stderr.write(`Watching ${notesDir} for changes...\n`);

  const isSkipped = (filePath: string): boolean =>
    filePath.includes('/_templates/') || basename(filePath) === '_index.md';

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const reindex = async () => {
    const knownFiles = db.getAllFiles();
    const changes = await scanForChanges(notesDir, knownFiles);
    const toProcess = [...changes.new, ...changes.modified].filter(
      (f) => !isSkipped(f.path)
    );

    for (const file of toProcess) {
      const content = readFileSync(file.path, 'utf-8');
      await indexSingleFile(db, embedder, file.path, content, file.hash, file.mtime);
      process.stderr.write(`  Re-indexed: ${file.path}\n`);
    }

    if (toProcess.length > 0) {
      generateNoteIndex(db, notesDir);
    }
  };

  watch(notesDir, { recursive: true }, (_event, filename) => {
    if (!filename || !filename.endsWith('.md')) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      reindex().catch((err) => {
        process.stderr.write(
          `Watch error: ${err instanceof Error ? err.message : String(err)}\n`
        );
      });
    }, 500);
  });
}

async function extractFromNotes(
  db: BrainDB,
  embedder: Embedder,
  noteIds: string[],
  ollamaUrl?: string,
  model?: string,
  containerTag: string = 'default',
  quiet?: boolean
): Promise<number> {
  const llm = createOllamaClient(ollamaUrl, model);
  let total = 0;

  for (const noteId of noteIds) {
    try {
      const result = await extractMemoriesFromNote(
        db,
        llm,
        noteId,
        containerTag,
        embedder
      );
      total += result.memoriesCreated + result.memoriesUpdated;
    } catch (err) {
      if (!quiet) {
        process.stderr.write(
          `Memory extraction failed for ${noteId}: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }
  }

  return total;
}
