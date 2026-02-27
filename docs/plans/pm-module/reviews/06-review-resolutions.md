# Design Review Resolutions

**Date:** 2026-02-25
**Status:** Draft
**Responds to:** 05-design-review.md

This document resolves the critical and important issues raised during self-review. These resolutions should be incorporated into the main design documents during implementation.

---

## Critical Issue Resolutions

### C1: `notes` table has no `frontmatter` JSON column

**Problem:** Doc 02's dependency engine SQL uses `json_extract(n.frontmatter, '$.status')`, but brain's actual schema stores frontmatter fields as individual typed columns (`type`, `tier`, `status`, `title`, etc.) — there is no JSON blob column.

**Resolution: Three brain-level storage primitives (no PM-specific tables).**

Rather than PM-owned tables, the design uses three reusable brain-level primitives:

1. **`notes.metadata` JSON** — Brain already has an unused `metadata TEXT` column. PM stores all entity data (tasks, projects, workstreams, decisions) as notes with structured metadata JSON. Indexing populates `metadata` from frontmatter.

2. **Extended `relations`** — Brain's existing relation table gains `module` and `module_instance` columns. PM registers relation types (`depends_on`, `blocks`, `impacts`, `supersedes`) and uses standard graph queries.

3. **`activities` table** — New brain-level event log for workflow events. Supports `note_ids` (JSON array for multi-note relations), typed by module. PM uses this for execution telemetry.

The dependency engine queries `notes.metadata` + `relations`:

```sql
-- Eligible tasks: pending with all dependencies done
-- This IS the +READY computation — ready is a virtual state, not stored
SELECT n.id,
       json_extract(n.metadata, '$.display_id') as display_id,
       json_extract(n.metadata, '$.title') as title,
       json_extract(n.metadata, '$.priority') as priority,
       json_extract(n.metadata, '$.mode') as mode
FROM notes n
WHERE n.module = 'pm' AND n.module_instance = ?
  AND json_extract(n.metadata, '$.type') = 'task'
  AND json_extract(n.metadata, '$.status') = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM relations r
    JOIN notes dep ON dep.id = r.target_id
    WHERE r.source_id = n.id
      AND r.relation_type = 'depends_on'
      AND r.module = 'pm'
      AND json_extract(dep.metadata, '$.status') != 'done'
  )
ORDER BY
  CASE json_extract(n.metadata, '$.priority')
    WHEN 'critical' THEN 0 WHEN 'high' THEN 1
    WHEN 'medium' THEN 2 WHEN 'low' THEN 3
  END,
  json_extract(n.metadata, '$.display_id');
```

**Write path:** PM commands write to BOTH markdown frontmatter and `notes.metadata` in the same operation. `brain index` re-derives from markdown, which is safe because frontmatter was already updated. See doc 01 §Storage Extensibility and doc 02 §Dependency Engine for full details.

---

### C2: `NoteType` is a closed union — PM types cannot be registered

**Problem:** `types.ts` declares `NoteType = 'note' | 'decision' | 'pattern' | ...` as a closed literal union with 7 values. Brain's indexer coerces unknown types to `'note'`, destroying PM's type information.

**Resolution: Two-part approach.**

**Part A: Widen the type union to accept module types.**

```typescript
// types.ts
export type CoreNoteType = 'note' | 'decision' | 'pattern' | 'research' | 'meeting' | 'session-log' | 'guide';
export type NoteType = CoreNoteType | (string & {});  // allows any string while preserving autocomplete
```

The `(string & {})` pattern is a TypeScript idiom that allows arbitrary strings while keeping IDE autocomplete for known values.

**Part B: Make coercion module-aware.**

```typescript
// markdown-parser.ts
const VALID_CORE_TYPES: string[] = ['note', 'decision', 'pattern', 'research', 'meeting', 'session-log', 'guide'];

function coerceType(value: unknown, moduleRegistry?: ModuleRegistry): NoteType {
  if (typeof value !== 'string') return 'note';
  if (VALID_CORE_TYPES.includes(value)) return value as NoteType;

  // Check if any module claims this type
  if (moduleRegistry?.hasRegisteredType(value)) {
    return value as NoteType;
  }

  // Unknown type — fall back to 'note' but preserve original in a metadata field
  return 'note';
}
```

**Migration path:** This is a non-breaking change. Existing code that checks `note.type === 'decision'` still works. PM types like `'task'` and `'workstream'` pass through without coercion when the module is registered.

---

### C3: `withBrain()` signature mismatch

**Problem:** Doc 01 proposes `withBrain(fn, opts?)` with `BrainContext` including `modules`, but actual `withBrain()` takes just `fn` and the context type doesn't include modules.

**Resolution: Extend, don't replace.**

