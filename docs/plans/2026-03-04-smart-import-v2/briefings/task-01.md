# Task 01: ExtractedItem Type + ContentHandler Interface Update

## Architectural Context

The import pipeline currently passes individual `ClassifiedSection` objects (with a hardcoded `ContentClass` enum) to content handlers one at a time. The new design replaces this with `ExtractedItem` — a batch-oriented type where items carry a `noteType` string (matching registered `ModuleNoteType.name`) and pre-extracted `fields`. The `ContentHandler` interface must also be updated to claim `noteTypes` instead of `contentClasses`, and accept `ExtractedItem[]` batches. Both interfaces must coexist temporarily with the old ones (Wave 2 removes the old).

## File Ownership

**May modify:**
- `src/types.ts`
- `src/modules/types.ts`

**Must not touch:**
- `src/modules/registry.ts` (Task 2)
- `src/modules/pm/content-handler.ts` (Task 4)
- `src/commands/import.ts` (Task 7)

**Read for context (do not modify):**
- `src/services/content-classifier.ts` — current `ClassifiedSection` type that will be replaced
- `src/modules/pm/content-handler.ts` — current `ContentHandler` consumer

## Steps

### Step 1: Add ExtractedItem type to src/types.ts

Add after the `ContentClass` type (which stays for now — Task 5 removes it):

```typescript
export interface ExtractedItem {
  noteType: string;
  title: string;
  content: string;
  fields: Record<string, string>;
  sourceRegion?: { startLine: number; endLine: number };
}
```

### Step 2: Add importHints to ModuleNoteType in src/modules/types.ts

Add the optional `importHints` field to the existing `ModuleNoteType` interface:

```typescript
export interface ImportHints {
  tableColumnAliases?: Record<string, string[]>;
  archetypeText?: string;
}

export interface ModuleNoteType {
  name: string;
  description: string;
  tier: 'slow' | 'fast';
  schema?: ModuleConfigSchema;
  directorySchema?: DirectorySchema;
  importHints?: ImportHints;
}
```

### Step 3: Add new ContentHandler interface alongside old one

Rename the existing `ContentHandler` to `LegacyContentHandler` and add the new one. Both must exist until Task 5 removes the legacy.

```typescript
/** @deprecated Use ContentHandlerV2 instead — will be removed when ContentClass is dropped */
export interface LegacyContentHandler {
  contentClasses: ContentClass[];
  canHandle(classification: ClassifiedSection): boolean;
  materialize(
    db: BrainDB,
    embedder: Embedder,
    content: string,
    classification: ClassifiedSection,
    sourceNoteId: string,
    schemaMapping?: Record<string, string>
  ): Promise<string[]>;
}

export interface ContentHandler {
  noteTypes: string[];
  canHandle(noteType: string, content: string): boolean;
  materialize(
    db: BrainDB,
    embedder: Embedder,
    items: ExtractedItem[],
    sourceNoteId: string
  ): Promise<string[]>;
}
```

Update the `ModuleContext` interface to keep `registerContentHandler` accepting the union:

```typescript
registerContentHandler(handler: ContentHandler | LegacyContentHandler): void;
```

### Step 4: Run typecheck

Run: `npm run typecheck`
Expected: PASS (new types are additive, old code still compiles)

### Step 5: Commit

```bash
git add src/types.ts src/modules/types.ts
git commit -m "feat: add ExtractedItem type and ContentHandler v2 interface"
```

## Success Criteria

- [ ] Types check: `npm run typecheck`
- [ ] Tests pass: `npm test`
- [ ] `ExtractedItem` exported from `src/types.ts`
- [ ] `ImportHints` and new `ContentHandler` exported from `src/modules/types.ts`
- [ ] Existing `LegacyContentHandler` still works (no breaking changes yet)

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT remove ContentClass yet — that's Task 5
- Do NOT update any consumers of the old interface — Tasks 3/4 handle that
