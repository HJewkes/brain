# Code Review — Deferred Items

Items found during deep reviews of `feat/memory-engine`. Organized by severity. Fixed items removed; remaining items have code TODOs where applicable.

## Minor — Services

### No retry logic for Ollama (`ollama.ts`)
A single network hiccup fails the entire extraction. No retry for transient 5xx errors.

### Memory IDs sent to LLM are full UUIDs (`memory-extractor.ts`)
UUIDs consume tokens in the LLM context. Use short sequential IDs in the prompt and map them back.

### `applyActions` doesn't warn on unknown memory IDs (`memory-extractor.ts`)
When the LLM hallucinates a memory ID during reconciliation, the UPDATE/DELETE is silently skipped.

### `parseReconciliationResponse` regex is greedy (`memory-extractor.ts`)
`/\{[\s\S]*\}/` matches from first `{` to last `}`. Could grab wrong content if LLM outputs extra braces.

### Heading regex only matches h1-h3 (`markdown-parser.ts`)
H4-H6 headings are treated as body text. Intentional but undocumented.

### `tidy.ts` system prompt in command file
`TIDY_SYSTEM` is domain/service logic embedded in the command layer.

---

## Minor — Tests

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

---

## Resolved in v0.4.0

The following items from the original deferred list were addressed during the v0.4.0 polish pass (Tasks 01–07):

### Commands
- ~~`quick.ts` stdin fallback is unreachable~~ — argument made optional (`[text...]`); stdin path is now reachable
- ~~`memories.ts` `parseInt` without validation~~ — added `Number.isNaN` guard; invalid `--limit` values now error clearly
- ~~`inbox.ts` mutually exclusive options not enforced~~ — added explicit mutual-exclusion check with `program.error`
- ~~`feed.ts` URL validation only happens implicitly~~ — now wraps `new URL()` and surfaces a user-friendly error
- ~~`extract.ts` creates embedder before validation~~ — note lookup moved before resource initialisation; early exit is now clean
- ~~`tidy.ts` content truncation hardcoded to 3000 chars~~ — magic number extracted to named constant `TIDY_CONTENT_MAX_LENGTH`

### Services
- ~~Reranker uses truncated 200-char excerpts (`reranker.ts:29`)~~ — full chunk content now passed to the cross-encoder; `EXCERPT_MAX_LENGTH` constant removed
- ~~Chunk/embedding length mismatch not guarded (`note-repo.ts`)~~ — assertion added; mismatch now throws before any DB write
- ~~`ChunkType` has variants never produced by the parser (`types.ts`)~~ — dead variants (`'heading'`, `'code'`, `'list'`, `'blockquote'`) removed from the union

### Tests
- ~~`fusionStrategy: 'rrf'` not explicitly exercised in tests~~ — dedicated RRF test added to `search.test.ts`
- ~~`rerank` option path untested~~ — `options.rerank` branch covered in `search.test.ts`
- ~~`forgetExpiredMemories` history side-effect not verified~~ — test now queries `memory_history` and asserts the `'forget'` event
- ~~Multiple chunks not tested in memory extraction~~ — multi-chunk fixture added to `memory-extractor.test.ts`
