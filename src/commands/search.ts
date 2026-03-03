import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../services/brain-service.js';
import { parentResolveOpts } from '../services/config.js';
import { search, searchMemories, computeFacets } from '../services/search.js';
import { expandResults } from '../services/graph.js';
import type { SearchOptions, SearchResult, FacetResult } from '../types.js';

export const searchCommand = new Command('search')
  .description('Search notes with hybrid BM25 + vector search')
  .argument('<query>', 'search query')
  .option('--json', 'output results as JSON')
  .option('--limit <n>', 'max results', '10')
  .option('--tier <tier>', 'filter by tier (slow, fast)')
  .option('--tags <tags>', 'filter by tags (comma-separated)')
  .option('--category <cat>', 'filter by category')
  .option('--confidence <level>', 'filter by confidence')
  .option('--since <date>', 'only notes modified after this date')
  .option('--min-score <score>', 'minimum relevance score (0-1)')
  .option('--dropoff <pct>', 'cut results when score drops by this percentage (e.g. 30)')
  .option('--rerank', 'apply cross-encoder reranking for better relevance')
  .option('--include-tasks', 'include PM task notes in search results')
  .option('--exclude-pm', 'exclude project management notes from results')
  .option('--expand', 'include graph-connected notes')
  .option('--memories', 'also search extracted memories')
  .option('--container <tag>', 'filter memories by container tag')
  .option('--workstream <id>', 'filter by workstream (number or display ID)')
  .option('--type <type>', 'filter by note type (e.g. task, project, note)')
  .option('--module <module>', 'filter by module (e.g. pm)')
  .option('--title', 'Search titles only (excludes body matches)')
  .option('--project <prefix>', 'Filter results to a specific project')
  .option('--filter <expr...>', 'Filter by frontmatter field (field=value, repeatable)')
  .option('--facet <field...>', 'Show facet counts for a frontmatter field (repeatable)')
  .action(async (query, opts, cmd) => {
    await withBrain(async ({ db, embedder, config, modules }) => {
      const searchOpts: SearchOptions = {
        limit: parseInt(opts.limit, 10),
        tier: opts.tier as SearchOptions['tier'],
        tags: opts.tags ? opts.tags.split(',').map((t) => t.trim()) : undefined,
        category: opts.category,
        confidence: opts.confidence as SearchOptions['confidence'],
        since: opts.since,
        minScore: opts.minScore ? parseFloat(opts.minScore) : undefined,
        dropoff: opts.dropoff ? parseFloat(opts.dropoff) / 100 : undefined,
        rerank: opts.rerank,
        includePm: opts.includeTasks,
        excludePm: opts.excludePm,
      };

      if (opts.filter) {
        searchOpts.filters = opts.filter.map((expr: string) => {
          const eqIdx = expr.indexOf('=');
          if (eqIdx === -1) {
            process.stderr.write(`Invalid filter: "${expr}" (expected field=value)\n`);
            process.exit(1);
          }
          return { field: expr.slice(0, eqIdx), value: expr.slice(eqIdx + 1) };
        });
      }
      if (opts.facet) {
        searchOpts.facets = opts.facet;
      }

      const results = await search(db, embedder, query, searchOpts, config.fusionWeights, modules);

      const expanded: SearchResult[] = [];
      if (opts.expand && results.length > 0) {
        const noteIds = results.map((r) => r.noteId);
        const graphExpanded = expandResults(db, noteIds, 1);

        for (const item of graphExpanded) {
          const note = db.getNoteById(item.noteId);
          if (!note) continue;
          expanded.push({
            score: item.decayedScore,
            filePath: note.filePath,
            noteId: note.id,
            heading: null,
            excerpt: note.summary ?? '',
            tier: note.tier,
            tags: note.tags ? note.tags.split(',') : [],
            confidence: note.confidence,
          });
        }
      }

      let allResults = [...results, ...expanded];

      if (opts.excludePm && !opts.includeTasks) {
        allResults = allResults.filter((r) => {
          const note = db.getNoteById(r.noteId);
          if (!note) return true;
          const meta = note.metadata ? JSON.parse(note.metadata) : null;
          return meta?.visibility !== 'private';
        });
      }

      if (opts.project) {
        allResults = allResults.filter((r) => {
          const note = db.getNoteById(r.noteId);
          if (!note) return false;
          const meta = note.metadata ? JSON.parse(note.metadata) : null;
          const noteProject = meta?.project as string | undefined;
          return noteProject?.toUpperCase() === opts.project!.toUpperCase();
        });
      }

      if (opts.type || opts.module || opts.workstream) {
        allResults = allResults.filter((r) => {
          const note = db.getNoteById(r.noteId);
          if (!note) return false;
          if (opts.type && note.type !== opts.type) return false;
          if (opts.module && note.module !== opts.module) return false;
          if (opts.workstream) {
            const meta = note.metadata ? JSON.parse(note.metadata) : null;
            if (!meta) return false;
            const wsNum = parseInt(opts.workstream, 10);
            if (!isNaN(wsNum)) {
              if (meta.workstream !== wsNum) return false;
            } else {
              if (meta.workstream_display_id !== opts.workstream.toUpperCase()) return false;
            }
          }
          return true;
        });
      }

      if (opts.title) {
        allResults = allResults.filter((r) => {
          const note = db.getNoteById(r.noteId);
          if (!note) return false;
          return note.title?.toLowerCase().includes(query.toLowerCase());
        });
      } else {
        allResults.sort((a, b) => {
          const noteA = db.getNoteById(a.noteId);
          const noteB = db.getNoteById(b.noteId);
          const aTitle = noteA?.title?.toLowerCase().includes(query.toLowerCase()) ? 1 : 0;
          const bTitle = noteB?.title?.toLowerCase().includes(query.toLowerCase()) ? 1 : 0;
          if (aTitle !== bTitle) return bTitle - aTitle;
          return (b.score ?? 0) - (a.score ?? 0);
        });
      }

      const memoryResults = opts.memories
        ? await searchMemories(db, embedder, query, parseInt(opts.limit, 10), opts.container)
        : [];

      // Compute facets if requested
      let facetResults: FacetResult[] = [];
      if (opts.facet?.length && allResults.length > 0) {
        const resultNoteIds = new Set(allResults.map((r) => r.noteId));
        facetResults = computeFacets(db, opts.facet, resultNoteIds);
      }

      if (opts.json) {
        const output: Record<string, unknown> = { notes: allResults, memories: memoryResults };
        if (facetResults.length > 0) {
          output.facets = Object.fromEntries(facetResults.map((f) => [f.field, f.values]));
        }
        process.stdout.write(JSON.stringify(output) + '\n');
      } else {
        if (allResults.length === 0 && memoryResults.length === 0) {
          process.stderr.write(`No results found for "${query}".\n\n`);
          process.stderr.write('Suggestions:\n');
          process.stderr.write('  - Try broader search terms\n');
          process.stderr.write('  - Use brain pm task list --search "<term>" for PM task search\n');
          process.stderr.write('  - Use brain pm status <prefix> for project overview\n');
          return;
        }
        for (const r of allResults) {
          const score = r.score.toFixed(3);
          process.stdout.write(`[${score}] ${r.filePath}\n`);
          if (r.heading) {
            process.stdout.write(`  \u00A7 ${r.heading}\n`);
          }
          if (r.excerpt) {
            process.stdout.write(`  ${r.excerpt}\n`);
          }
          process.stdout.write('\n');
        }
        if (memoryResults.length > 0) {
          process.stdout.write('--- Memories ---\n\n');
          for (const m of memoryResults) {
            const score = m.score.toFixed(3);
            process.stdout.write(`[${score}] ${m.memory}\n`);
            process.stdout.write(`  source: ${m.sourceNoteId} | tag: ${m.containerTag}\n\n`);
          }
        }
        if (facetResults.length > 0) {
          process.stdout.write('Facets:\n');
          for (const facet of facetResults) {
            const summary = facet.values
              .slice(0, 10)
              .map((v) => `${v.value} (${v.count})`)
              .join(', ');
            process.stdout.write(`  ${facet.field}: ${summary}\n`);
          }
        }
      }
    }, parentResolveOpts(cmd));
  });
