# Brain v0.1 Review Fixes Design

> Fixes for all 18 findings from the comprehensive code review.

## Context

After completing the initial 11-task build of the `brain` CLI, a full code review identified 3 critical, 7 important, and 8 minor issues. This design covers fixes for all 18.

## Critical Fixes

### 1. FTS5 Query Sanitization

**Problem:** User search queries are passed directly to FTS5 `MATCH`. Special characters (`"`, `*`, `OR`, `AND`, `NOT`, `NEAR`, `^`, parens) are interpreted by the FTS5 parser. Malformed queries (e.g., unbalanced quotes) crash the process.

**Fix:** Add `sanitizeFtsQuery()` to `brain-db.ts` that splits the query into tokens and wraps each in double quotes with escaped internal quotes. Applied inside `searchFTS()` before the MATCH call.

```
"hello world" → "hello" "world"
'test OR *' → "test" "OR" "*"
'"unbalanced → "\"unbalanced"
```

**Files:** `src/services/brain-db.ts`, `__tests__/services/brain-db.test.ts`

### 2. Dynamic Vector Dimensions

**Problem:** Schema hardcodes `float[384]` for `chunk_vectors`, but Ollama/Remote embedders produce 768-dim vectors. Only the local embedder works.

**Fix:** Remove `VECTOR_DIMENSIONS = 384`. Create `chunk_vectors` lazily:
- `schemaV1()` creates all tables except `chunk_vectors`
- New `ensureVectorTable(dimensions: number)` method creates or recreates the vec0 table
- Called from `setEmbeddingModel()` — when dimensions change, drop and recreate
- `upsertChunks()` calls `ensureVectorTable()` as a safety check
- Existing `--force` flow integrates cleanly (already clears chunks/vectors)

**Files:** `src/services/brain-db.ts`, `__tests__/services/brain-db.test.ts`

### 3. Pass Config Fusion Weights to Search

**Problem:** `search()` uses hardcoded `0.3`/`0.7` weights. The `config.fusionWeights` setting is stored but ignored.

**Fix:** Add `fusionWeights` parameter to `search()` signature. Commands pass `config.fusionWeights`. Remove `DEFAULT_BM25_WEIGHT`/`DEFAULT_VECTOR_WEIGHT` constants.

**Files:** `src/services/search.ts`, `src/commands/search.ts`, `__tests__/services/search.test.ts`

## Important Fixes

### 4. Add Search Methods to BrainDB

**Problem:** `search.ts` casts into `BrainDB`'s private `db` field via `(brainDb as unknown as { db: Database.Database }).db`.

**Fix:** Add public methods to `BrainDB`:
- `searchVector(embedding: Float32Array, limit: number): VectorResult[]`
- `getFilteredNoteIds(options: { tier?, category?, confidence?, since?, tags? }): Set<string> | null`
- `getChunkContent(chunkId: string): string`
- `getFirstChunkForNote(noteId: string): { content: string; heading: string | null } | null`
- `getChunkHeading(chunkId: string | null, noteId: string): string | null`

Remove `getInternalDb()` and all raw DB access from `search.ts`.

**Files:** `src/services/brain-db.ts`, `src/services/search.ts`, `__tests__/services/brain-db.test.ts`, `__tests__/services/search.test.ts`

### 5. Fix N+1 Query in Index Command

**Problem:** `db.getAllNotes()` called inside the deleted-files loop.

**Fix:** Hoist `getAllNotes()` above the loop. Also add `getNoteByFilePath(path: string): NoteRecord | null` to `BrainDB` using the UNIQUE index on `file_path`.

**Files:** `src/services/brain-db.ts`, `src/commands/index-cmd.ts`

### 6. Add Index on chunks.note_id

**Problem:** No index for the frequent `WHERE note_id = ?` lookups on the chunks table.

**Fix:** Add `CREATE INDEX IF NOT EXISTS idx_chunks_note_id ON chunks(note_id)` to schema. For existing DBs, add a `schemaV2()` migration that runs when `user_version < 2`.

**Files:** `src/services/brain-db.ts`

### 7. Integration Test Config Isolation

**Problem:** Tests overwrite the user's global config at `~/Library/Preferences/brain/config.json`.

**Fix:** Add `--config-dir <path>` and `--db-path <path>` global options to `cli.ts`. Integration tests pass temp paths. Also useful for users running multiple brain instances.