```typescript
// brain-service.ts — existing
export async function withBrain<T>(fn: (ctx: BrainServiceContext) => Promise<T>): Promise<T> {
  // ... existing implementation unchanged
}

// brain-service.ts — new overload
export async function withModules<T>(
  fn: (ctx: ModuleServiceContext) => Promise<T>
): Promise<T> {
  return withBrain(async ({ db, config, embedder }) => {
    const registry = new ModuleRegistry();
    await loadModules(registry, { db, config, embedder });
    try {
      return await fn({ db, config, embedder, registry });
    } finally {
      await registry.teardown();
    }
  });
}

export interface ModuleServiceContext extends BrainServiceContext {
  registry: ModuleRegistry;
}
```

PM module commands use `withModules()`. Core brain commands continue using `withBrain()`. No breaking changes.

---

## Important Issue Resolutions

### I1: `brain pm complete --json` output undefined

**Resolution:** Add explicit output schema to doc 02.

```json
{
  "task": {
    "displayId": "OC-08.05",
    "title": "Build Task Tracking MVP",
    "status": "done",
    "completedAt": "2026-02-25T15:30:00Z"
  },
  "impact": {
    "unblocked": [
      { "displayId": "OC-08.06", "title": "Design Brain UI", "status": "pending", "eligible": true }
    ],
    "decisionsRecorded": 1,
    "promptsInvalidated": 0
  },
  "log": "Implemented all CLI commands, tests passing"
}
```

### I2: Missing `CLAIMED` state for parallel dispatch

**Resolution: Include in v1.** Parallel dispatch with claim tokens is core to the orchestration value proposition.

The full claim mechanism is now in doc 02:

```
pending (+READY) → claimed (claim_token + claimed_at) → in-progress (agent started) → done/blocked/pending
```

Key elements:
- `brain pm task claim <id>` returns a UUID claim token
- `brain pm task start <id> --token <t>` validates and transitions
- `brain pm complete <id> --token <t>` validates and records telemetry
- `brain pm task release <id>` manually reverts claimed → pending
- 10-minute timeout auto-reverts stale claims
- Execution telemetry captured as activity records on every completion

### I3: `BrainConfig` has no `modules` field

**Resolution:** Add it as an optional field with a safe default:

```typescript
export interface BrainConfig {
  // ... existing fields
  modules?: Record<string, { enabled: boolean } & Record<string, unknown>>;
}
```

`loadConfig()` merges module config with defaults. Missing `modules` key = no modules loaded. Non-breaking.

### I4: `session-log` type collision

**Resolution:** PM session logs use `type: pm-session-log` (module-namespaced), not the core `session-log` type. Update doc 03 accordingly.

### I5: `brain pm prompt write` undefined

**Resolution:** Add to doc 02's CLI section:

```bash
brain pm prompt write OC-08.05 --from-file ./prompt.md    # create prompt from file
brain pm prompt write OC-08.05 --content "..."              # create prompt inline
brain pm prompt show OC-08.05                                # display prompt
brain pm prompt render OC-08.05                              # render with context (same as dispatch)
brain pm prompt list --status stub                           # find stubs needing content
```

### I6: `brain pm decision audit` over-scoped

**Resolution:** Defer to v2. Remove from v1 scope. Decision capture in v1 is explicit only (human or orchestrator records decisions).

### I7: `brain pm archive` undefined

**Resolution:** Defer to v2. For v1, set project status to `completed` via:
```bash
brain pm project update OC --status completed
```

Archive (moving notes to archive visibility, cleaning up active state) is a v2 concern.

### I8: `hill_position` undefined transitions

**Resolution:** Hill position is informational only in v1 — set manually, no enforced transitions:
```bash
brain pm task update OC-08.05 --hill executing
```

No relationship to `status` state machine. It's a progress signal for humans, not a system constraint. Defer automated hill tracking to v2.

---

## Summary of v1 Scope Adjustments

**Include in v1:**
- Module system foundation (registry, types, commands, migrations)
- Storage extensibility (three brain-level primitives: notes.metadata, extended relations, activities)
- PM CRUD (project, workstream, task, decision)
- `brain pm capture` / `brain pm process` (GTD inbox)
- Dependency engine (eligible computation, impact analysis)
- State machine (pending → claimed → in-progress → done/blocked/cancelled; ready is virtual +READY)
- Claim mechanism with tokens and timeout
- Task categories (research, implementation, configuration, etc.)
- Core orchestration commands (next, claim, dispatch, start, complete, briefing)
- Orchestrator skill with parallel dispatch
- Session tracking via `CLAUDE_ENV_FILE` (SessionStart + SubagentStop hooks)
- Two-phase telemetry (complete records outcome + model; `brain pm audit enrich` parses transcripts for tokens/cost)
- Structured error format with error codes
- Cost estimation and audit commands
- Model selection by task category
- WIP limit enforcement
- Explicit decision capture
- `brain pm prompt` subcommands

**Defer to v2:**
- `brain pm decision audit` (LLM-based)
- `brain pm archive` (full archive workflow)
- Hill chart automated tracking
- Session velocity trend analysis
- External module support (npm packages)
- Multi-project cross-views

---

## References

- 05-design-review.md (the review this responds to)
- Brain types.ts (NoteType union, BrainConfig)
- Brain brain-db.ts (actual schema, migration system)
- Brain brain-service.ts (withBrain signature)
