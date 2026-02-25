# Code Review — Deferred Items

Items found during deep reviews of `feat/memory-engine`. Organized by severity. Fixed items removed; remaining items have code TODOs where applicable.

## Minor — Services

### No retry logic for Ollama (`ollama.ts`)
A single network hiccup fails the entire extraction. No retry for transient 5xx errors.

### Reranker uses truncated 200-char excerpts (`reranker.ts:29`)
Cross-encoder reranking operates on partial content due to `EXCERPT_MAX_LENGTH = 200` truncation. Pass full chunk content for better reranking quality.

### Memory IDs sent to LLM are full UUIDs (`memory-extractor.ts`)
UUIDs consume tokens in the LLM context. Use short sequential IDs in the prompt and map them back.

### `applyActions` doesn't warn on unknown memory IDs (`memory-extractor.ts`)
When the LLM hallucinates a memory ID during reconciliation, the UPDATE/DELETE is silently skipped.

### `parseReconciliationResponse` regex is greedy (`memory-extractor.ts`)
`/\{[\s\S]*\}/` matches from first `{` to last `}`. Could grab wrong content if LLM outputs extra braces.

### Heading regex only matches h1-h3 (`markdown-parser.ts`)
H4-H6 headings are treated as body text. Intentional but undocumented.

### `ChunkType` has variants never produced by the parser (`types.ts`)
`'heading'`, `'code'`, `'list'`, `'blockquote'` are defined but never assigned.

### Chunk/embedding length mismatch not guarded (`note-repo.ts`)
`upsertChunks` assumes `chunks.length === embeddings.length` without asserting.

**Status:** TODO added in `note-repo.ts`.

---

## Minor — Commands

### `quick.ts` stdin fallback is unreachable
The `<text...>` argument is required. Commander errors before the action, so stdin fallback never runs. Should be `[text...]` (optional) if stdin piping is intended.

### `inbox.ts` mutually exclusive options not enforced
`--discard`, `--delete`, `--count`, and `--status` can all be passed together. Only the first matching branch runs.

### `feed.ts` URL validation only happens implicitly
`new URL(url)` throws a generic `TypeError` on invalid URLs.

### `extract.ts` creates embedder before validation
Config, DB, embedder, and LLM client are all created before note lookup that might exit early.

### `memories.ts` `parseInt` without validation
`--limit abc` produces `NaN`, `.slice(0, NaN)` returns empty array silently.

### `tidy.ts` content truncation hardcoded to 3000 chars
Magic number, unexplained and not configurable.

### `tidy.ts` system prompt in command file
`TIDY_SYSTEM` is domain/service logic embedded in the command layer.

---

## Minor — Tests

### `fusionStrategy: 'rrf'` not explicitly exercised in tests
The RRF code path is only tested indirectly.

### `rerank` option path untested
`options.rerank` branch in `search.ts` has no test coverage.

### `forgetExpiredMemories` history side-effect not verified
Tests check return count and `isForgotten` flag but never verify the `'forget'` event in `memory_history`.

### Multiple chunks not tested in memory extraction
Every extraction test seeds exactly one chunk.

### Eval harness `rechunkBody` diverges from production chunker
`harness.ts` reimplements section splitting without heading ancestry, code fence protection, or overlap.

---

## Fixed (this branch)

- ~~Tag filter uses substring matching~~ — fixed with comma-boundary matching
- ~~No timeout on Ollama fetch~~ — added 120s `AbortSignal.timeout`
- ~~Duplicated memory creation logic~~ — unified into shared `createMemory` helper
- ~~`splitOversizedSection` exceeds 30-line guideline~~ — extracted helper
- ~~`coerceSources` verbose casting~~ — simplified
- ~~`index-cmd.ts` watch mode prevents cleanup~~ — added SIGINT/SIGTERM handlers
- ~~`index-cmd.ts` deleted notes use O(n) scan~~ — fixed with `getNoteByFilePath`
- ~~`context.ts` N+1 queries~~ — fixed with batch `getNotesByIds`
- ~~Orphaned memory vectors on DELETE reconciliation~~ — added `deleteMemoryVector`
- ~~`updateInboxStatus('failed')` not tested~~ — covered in capture-repo tests
- ~~`getMemoriesForNote` isLatest filter not verified~~ — covered in memory-repo tests
- ~~Schema DDL duplication between schemaV1() and migrations~~ — extracted captureDDL/memoryDDL
- ~~Query branch duplication in memory-repo.ts~~ — extracted queryLatestMemories helper