**Files:** `src/cli.ts`, `__tests__/integration/cli.test.ts`

### 8. Handle parseAsync Rejection

**Problem:** `program.parseAsync()` return value is not caught. Async errors become unhandled rejections.

**Fix:** Add `.catch()` that prints `err.message` to stderr and sets `process.exitCode = 1`.

**Files:** `src/cli.ts`

### 9. Consistent Interval Parsing

**Problem:** `stale.ts` only parses `Nd` format; `status.ts` parses `d`, `w`, `m`. Intervals like `4w` silently fall back to 90 days in stale.

**Fix:** Extract `parseIntervalDays(interval: string): number` to `src/utils.ts` supporting `d`/`w`/`m`. Use in both commands.

**Files:** `src/utils.ts` (new), `src/commands/stale.ts`, `src/commands/status.ts`, `__tests__/utils.test.ts` (new)

### 10. Chunk Overlap Token Budget

**Problem:** Overlap prefix is prepended to chunks but not subtracted from the token budget. Chunks with overlap can exceed `MAX_CHUNK_TOKENS`.

**Fix:** In `splitOversizedSection()`, subtract overlap prefix token count from the available budget for new content.

**Files:** `src/services/markdown-parser.ts`, `__tests__/services/markdown-parser.test.ts`

## Minor Fixes

### 11. Extract Shared Test Helper

**Problem:** `makeNote()` factory copy-pasted across 3 test files.

**Fix:** Create `__tests__/helpers.ts` with shared factory. Update imports in `brain-db.test.ts`, `graph.test.ts`, `search.test.ts`.

**Files:** `__tests__/helpers.ts` (new), 3 test files

### 12. Add `guide` to Template Command

**Problem:** `brain template guide` errors despite `guide` being a valid `NoteType`.

**Fix:** Add `guide` template with appropriate fields and body sections.

**Files:** `src/commands/template.ts`

### 13. Validate `--type` and `--tier` in Add Command

**Problem:** `brain add --type banana` silently creates invalid notes.

**Fix:** Validate against the union values. Error early with clear message.

**Files:** `src/commands/add.ts`

### 14. Fix Type-to-Directory Mapping

**Problem:** `${type}s` produces `researchs` instead of `research`. Also `meeting` → `meetings` but init creates `logs`.

**Fix:** Use explicit `TYPE_DIRS` map:
```typescript
const TYPE_DIRS: Record<NoteType, string> = {
  note: 'notes', decision: 'decisions', research: 'research',
  pattern: 'patterns', meeting: 'logs', 'session-log': 'logs', guide: 'notes',
}
```

**Files:** `src/commands/add.ts`

### 15. Config Set Type Validation

**Problem:** `brain config set notesDir true` silently writes boolean where string is expected.

**Fix:** Before saving, check `typeof newValue` matches `typeof existingValue`.

**Files:** `src/commands/config.ts`

### 16. Archive: Update FTS and File Record

**Problem:** After moving a file, FTS entry and file record still reference the old path.

**Fix:** Update file record path and re-insert FTS entry after move.

**Files:** `src/commands/archive.ts`

### 17. Lazy Embedder Import in Init

**Problem:** `createEmbedder(config)` in init triggers heavy `@huggingface/transformers` import just to read model name and dimensions.

**Fix:** Static lookup map for model/dimensions by backend type. Only import the actual embedder when embedding is needed (in `index` and `search`).

**Files:** `src/commands/init.ts`, `src/adapters/index.ts`

### 18. Remote Embedder Fetch Timeout

**Problem:** No timeout on HTTP fetch. Hanging server hangs the CLI indefinitely.

**Fix:** Add `signal: AbortSignal.timeout(30_000)` to fetch options. Catch `AbortError` with clear message.

**Files:** `src/adapters/remote-embedder.ts`

## Task Grouping

Tasks are grouped by dependency:

- **Wave 1** (DB layer): Fixes 2, 4, 5, 6 — all modify `brain-db.ts`
- **Wave 2** (services): Fixes 1, 3, 10 — modify search.ts, markdown-parser.ts
- **Wave 3** (CLI + commands): Fixes 7, 8, 9, 12, 13, 14, 15, 16, 17 — command files
- **Wave 4** (adapters + tests): Fixes 18, 11 — adapter and test cleanup
