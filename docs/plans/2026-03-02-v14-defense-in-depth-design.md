# V14 Design: Defense-in-Depth

**Date:** 2026-03-02
**Status:** Approved
**Scope:** Search guardrails, CLI surface fixes, graph edge creation, diagnostic loop closure

## Problem Statement

V13 diagnostic showed avg quality 4.0/5 (-0.1 from V12), with P-10 collapsing 4→1/5. Code verification revealed most diagnostic "bugs" are phantom — features like `--min-score`, `--search` body matching, and `--json` serialization work correctly. The real failures are:

1. **Agents don't discover existing features** — reference docs aren't indexed, so agents don't know about `--min-score`, `--search` body matching, etc.
2. **No guardrails** — search returns low-confidence noise without filtering; agents can't distinguish "no relevant content" from "wrong content returned"
3. **Two confirmed CLI gaps** — `tasks complete` not recognized (O-227), positional prefix rejected by `next`/`workstream list` (O-233)
4. **Zero graph edges** — 13 diagnostic cycles with no KB↔PM cross-links; blocks cross-system discovery
5. **Task notes not searchable** — created but never indexed as chunks

## Design Principles

- **Defense-in-depth**: Features should work well without agents discovering flags
- **Existing infrastructure first**: Use `--min-score`, `--search`, `indexSingleFile()` — don't rebuild
- **Agent-observable improvements**: Every fix should measurably improve at least one test bench prompt

## Architecture

### Pillar 1: Search Guardrails

#### 1a. Default min-score threshold

**File:** `src/services/search.ts`

Add a default `minScore` when none is explicitly provided. The current score-fusion strategy produces scores in [0, 1] where:
- 0.6+ = strong match
- 0.3-0.6 = moderate match
- <0.3 = noise (topically adjacent but not relevant)

```typescript
// In search(), before filtering:
const effectiveMinScore = options.minScore ?? 0.25;
const filtered = scored.filter((s) => s.score >= effectiveMinScore);
```

Use 0.25 as the default — conservative enough to not filter legitimate results, aggressive enough to cut noise. The `--min-score` flag continues to override this.

**Impact:** P-10 (1→3+), P-12 (2→3). Eliminates the "plausible-looking wrong results" failure category.

#### 1b. Actionable empty-results message

**File:** `src/commands/search.ts`

When search returns 0 results (after min-score filtering), print a helpful message instead of bare "No results found":

```
No results found for "voltras architecture".

Suggestions:
  • Try broader search terms
  • Use brain pm task list --search "<term>" for PM task search
  • Use brain pm status <prefix> for project overview
```

**Impact:** Prevents agents from misinterpreting empty results as system failure.

#### 1c. Score visibility in PM search contexts

**File:** `src/modules/pm/engine/dispatch.ts`

The `relatedNotes` in dispatch context already include scores from V13's hybrid scoring. Ensure `score` and `source` fields are always present in JSON output so consumers can self-filter.

No code change needed — V13 already outputs these fields. This is a verification item.

### Pillar 2: CLI Surface Fixes

#### 2a. `tasks complete` alias (O-227)

**File:** `src/modules/pm/index.ts`

Add `complete` to the `taskSubcommands` set. When `tasks complete <id>` is invoked, route to the `pm complete` command.

```typescript
const taskSubcommands = new Set([
  'add', 'list', 'show', 'update', 'done', 'block', 'unblock',
  'delete', 'claim', 'start', 'release',
  'complete',  // ← add
]);
```

Then in the routing logic, detect `complete` and redirect to `pm complete`:

```typescript
if (sub === 'complete') {
  modifiedArgs.splice(modifiedArgs.indexOf('tasks'), 1, 'complete');
  return;
}
```

**Impact:** P-24 (3→5). Eliminates the most common grammar error.

#### 2b. Positional prefix on `next` and `workstream list` (O-233)

**Files:** `src/modules/pm/commands/orchestration.ts`, `src/modules/pm/commands/workstream.ts`

Add `[prefix]` positional argument to `next` and `workstream list`, matching the pattern already used by `waves`:

```typescript
// next command — add positional arg
.argument('[prefix]', 'project prefix')
// In handler: const project = prefix ?? opts.project ?? activeProject;

// workstream list — add positional arg
.argument('[prefix]', 'project prefix')
// In handler: const project = prefix ?? opts.project ?? activeProject;
```

**Impact:** P-05 (-4 calls), P-11 (-2 calls), P-14 (+1-2 quality). Consistent CLI surface.

#### 2c. `workstreams` alias full routing (O-96)

**File:** `src/modules/pm/index.ts`

Currently `workstreams` always prepends `workstream list`. Mirror the `tasks` alias pattern — detect known subcommands (`list`, `show`, `add`), default to `list` only when none given.

**Impact:** Minor call reduction across multi-workstream prompts.

#### 2d. `--search` help text improvement (O-234)

**File:** `src/modules/pm/commands/task.ts`

Update the `--search` option description to explicitly state what fields are searched:

```typescript
.option('--search <term>', 'filter by keyword (searches title, body, and display ID)')
```

This is a discoverability fix — the feature works, agents just don't know body is searched.

**Impact:** Reduces unnecessary JSON-fetch workarounds when agents see the help text.

### Pillar 3: Graph Edges & Task Indexing

#### 3a. Index task notes as searchable chunks (O-49)

**File:** `src/modules/pm/data/task-ops.ts`

After `createTask` writes the markdown file and upserts the note, call `indexSingleFile()` to create chunks and embeddings. This makes task notes appear in `brain search` results.

