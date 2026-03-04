# Task 07: Import Command Refactor

## Architectural Context

`src/commands/import.ts` is the CLI entry point for `brain import [paths...]`. Currently it: reads files → detects format → converts to markdown → splits/classifies with `splitDocument` → dispatches derived sections to content handlers or writes plain notes. This task replaces the split/classify/dispatch logic with the new extraction pipeline from Task 6, while keeping the file reading, format detection, and output reporting.

The `--urls` mode is left unchanged.

## File Ownership

**May modify:**
- `src/commands/import.ts`

**Must not touch:**
- `src/services/extraction-pipeline.ts` (Task 6)
- `src/services/extraction-tiers/*` (Tasks 6/8/9)
- `src/modules/pm/content-handler.ts` (Task 4)

**Read for context (do not modify):**
- `src/services/extraction-pipeline.ts` — `runExtractionPipeline()`, `PipelineResult`
- `src/services/format-adapters/index.ts` — `detectFormat()`, `convertToMarkdown()`
- `src/services/file-scanner.ts` — `INDEXABLE_EXTENSIONS`
- `src/services/indexing.ts` — `indexSingleFile()` for the source note

## Steps

### Step 1: Replace splitDocument with extraction pipeline

In the file processing loop (currently lines 108-201), replace:
1. `splitDocument()` call and its derived note handling
2. Content handler lookup and dispatch

With:
1. Call `runExtractionPipeline()` with the markdown content
2. For items without a handler (returned in `extracted[]` but not in `materializedNoteIds`), write as plain notes to `imports/` directory (current fallback behavior)

The key change is that the extraction pipeline now handles both classification AND handler dispatch internally. The import command just needs to:
1. Read and convert the file
2. Index the source note
3. Call `runExtractionPipeline()` with the converted markdown
4. Write any unhandled items as plain notes
5. Collect stats

### Step 2: Update stats tracking

The `ImportStats` interface should be updated:
- `classified` map → `extracted` map (noteType → count)
- Add `queuedFiles` array for Tier 3 items
- `handlerDispatches` stays (now populated from pipeline result)

### Step 3: Update output formatting

The output should reflect the three-tier model:

```
Imported 47 files:
  Tier 1 (deterministic): 32 files → 62 notes (18 note, 8 task, 4 meeting)
  Tier 2 (LLM): 12 files → 24 notes
  Tier 3 (queued): 3 files → .brain/import-queue/
```

### Step 4: Add --dry-run and --tier flags

- `--dry-run`: Run extraction pipeline but don't create notes. Just print what would happen.
- `--tier <n>`: Set max tier (1 = deterministic only, 2 = + LLM, 3 = full pipeline)

### Step 5: Run tests

Run: `npm test`
Expected: PASS (import tests may need updates, or may not exist as integration tests)

### Step 6: Manual test

```bash
# Test with a simple CSV
echo 'Title,Status,Priority\nFix bug,Open,High\nAdd tests,Done,Medium' > /tmp/test-tasks.csv
npx tsx src/cli.ts import /tmp/test-tasks.csv --json

# Verify tasks were created
npx tsx src/cli.ts pm task list
```

### Step 7: Commit

```bash
git add src/commands/import.ts
git commit -m "feat: refactor import command to use extraction pipeline"
```

## Success Criteria

- [ ] Tests pass: `npm test`
- [ ] Types check: `npm run typecheck`
- [ ] `brain import` with a task CSV creates real PM tasks visible in `pm task list`
- [ ] `brain import` with a markdown file still works as before
- [ ] `--dry-run` shows extraction results without creating notes
- [ ] `--tier 1` restricts to deterministic extraction only
- [ ] `--json` output includes tier breakdown

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT change the `--urls` mode — it stays as-is
- Do NOT implement Tier 2/3 logic in this file — that's in the pipeline
