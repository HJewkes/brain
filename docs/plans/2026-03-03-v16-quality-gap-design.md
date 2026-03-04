# V16 Quality Gap Design: Task↔Doc Auto-Link Fix

**Date:** 2026-03-03
**Status:** Approved
**Scope:** Core bug fix + infrastructure

## Problem

V15 (3.9/5 avg quality) still lags V12 (4.1/5) by 5 quality points across 8 regressed prompts. Three root causes:

1. **Bug: `createTask()` wipes auto-link relations.** `indexSingleFile()` creates `related` edges via `computeAutoLinks(db, noteId, 0.85)`. Then `createTask()` calls `db.upsertRelations(noteId, [depends_on, parent, refs])` which does `DELETE FROM relations WHERE source_id = ?` first — destroying the auto-links. Task↔doc edges are always destroyed, regardless of threshold. This is why the data audit found zero edges between PM tasks and research docs (Data Audit #2, O-265).

2. **0.85 auto-link threshold too high for PM tasks.** Even without the wipe bug, short task descriptions (60-200 words) don't hit 0.85 cosine similarity against longer research docs. The onboard flow uses 0.60 for batch linking — tasks need the same.

3. **Non-brain call inflation (16→32 since V12).** PM command reference docs (8 files, 981 lines) are not indexed. Agents use `--help` calls to discover command semantics instead of `brain search`.

## Design

### Change 1: Fix `createTask()` relation merge + add 0.60 auto-link pass

**File:** `src/modules/pm/data/task-ops.ts`

After `indexSingleFile()` returns `noteId` (~line 251):

1. Import `computeAutoLinks` from `src/services/graph.ts`
2. Run `computeAutoLinks(db, noteId, 0.60, 5)` — PM-specific lower threshold
3. Call `db.getRelationsFrom(noteId)` — retrieve auto-links created by indexing
4. Build merged array: `[...existing, ...pmAutoLinks, ...depends_on, ...parent, ...references]`
5. Call `db.upsertRelations(noteId, allRelations)` — preserves everything

The `upsertRelations` delete-first semantic is intentional for other callers (e.g., `indexSingleFile` needs to rebuild link relations on re-index). The fix is specifically in `createTask()` not merging before calling it.

### Change 2: Ingest command reference docs in diagnostic runner

**File:** `scripts/diagnostic/run.sh`

In `run_setup()`, after `brain init`:

```bash
for doc in docs/pm-module/commands/*.md; do
  brain add "$doc" --type guide --tier fast 2>/dev/null || true
done
```

### Change 3: Tests

**File:** `__tests__/modules/pm/task-ops.test.ts`

- Create a research note with embedding, then create a task with similar content → verify `related` edge exists from task to research note
- Verify `depends_on` relations are preserved after merge
- Verify auto-links from `indexSingleFile` (0.85 threshold) are preserved alongside new 0.60 threshold links

## Expected Impact

- **P-26 Cross-System** (4→3): recovers to 4/5 — `brain context VOLT-03.01` surfaces `node-sdk-bluetooth-protocol`
- **P-08, P-09, P-19, P-27**: improved related notes in context output
- **All prompts**: reduced non-brain calls from command doc ingestion
- **Projected V16**: 4.0-4.1/5 avg quality, matching V12

## Files Modified

| File | Change |
|------|--------|
| `src/modules/pm/data/task-ops.ts` | Merge existing relations, add 0.60 auto-link pass |
| `scripts/diagnostic/run.sh` | Ingest command docs after init |
| `__tests__/modules/pm/task-ops.test.ts` | Auto-link preservation tests |
