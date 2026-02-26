# Design Review Resolutions

**Date:** 2026-02-25
**Status:** Draft
**Responds to:** 05-design-review.md

This document resolves the critical and important issues raised during self-review. These resolutions should be incorporated into the main design documents during implementation.

---

## Critical Issue Resolutions

### C1: `notes` table has no `frontmatter` JSON column

**Problem:** Doc 02's dependency engine SQL uses `json_extract(n.frontmatter, '$.status')`, but brain's actual schema stores frontmatter fields as individual typed columns (`type`, `tier`, `status`, `title`, etc.) — there is no JSON blob column.

**Resolution: PM-owned computed index table.**

The PM module creates its own denormalized table that mirrors the task-relevant fields from notes + PM-specific fields. This table is rebuilt on `brain index` (or `brain pm reindex`).

```sql
CREATE TABLE IF NOT EXISTS pm_tasks (
  note_id TEXT PRIMARY KEY,           -- FK to notes.id
  display_id TEXT NOT NULL UNIQUE,    -- e.g., "OC-08.05"
  project TEXT NOT NULL,              -- project prefix
  workstream TEXT,                    -- workstream number
  task_number TEXT,                   -- task number within workstream
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- ready is virtual (+READY), never stored
  mode TEXT,                          -- human | assisted | agent | review
  category TEXT,                      -- research | implementation | configuration | etc.
  priority TEXT DEFAULT 'medium',
  assignee TEXT,
  hill_position TEXT,
  prompt_note TEXT,                    -- note_id of linked prompt note
  estimated_time TEXT,
  blocked_reason TEXT,
  claimed_by TEXT,
  claim_token TEXT,
  claimed_at TEXT,
  agent_id TEXT,
  parent_session TEXT,
  created_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX idx_pm_tasks_project ON pm_tasks(project);
CREATE INDEX idx_pm_tasks_status ON pm_tasks(project, status);
CREATE INDEX idx_pm_tasks_display ON pm_tasks(display_id);
```

The dependency engine SQL now queries `pm_tasks` directly:

```sql
-- Eligible tasks: pending (not claimed/in-progress) with all dependencies done
-- This IS the +READY computation — ready is a virtual state, not stored
SELECT t.note_id, t.display_id, t.title, t.priority, t.mode
FROM pm_tasks t
WHERE t.project = ?
  AND t.status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM pm_dependency_edges d
    JOIN pm_tasks dep ON dep.note_id = d.target_id
    WHERE d.source_id = t.note_id
      AND dep.status != 'done'
  )
ORDER BY
  CASE t.priority
    WHEN 'critical' THEN 0 WHEN 'high' THEN 1
    WHEN 'medium' THEN 2 WHEN 'low' THEN 3
  END,
  t.display_id;
```

**Sync strategy:** When brain indexes a note with `module: pm` and `type: task`, the PM module's index hook extracts PM-relevant fields from the parsed frontmatter and upserts into `pm_tasks`. Same pattern for `pm_projects`, `pm_workstreams`, `pm_decisions`.

This keeps brain's core notes table untouched while giving PM fast queryable access to its own data.

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
- Execution telemetry captured in `pm_executions` table on every completion

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
- Storage extensibility (`metadata` JSON column, three-tier storage)
- PM CRUD (project, workstream, task, decision)
- `brain pm capture` / `brain pm process` (GTD inbox)
- `pm_tasks` computed index table (or view over metadata)
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