```typescript
// After upsertNote in createTask:
await indexSingleFile(db, embedder, filePath, content, hash, Date.now());
```

Also index on `updateTask` when body content changes.

**Impact:** P-08 (+1), P-19 (+1), P-27 (+1). Tasks become searchable via `brain search`.

#### 3b. Reference resolution on task creation (O-224)

**File:** `src/modules/pm/data/task-ops.ts`

When a task has a `references` field (file paths or note slugs), resolve them to note IDs and create `references` relation edges:

```typescript
// After task creation, if references exist:
if (input.references?.length) {
  const refRelations = [];
  for (const ref of input.references) {
    const target = db.getNoteBySlug(ref) ?? db.getNoteByPath(ref);
    if (target) {
      refRelations.push({ sourceId: noteId, targetId: target.id, type: 'references' });
    }
  }
  if (refRelations.length) {
    db.upsertRelations(noteId, [...existingRelations, ...refRelations]);
  }
}
```

Register `references` as a relation type in `pm/index.ts`.

**Impact:** P-26 (+1), P-27 (+1). Enables graph traversal from tasks to source docs.

#### 3c. Lower auto-link similarity threshold (O-223)

**File:** `src/modules/pm/engine/dependency.ts` or wherever `computeAutoLinks` lives

The current threshold is too high — 0 edges created across 30 tasks with 20 research docs. Lower to 0.65 or add a deterministic pass that creates edges for exact `references` field matches before the similarity pass.

**Impact:** Enables the graph infrastructure that V13 built (hybrid context scoring) to actually have edges to traverse.

#### 3d. Deduplicate source docs on ingestion (O-225)

**File:** `src/services/indexing.ts` or `src/modules/pm/data/task-ops.ts`

Before indexing a source document, check if a note with the same title and source already exists. If so, update the existing note instead of creating a duplicate.

```typescript
// In onboard or wherever source docs are ingested:
const existing = db.getAllNotes().find(n =>
  n.title === title && n.source === source
);
if (existing) {
  // Update existing note instead of creating new
  db.updateNote(existing.id, { content, hash, indexedAt: Date.now() });
  return;
}
```

**Impact:** P-27 (+1). Eliminates search pollution from 4x duplicate docs.

### Pillar 4: Diagnostic Loop Closure

#### 4a. Auto-ingest diagnostic outputs

**File:** `scripts/diagnostic/run.sh`

Add `brain add` calls at the end of the diagnostic run to feed outputs back into the knowledge base:

```bash
# After run_summary:
echo "── Ingesting diagnostic outputs ──────────────"
brain add "${RESULTS_DIR}/summary.md" --type note --tier fast 2>/dev/null || true
brain add "${RESULTS_DIR}/gap-analysis.md" --type note --tier fast 2>/dev/null || true
```

**Impact:** Future diagnostic agents can search for previous findings.

#### 4b. Regression test gate

Any observation marked "resolved" in the canonical registry must have a corresponding vitest test. Add a check to the assemble step that warns when resolved observations lack test coverage.

This is a process enforcement, not a code change. Implement as a comment/doc update in the diagnostic workflow for now.

## Implementation Waves

### Wave 1: Guardrails + CLI (independent, parallel-safe)
- **T-01**: Default min-score + actionable empty results (search.ts, search command)
- **T-02**: CLI surface fixes — O-227, O-233, O-96, O-234 (index.ts, orchestration.ts, workstream.ts, task.ts)
- **T-03**: Regression tests for all Pillar 1+2 fixes

### Wave 2: Graph Edges (depends on Wave 1 for clean baseline)
- **T-04**: Task note indexing (task-ops.ts)
- **T-05**: Reference resolution + relation type registration (task-ops.ts, index.ts)
- **T-06**: Auto-link threshold + dedup (dependency.ts, indexing.ts)
- **T-07**: Regression tests for Pillar 3

### Wave 3: Diagnostic + Integration (depends on Wave 2)
- **T-08**: Diagnostic loop closure (run.sh)
- **T-09**: Integration tests verifying end-to-end: init → index → search with min-score → task indexing → graph traversal

## Success Criteria

- [ ] `brain search "nonexistent topic"` returns "No results found" with suggestions (not noise)
- [ ] `brain pm tasks complete VOLT-01.01` works
- [ ] `brain pm next VOLT` works (positional prefix)
- [ ] Task notes appear in `brain search` results
- [ ] At least 1 graph edge created per task with `references` field
- [ ] No duplicate source docs after re-ingestion
- [ ] All tests pass: `npx vitest run && npx tsc --noEmit`
- [ ] Diagnostic V14 avg quality ≥ 4.3/5 (from 4.0)
- [ ] P-10 ≥ 3/5 (from 1/5)

## Risks

- **Default min-score too aggressive**: 0.25 might filter legitimate low-confidence matches. Mitigation: start conservative (0.25), tune based on V14 diagnostic.
- **Task indexing increases DB size**: Each task gets chunks + embeddings. Mitigation: use `tier: 'fast'` chunking (single chunk per note).
- **Reference resolution false matches**: File path fragments might match wrong notes. Mitigation: require exact slug or path match, no fuzzy matching.

## Non-Goals (Deferred to V15)

- Cross-workstream dependency support (O-16)
- Temporal dimension / milestone fields (O-99, O-218)
- Wave engine dependency honoring (O-108)
- Inverse doc→tasks query (O-147)
- JSON as default output mode
