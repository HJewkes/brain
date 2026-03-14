import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../services/brain-service.js';
import { parentResolveOpts } from '../services/config.js';
import { requireOllama } from '../services/ollama.js';
import { DedupWindow, extractMemoriesFromNote } from '../services/memory-extractor.js';

export const extractCommand = new Command('extract')
  .description('Extract memories from indexed notes')
  .option('--note <id>', 'Extract from a specific note')
  .option('--all', 'Extract from all indexed notes')
  .option('--tag <tag>', 'Container tag for extracted memories', 'default')
  .option('--model <model>', 'Ollama model to use (default: qwen2.5:3b)')
  .option('--quiet', 'Suppress output')
  .option('--json', 'Output result as JSON')
  .action(async (opts, cmd) => {
    if (!opts.note && !opts.all) {
      process.stderr.write('Error: specify --note <id> or --all\n');
      process.exitCode = 1;
      return;
    }

    await withBrain(async ({ db, embedder, config }) => {
      const noteIds: string[] = [];

      if (opts.note) {
        const note = db.getNoteById(opts.note);
        if (!note) {
          process.stderr.write(`Error: note "${opts.note}" not found\n`);
          process.exitCode = 1;
          return;
        }
        noteIds.push(opts.note);
      } else {
        const allNotes = db.getAllNotes();
        noteIds.push(...allNotes.map((n) => n.id));
      }

      const llm = await requireOllama(config.ollamaUrl, opts.model ?? config.ollamaModel);
      if (!llm) return;

      db.setEmbeddingModel(embedder.model, embedder.dimensions);

      let totalFacts = 0;
      let totalCreated = 0;
      let totalUpdated = 0;
      let totalDeleted = 0;
      let processed = 0;
      const dedupWindow = new DedupWindow();

      for (const noteId of noteIds) {
        if (!opts.quiet && !opts.json) {
          process.stderr.write(`Extracting from ${noteId}...\n`);
        }

        const result = await extractMemoriesFromNote(db, llm, noteId, {
          containerTag: opts.tag,
          embedder,
          dedupWindow,
        });

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
    }, parentResolveOpts(cmd));
  });
