# Task 02: Registry importHints Methods

## Architectural Context

`ModuleRegistry` is the central store for all module registrations. It already tracks note types, content handlers, etc. This task adds methods to query `importHints` data from registered note types — specifically: get all table column aliases (for Tier 1 CSV matching), get all archetype texts (for embedding similarity), and get the note type that best matches a set of column headers. These methods are consumed by the extraction pipeline (Task 6).

## File Ownership

**May modify:**
- `src/modules/registry.ts`
- `src/modules/context.ts`

**Must not touch:**
- `src/types.ts` (Task 1)
- `src/modules/types.ts` (Task 1)
- `src/modules/pm/index.ts` (Task 4)

**Read for context (do not modify):**
- `src/modules/types.ts` — `ModuleNoteType` with new `importHints` field (from Task 1)
- `src/modules/loader.ts` — how modules are loaded and registered

## Steps

### Step 1: Write failing tests

Create or update the registry test file. Test the new query methods:

```typescript
// In __tests__/modules/registry.test.ts (add to existing or create)
describe('importHints queries', () => {
  it('getImportableNoteTypes returns types with importHints', () => {
    const registry = new ModuleRegistry();
    // Register a module with importHints and one without
    // Assert only the one with hints is returned
  });

  it('matchColumnHeaders returns best matching note type', () => {
    const registry = new ModuleRegistry();
    // Register PM task type with tableColumnAliases
    // Assert matching ['title', 'status', 'priority'] returns 'task'
  });

  it('matchColumnHeaders returns null when no match (< 2 hits)', () => {
    // Headers with only 1 matching column should not match
  });

  it('getArchetypeTexts returns map of type name to archetype text', () => {
    // Register types with archetypeText, verify output
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npm test -- __tests__/modules/registry.test.ts`
Expected: FAIL (methods don't exist yet)

### Step 3: Add registry methods

In `src/modules/registry.ts`, add to the `ModuleRegistry` class:

```typescript
/** Returns all note types that have importHints configured */
getImportableNoteTypes(): Array<{ module: string; noteType: ModuleNoteType }> {
  return this.getAllNoteTypes().filter(({ noteType }) => noteType.importHints);
}

/** Match CSV/table column headers against registered tableColumnAliases.
 *  Returns the best-matching note type if 2+ columns match, else null. */
matchColumnHeaders(headers: string[]): { module: string; noteType: string; columnMapping: Record<string, string> } | null {
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());
  let bestMatch: { module: string; noteType: string; columnMapping: Record<string, string>; hits: number } | null = null;

  for (const { module, noteType } of this.getImportableNoteTypes()) {
    const aliases = noteType.importHints?.tableColumnAliases;
    if (!aliases) continue;

    const mapping: Record<string, string> = {};
    let hits = 0;

    for (const [schemaField, columnNames] of Object.entries(aliases)) {
      const matched = lowerHeaders.find(h => columnNames.map(c => c.toLowerCase()).includes(h));
      if (matched) {
        mapping[matched] = schemaField;
        hits++;
      }
    }

    if (hits >= 2 && (!bestMatch || hits > bestMatch.hits)) {
      bestMatch = { module, noteType: noteType.name, columnMapping: mapping, hits };
    }
  }

  return bestMatch ? { module: bestMatch.module, noteType: bestMatch.noteType, columnMapping: bestMatch.columnMapping } : null;
}

/** Returns archetype texts for embedding-based classification */
getArchetypeTexts(): Map<string, string> {
  const result = new Map<string, string>();
  for (const { noteType } of this.getImportableNoteTypes()) {
    if (noteType.importHints?.archetypeText) {
      result.set(noteType.name, noteType.importHints.archetypeText);
    }
  }
  return result;
}
```

### Step 4: Run tests

Run: `npm test -- __tests__/modules/registry.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/modules/registry.ts __tests__/modules/registry.test.ts
git commit -m "feat: add importHints query methods to ModuleRegistry"
```

## Success Criteria

- [ ] Tests pass: `npm test -- __tests__/modules/registry.test.ts`
- [ ] Types check: `npm run typecheck`
- [ ] `matchColumnHeaders` correctly maps column names to schema fields
- [ ] `getArchetypeTexts` returns only types with archetypeText configured

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT add features beyond what is specified in the steps
- Do NOT import from Task 1 types yet if they don't exist — the `ModuleNoteType` interface already exists and will gain `importHints` from Task 1. If types aren't available yet, use inline types temporarily.
