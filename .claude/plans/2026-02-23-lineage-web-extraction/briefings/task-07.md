# Task 07: Access Tracking in Search + Promotion Logic

## Architectural Context

Brain's search service in `src/services/search.ts` orchestrates BM25 + vector hybrid search. This task wires in access tracking: when search returns results, record `search_hit` events via `NoteRepo.recordAccess()`. It also adds a promotion check: after recording access, if a `tier: fast` note exceeds the access threshold (default 10), auto-promote it to `tier: slow` by updating its frontmatter and DB record.

## File Ownership

**May modify:**
- `src/services/search.ts`
- `__tests__/services/search.test.ts`

**Must not touch:**
- `src/services/repos/note-repo.ts` — Task 3 owns repo methods
- `src/services/brain-db.ts` — Tasks 4/5 own facade
- `src/types.ts` — Task 1 owns types

**Read for context (do not modify):**
- `src/services/brain-db.ts` — understand `recordAccess`, `getAccessCount`, `getNoteById` signatures
- `src/services/indexing.ts` — understand `addFrontmatterField` from Task 5
- `src/types.ts` — understand `SearchResult`, `SearchOptions`

## Steps

### Step 1: Write failing test for access tracking in search

In `__tests__/services/search.test.ts`, add a test that verifies search records access events. This requires understanding the existing test setup — search tests likely mock or create a real DB. Add to the appropriate describe block:

```typescript
describe('access tracking', () => {
  it('records search_hit events for returned results', async () => {
    // Perform a search that returns results
    const results = await search(db, embedder, 'test query', { limit: 5 });

    if (results.length > 0) {
      const count = db.getAccessCount(results[0].noteId);
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });
});
```

### Step 2: Run test to verify it fails

Run: `npm test -- __tests__/services/search.test.ts`
Expected: FAIL — search doesn't record access events yet.

### Step 3: Add access tracking to search function

In `src/services/search.ts`, after building the final results array (after reranking if applicable), add access tracking. Find the return statement at the end of the `search` function and add recording before it:

```typescript
// Record access events for returned results
for (const result of results) {
  db.recordAccess(result.noteId, 'search_hit');
}
```

The `db` parameter is `BrainDB` — it already has `recordAccess` as a facade delegate from Task 4.

Note: Make sure to also record access for memory search results in `searchMemories` if it references source notes.

### Step 4: Run test to verify it passes

Run: `npm test -- __tests__/services/search.test.ts`
Expected: PASS

### Step 5: Add promotion check function

In `src/services/search.ts`, add an exported function:

```typescript
const DEFAULT_PROMOTION_THRESHOLD = 10;

export function checkAndPromote(
  db: BrainDB,
  noteId: string,
  threshold: number = DEFAULT_PROMOTION_THRESHOLD
): boolean {
  const note = db.getNoteById(noteId);
  if (!note || note.tier !== 'fast') return false;

  const count = db.getAccessCount(noteId);
  if (count < threshold) return false;

  // Promote: update DB record
  const promoted = { ...note, tier: 'slow' as const, reviewInterval: null };
  db.upsertNote(promoted);

  // Update frontmatter on disk if file exists
  if (existsSync(note.filePath)) {
    addFrontmatterField(note.filePath, 'tier', 'slow');
  }

  return true;
}
```

Import `addFrontmatterField` from `./indexing.js` and `existsSync` from `node:fs`.

### Step 6: Write test for promotion

```typescript
describe('checkAndPromote', () => {
  it('promotes a fast-tier note after reaching threshold', () => {
    // Create a fast-tier note and record enough access events
    // (use existing test DB setup pattern)
    for (let i = 0; i < 10; i++) {
      db.recordAccess('test-note-id', 'search_hit');
    }
    const promoted = checkAndPromote(db, 'test-note-id', 10);
    expect(promoted).toBe(true);
    const note = db.getNoteById('test-note-id');
    expect(note?.tier).toBe('slow');
  });

  it('does not promote slow-tier notes', () => {
    const promoted = checkAndPromote(db, 'slow-tier-note-id', 1);
    expect(promoted).toBe(false);
  });
});
```

### Step 7: Run all tests

Run: `npm test -- __tests__/services/search.test.ts && npm run typecheck`
Expected: All pass

### Step 8: Commit

```bash
git add src/services/search.ts __tests__/services/search.test.ts
git commit -m "Add access tracking in search and usage-based tier promotion"
```

## Success Criteria

- [ ] Tests pass: `npm test -- __tests__/services/search.test.ts`
- [ ] Types check: `npm run typecheck`
- [ ] Search results trigger `search_hit` access recording
- [ ] `checkAndPromote` promotes `tier: fast` notes after threshold accesses
- [ ] `checkAndPromote` returns false for already-slow notes

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT add features beyond what is specified in the steps
- Do NOT add automatic promotion inside the search function — keep it as a separate callable. The CLI or indexer can call `checkAndPromote` as needed.
