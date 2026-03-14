import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../services/brain-service.js';
import { parentResolveOpts } from '../services/config.js';
import { search, searchMemories, computeFacets } from '../services/search.js';
import { expandResults } from '../services/graph.js';
import { isJsonFormat } from './format.js';
import type { SearchOptions, SearchResult, FacetResult, TokenUsage } from '../types.js';
import type { EnrichedSearchResult } from '../services/relational-enrichment.js';

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
  .option('--intent <text>', 'filter results by stated intent/goal')
  .option('--multi-query', 'classify intent and expand into multiple sub-queries')
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
  .option('--enrich', 'show related notes for top results')
  .option('--show-cost', 'display token usage breakdown for the search')
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
        intent: opts.intent,
        multiQuery: opts.multiQuery,
        enrich: opts.enrich,
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

      const { results, tokenUsage } = await search(
        db,
        embedder,
        query,
        searchOpts,
        config.fusionWeights,
        modules
      );

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
            matchSource: 'graph',
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

      if (isJsonFormat(opts, cmd)) {
        const output: Record<string, unknown> = { notes: allResults, memories: memoryResults };
        if (facetResults.length > 0) {
          output.facets = Object.fromEntries(facetResults.map((f) => [f.field, f.values]));
        }
        if (opts.showCost) {
          output.tokenUsage = tokenUsage;
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
          process.stdout.write(`[${score}] (${r.matchSource}) ${r.filePath}\n`);
          if (r.heading) {
            process.stdout.write(`  \u00A7 ${r.heading}\n`);
          }
          if (r.excerpt) {
            process.stdout.write(`  ${r.excerpt}\n`);
          }
          const enriched = r as EnrichedSearchResult;
          if (enriched.relatedNotes?.length) {
            process.stdout.write('  Related:\n');
            for (const rel of enriched.relatedNotes) {
              const abstract = rel.abstract ? ` - ${rel.abstract}` : '';
              process.stdout.write(`    [${rel.relationType}] ${rel.title}${abstract}\n`);
            }
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
        if (opts.showCost) {
          printTokenUsage(tokenUsage);
        }
      }
    }, parentResolveOpts(cmd));
  });

function printTokenUsage(usage: TokenUsage): void {
  process.stderr.write('\n--- Token Usage ---\n');
  process.stderr.write(`  Query embedding:  ${usage.queryEmbedTokens}\n`);
  if (usage.rerankTokens > 0) {
    process.stderr.write(`  Reranking:        ${usage.rerankTokens}\n`);
  }
  if (usage.intentFilterTokens > 0) {
    process.stderr.write(`  Intent filtering: ${usage.intentFilterTokens}\n`);
  }
  process.stderr.write(`  Total:            ${usage.totalTokens}\n`);
}
