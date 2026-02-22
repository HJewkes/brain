import { Command } from '@commander-js/extra-typings';
import { loadConfig } from '../services/config.js';
import { BrainDB } from '../services/brain-db.js';
import { createEmbedder } from '../adapters/index.js';
import { createOllamaClient } from '../services/ollama.js';
import { extractMemoriesFromNote } from '../services/memory-extractor.js';

export const extractCommand = new Command('extract')
  .description('Extract memories from indexed notes')
  .option('--note <id>', 'Extract from a specific note')
  .option('--all', 'Extract from all indexed notes')
  .option('--tag <tag>', 'Container tag for extracted memories', 'default')
  .option('--model <model>', 'Ollama model to use (default: qwen2.5:3b)')
  .option('--quiet', 'Suppress output')
  .option('--json', 'Output result as JSON')
  .action(async (opts) => {
    if (!opts.note && !opts.all) {
      console.error('Error: specify --note <id> or --all');
      process.exitCode = 1;
      return;
    }

    const config = loadConfig();
    const db = new BrainDB(config.dbPath);
    const embedder = createEmbedder(config);
    const llm = createOllamaClient(
      config.ollamaUrl,
      opts.model ?? config.ollamaModel
    );

    try {
      db.setEmbeddingModel(embedder.model, embedder.dimensions);
      const noteIds: string[] = [];

      if (opts.note) {
        const note = db.getNoteById(opts.note);
        if (!note) {
          console.error(`Error: note "${opts.note}" not found`);
          process.exitCode = 1;
          return;
        }
        noteIds.push(opts.note);
      } else {
        const allNotes = db.getAllNotes();
        noteIds.push(...allNotes.map((n) => n.id));
      }

      let totalFacts = 0;
      let totalCreated = 0;
      let totalUpdated = 0;
      let totalDeleted = 0;
      let processed = 0;

      for (const noteId of noteIds) {
        if (!opts.quiet && !opts.json) {
          process.stderr.write(`Extracting from ${noteId}...\n`);
        }

        const result = await extractMemoriesFromNote(
          db,
          llm,
          noteId,
          opts.tag,
          embedder
        );

        totalFacts += result.facts.length;
        totalCreated += result.memoriesCreated;
        totalUpdated += result.memoriesUpdated;
        totalDeleted += result.memoriesDeleted;
        processed++;
      }

      const summary = {
        processed,
        factsExtracted: totalFacts,
        memoriesCreated: totalCreated,
        memoriesUpdated: totalUpdated,
        memoriesDeleted: totalDeleted,
        totalMemories: db.getMemoryCount(),
      };

      if (opts.json) {
        process.stdout.write(JSON.stringify(summary) + '\n');
      } else if (!opts.quiet) {
        process.stderr.write(
          `Processed ${processed} note(s): ${totalFacts} facts, +${totalCreated} ~${totalUpdated} -${totalDeleted} memories\n`
        );
        process.stderr.write(`Total active memories: ${summary.totalMemories}\n`);
      }
    } finally {
      db.close();
    }
  });
