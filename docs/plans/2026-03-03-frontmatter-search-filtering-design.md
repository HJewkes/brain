# Frontmatter-Aware Search Filtering — Design

**Date:** 2026-03-03
**Status:** Approved
**Approach:** A — Metadata-for-all, no config registration

## Problem

Brain stores 1,065+ atomic insight notes with rich custom YAML frontmatter (architecture-layer, workflow-stage, implementation-mechanism, enforcement-strength, research-quality, evidence-strength, confidence, lineage). These fields are silently dropped during indexing because `coerceFrontmatter()` strips unknown fields and the `metadata` column is only populated for module notes. Users cannot filter search results by custom frontmatter fields.

## Design

### 1. Metadata Preservation — Store Raw Frontmatter for All Notes

**File:** `src/services/indexing.ts` (~line 45)

**Change:** Remove the `fm.module ?` gate on metadata storage:
```typescript
// Before: const metadata = fm.module ? JSON.stringify(parsed.rawFrontmatter) : null;
// After:
const metadata = JSON.stringify(parsed.rawFrontmatter);
```

All notes get their raw frontmatter stored as JSON in the `metadata` column. This preserves custom fields that `coerceFrontmatter()` otherwise drops. Backwards-compatible — all existing code that reads metadata already handles null.

Existing notes backfilled by running `brain index` (re-indexes all files).

### 2. Search Pipeline — `--filter field=value`

**Types** (`src/types.ts`):
Add to `SearchOptions`:
```typescript
filters?: Array<{ field: string; value: string }>;
facets?: string[];
```

**Repo layer** (`src/services/repos/note-repo.ts`):
Add `getFilteredNoteIdsByMetadata(filters, baseIds?)` method:
- For each filter, determine if the field stores a scalar or array via `json_type()`
- Scalar: `WHERE json_extract(metadata, '$.field') = ?`
- Array: `WHERE id IN (SELECT n.id FROM notes n, json_each(json_extract(n.metadata, '$.field')) AS je WHERE je.value = ?)`
- All filters applied with AND logic
- Optional `baseIds` parameter to intersect with existing allowlist

**Search pipeline** (`src/services/search.ts`):
Extend `getFilteredNoteIds()`:
- After existing tier/category/confidence/since/tags filtering
- If `options.filters` is non-empty, call `getFilteredNoteIdsByMetadata()` with current allowlist
- Returns refined allowlist that both standard and custom filters apply to

**CLI** (`src/commands/search.ts`):
Add `--filter <field=value>` as a repeatable option:
```
.option('--filter <expr...>', 'Filter by frontmatter field (field=value, repeatable)')
```
Parse each expression into `{field, value}`. Pass to SearchOptions.

### 3. Faceted Search — `--facet field`

**Repo layer** (`src/services/repos/note-repo.ts`):
Add `getFacetCounts(field, noteIds)` method:
- Scalar fields: `SELECT json_extract(metadata, '$.field') AS val, COUNT(*) AS cnt FROM notes WHERE id IN (...) GROUP BY val ORDER BY cnt DESC`
- Array fields: `SELECT je.value AS val, COUNT(DISTINCT n.id) AS cnt FROM notes n, json_each(json_extract(n.metadata, '$.field')) AS je WHERE n.id IN (...) GROUP BY val ORDER BY cnt DESC`
- Auto-detect array vs scalar via `json_type()` on first non-null row

**Search pipeline** (`src/services/search.ts`):
After search completes, if `options.facets` is non-empty:
1. Get the FULL filtered note set (not just top-N results) — needed for accurate counts
2. For each facet field, call `getFacetCounts(field, filteredIds)`
3. Return facet data alongside results

**CLI output:**
- Text mode: Append facet summary after results
  ```
  Facets:
    implementation-mechanism: hook (4), process (3), hard-gate (3)
    enforcement-strength: deterministic (5), structural (4)
  ```
- JSON mode: Add `facets` object to output:
  ```json
  { "results": [...], "facets": { "field": [{"value": "x", "count": 5}] } }
  ```

**CLI** (`src/commands/search.ts`):
Add `--facet <field...>` as a repeatable option.

### 4. Array Field Handling

Fields like `architecture-layer: [1, 3]` and `workflow-stage: [planning, orchestration]` store arrays in YAML. When filtering:
- `--filter architecture-layer=3` matches notes where 3 appears anywhere in the array
- Implemented via SQLite's `json_each()` table-valued function
- Detection: check `json_type(metadata, '$.field')` — if `'array'`, use `json_each`; otherwise direct equality

### 5. No Schema Migration Needed

The `metadata TEXT` column already exists in the `notes` table. The only change is populating it for all notes (currently only module notes). Running `brain index` re-indexes all files and backfills the column.

## Files Modified

| File | Change |
|------|--------|
| `src/services/indexing.ts` | Remove module gate on metadata storage |
| `src/types.ts` | Add `filters` and `facets` to SearchOptions |
| `src/services/search.ts` | Extend filtering pipeline, add facet computation |
| `src/services/repos/note-repo.ts` | Add `getFilteredNoteIdsByMetadata()` and `getFacetCounts()` |
| `src/commands/search.ts` | Add `--filter` and `--facet` CLI flags, format output |

## Example Usage

```bash
# Find all deterministic enforcement hooks
brain search "enforcement" --filter "implementation-mechanism=hook" --filter "enforcement-strength=deterministic"

# Find empirically validated insights about context management
brain search "context window" --filter "research-quality=empirical" --filter "category=context-management"

# Find all insights from a specific source document
brain search "" --filter "lineage=10-kanban"

# Find insights for a specific architecture layer (array field)
brain search "quality gates" --filter "architecture-layer=2"

# Faceted search
brain search "WIP limits" --facet implementation-mechanism --facet enforcement-strength
```

## Verification

1. `npm test` — all existing + new tests pass
2. `npm run typecheck` — no type errors
3. Manual: Index notes with custom frontmatter → verify metadata column populated
4. Manual: `brain search "" --filter "type=insight"` → returns only insight notes
5. Manual: `brain search "" --filter "architecture-layer=3"` → matches array field
6. Manual: `brain search "" --facet category` → shows distribution counts
7. `./scripts/check.sh` — CI parity
