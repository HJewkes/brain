import { Command } from '@commander-js/extra-typings';
import { readFileSync } from 'node:fs';
import { withDb } from '../services/brain-service.js';
import { requireOllama } from '../services/ollama.js';

/** Max characters of note content sent to the tidy LLM call */
const TIDY_CONTENT_MAX_CHARS = 3000;

/** System prompt for the tidy LLM call */
const TIDY_SYSTEM = `You are a note quality reviewer. Given a note, provide brief, actionable suggestions to improve it.

Focus on:
- Missing or incomplete frontmatter (tags, summary, category)
- Notes that could be split into multiple focused notes
- Outdated information that should be reviewed
- Missing links to related notes
- Content that would benefit from a summary

Output 1-5 bullet points. Be specific and concise. If the note is well-structured, say so.`;

export const tidyCommand = new Command('tidy')
  .description('LLM-powered note cleanup suggestions')
  .option('--note <id>', 'Analyze a specific note')
  .option('--all', 'Analyze all notes')
  .option('--model <model>', 'Ollama model to use')
  .option('--json', 'Output as JSON')
  .option('--limit <n>', 'Max notes to analyze', '10')
  .action(async (opts) => {
    if (!opts.note && !opts.all) {
      process.stderr.write('Error: specify --note <id> or --all\n');
      process.exitCode = 1;
      return;
    }

    await withDb(async ({ db, config }) => {
      const llm = await requireOllama(config.ollamaUrl, opts.model ?? config.ollamaModel);
      if (!llm) return;

      const notes: Array<{ id: string; filePath: string; title: string }> = [];

      if (opts.note) {
        const note = db.getNoteById(opts.note);
        if (!note) {
          process.stderr.write(`Error: note "${opts.note}" not found\n`);
          process.exitCode = 1;
          return;
        }
        notes.push({ id: note.id, filePath: note.filePath, title: note.title });
      } else {
        const limit = parseInt(opts.limit, 10);
        const allNotes = db.getAllNotes();
        notes.push(
          ...allNotes.slice(0, limit).map((n) => ({
            id: n.id,
            filePath: n.filePath,
            title: n.title,
          }))
        );
      }

      const results: Array<{ noteId: string; title: string; suggestions: string }> = [];

      for (const note of notes) {
        process.stderr.write(`Analyzing ${note.title}...\n`);

        let content: string;
        try {
          content = readFileSync(note.filePath, 'utf-8');
        } catch {
          process.stderr.write(`  Skipping: file not found\n`);
          continue;
        }

        const truncated = content.slice(0, TIDY_CONTENT_MAX_CHARS);
        const suggestions = await llm.generate(truncated, TIDY_SYSTEM);
        results.push({ noteId: note.id, title: note.title, suggestions });
      }

      if (opts.json) {
        process.stdout.write(JSON.stringify(results) + '\n');
        return;
      }

      for (const r of results) {
        process.stdout.write(`\n${r.title} (${r.noteId})\n`);
        process.stdout.write(r.suggestions + '\n');
      }
    });
  });
