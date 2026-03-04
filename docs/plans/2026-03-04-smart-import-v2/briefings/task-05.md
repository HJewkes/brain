# Task 05: Remove ContentClass Enum + Migrate References

## Architectural Context

With the knowledge module (Task 3) and PM module (Task 4) now registering their types with `importHints`, the hardcoded `ContentClass` type in `src/types.ts` and the deterministic classification logic in `content-classifier.ts` / `content-archetypes.ts` are no longer the primary classification mechanism. This task removes the `ContentClass` enum, the hardcoded archetype texts, and updates all references. The actual classification functions in `content-classifier.ts` are retained but refactored to work with string-based type names from the registry instead of the enum.

## File Ownership

**May modify:**
- `src/types.ts`
- `src/services/content-classifier.ts`
- `src/services/content-archetypes.ts`
- `src/services/document-splitter.ts`
- `src/modules/types.ts`

**Must not touch:**
- `src/commands/import.ts` (Task 7)
- `src/modules/pm/content-handler.ts` (Task 4)
- `src/modules/knowledge/index.ts` (Task 3)

**Read for context (do not modify):**
- `src/modules/pm/content-handler.ts` — uses `LegacyContentHandler` temporarily
- `__tests__/services/content-classifier.test.ts` — tests to update
- `__tests__/services/document-splitter.test.ts` — tests to update

## Steps

### Step 1: Remove ContentClass from src/types.ts

Delete the `ContentClass` type definition (lines 48-55). Keep `ExtractedItem` (added by Task 1).

### Step 2: Remove LegacyContentHandler from src/modules/types.ts

Remove the `LegacyContentHandler` interface. Update `ContentHandler` to be the only handler interface. Remove the `ClassifiedSection` import if no longer needed. Remove the `ContentClass` import.

Update `ModuleContext.registerContentHandler` to accept only `ContentHandler`.

### Step 3: Refactor content-classifier.ts

The `classifySection()` function currently returns a `ClassifiedSection` with `contentClass: ContentClass`. Refactor it to return `contentClass: string` instead. The function itself is still useful for Tier 1 deterministic extraction (Task 6) — the heuristics work, they just need to return strings.

Update `ClassifiedSection`:
```typescript
export interface ClassifiedSection {
  content: string;
  contentClass: string;  // was: ContentClass
  confidence: number;
  method: 'deterministic' | 'llm' | 'embedding';
  heading: string | null;
}
```

The deterministic rules in `classifySection` stay, but the returned class names should align with registered note type names where possible:
- `'task-list'` → `'task'` (matches PM module's registered type)
- `'bug-report'` → `'task'` (bugs are tasks)
- `'architecture'` → `'research'`
- `'requirements'` → `'guide'`
- `'meeting-notes'` → `'meeting'`
- `'reference'` → `'note'`
- `'general'` → `'note'`

### Step 4: Refactor content-archetypes.ts

Remove the hardcoded `ARCHETYPE_TEXTS` record. Replace `getArchetypeEmbeddings` to accept a `Map<string, string>` of archetype texts (from the registry) instead of using the hardcoded ones. This makes it a utility function that the extraction pipeline calls with registry data.

```typescript
export async function getArchetypeEmbeddings(
  embedder: Embedder,
  archetypeTexts: Map<string, string>
): Promise<Map<string, Float32Array>> {
  // Same caching logic but using provided texts instead of ARCHETYPE_TEXTS
}
```

### Step 5: Update document-splitter.ts

Remove the `CLASS_TO_TYPE` mapping (the note type comes from the registered type, not a lookup table). Update `SplitResult.derivedNotes` to use `string` for `contentClass` instead of `ContentClass`. The splitter still works the same way — it just doesn't need the enum.

### Step 6: Update affected tests

Update `__tests__/services/content-classifier.test.ts` and `__tests__/services/document-splitter.test.ts` to use string-based content classes.

### Step 7: Run full test suite

Run: `npm test`
Expected: PASS (some tests may need updating for new class name strings)

### Step 8: Commit

```bash
git add src/types.ts src/modules/types.ts src/services/content-classifier.ts src/services/content-archetypes.ts src/services/document-splitter.ts __tests__/services/content-classifier.test.ts __tests__/services/document-splitter.test.ts __tests__/services/content-archetypes.test.ts
git commit -m "refactor: remove ContentClass enum, use string-based note type names"
```

## Success Criteria

- [ ] Tests pass: `npm test`
- [ ] Types check: `npm run typecheck`
- [ ] No references to `ContentClass` type remain in `src/`
- [ ] `classifySection()` returns string-based type names matching registered types
- [ ] `getArchetypeEmbeddings()` accepts archetype texts as parameter

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT delete `content-classifier.ts` or `content-archetypes.ts` entirely — they're still used by the extraction pipeline
- Do NOT change the `classifySection()` detection logic — just update the returned type names
