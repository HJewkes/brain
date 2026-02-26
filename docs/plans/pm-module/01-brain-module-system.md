# Brain Module System Design

**Date:** 2026-02-25
**Status:** Draft
**Depends on:** Brain codebase analysis (v0.3.0)
**Part of:** Task Management Framework — Design Series

---

## Overview

This document designs a **module system for brain** that allows first-class extensions to register custom note types, CLI commands, database schemas, search filters, and memory extraction strategies — while maintaining namespace isolation, query scoping, and data protection.

The module system is the foundation that the PM (project management) module builds on. It's designed to be general-purpose: any domain-specific extension (CRM, reading lists, habit tracking) could use the same primitives.

---

## Design Principles

1. **Composition over inheritance** — Modules register capabilities via interfaces, never subclass core
2. **Zero-config for consumers** — `brain pm status` just works; no manual wiring
3. **One-way dependency** — Modules depend on brain core; brain core never imports modules
4. **Namespace isolation** — Module types, data, and commands live in distinct namespaces
5. **Graduated visibility** — Module data can be public, contextual, or private to the module
6. **Schema enforcement** — Modules declare schemas; brain validates on index
7. **Backward compatibility** — Brain works identically with zero modules installed

---

## Architecture

### Module Registry

The central coordination point. Brain core initializes it at startup, discovers installed modules, and calls their `register()` method.

```typescript
// src/modules/registry.ts

export interface BrainModule {
  /** Unique module identifier, used as namespace prefix */
  name: string;

  /** Semver version */
  version: string;

  /** Human-readable description */
  description: string;

  /** Called once at brain startup. Module registers all its capabilities here. */
  register(ctx: ModuleContext): void;

  /** Called when brain shuts down. Optional cleanup. */
  teardown?(): Promise<void>;
}

export interface ModuleContext {
  /** Register CLI commands under `brain <module-name> <command>` */
  registerCommands(commands: Command[]): void;

  /** Register note types this module owns */
  registerNoteTypes(types: ModuleNoteType[]): void;

  /** Register database migrations for module-specific tables */
  registerMigrations(migrations: ModuleMigration[]): void;

  /** Register search filter providers */
  registerFilters(filters: FilterProvider[]): void;

  /** Register config schema extensions */
  registerConfig(schema: ModuleConfigSchema): void;

  /** Register a handler called when a note is indexed */
  onNoteIndex(handler: (note: NoteRecord) => Promise<void>): void;

  /** Register a handler called when a note is deleted */
  onNoteDelete(handler: (noteId: string) => Promise<void>): void;

  /** Register a custom extraction strategy for module note types */
  registerExtractionStrategy(strategy: ModuleExtractionStrategy): void;

  /** Access brain's core services (read-only unless module owns the data) */
  readonly db: BrainDB;
  readonly config: BrainConfig;
  readonly embedder: Embedder;
}
```

### Module Discovery & Loading

Modules are discovered from two sources:

1. **Built-in modules** — Shipped with brain in `src/modules/` (e.g., the PM module)
2. **External modules** — npm packages following the `brain-module-*` naming convention, listed in brain's config

```typescript
// brain config.json
{
  "modules": {
    "pm": {
      "enabled": true,
      // module-specific config
      "defaultProject": "openclaw"
    }
  }
}
```

**Loading order:**
1. Brain core initializes (DB, config, embedder)
2. Core migrations run
3. Module registry created
4. Each module's `register()` called in dependency order
5. Module migrations run
6. CLI commands assembled
7. `program.parseAsync()`

### Module Load Error Handling

If a module's `register()` method throws an error:

1. The error is caught and logged
2. The module is marked as `failed` in the registry
3. Brain continues startup without the failed module
4. The failed module's commands are NOT registered (attempting to call them shows "module failed to load" error)
5. `brain module list` shows module status including any load errors

This prevents a broken module from blocking all brain functionality:

```typescript
for (const mod of discoveredModules) {
  try {
    await mod.register(createModuleContext(mod.name, ctx));
    registry.markLoaded(mod.name);
  } catch (err) {
    registry.markFailed(mod.name, err);
    console.error(`Module '${mod.name}' failed to load: ${err.message}`);
  }
}
```

### Integration with brain-service.ts

The existing `withBrain()` lifecycle helper gets a module-aware variant:

```typescript
// Updated brain-service.ts
export async function withBrain<T>(
  fn: (ctx: BrainContext) => Promise<T>,
  opts?: { configDir?: string; dbPath?: string }
): Promise<T> {
  const config = loadConfig(opts?.configDir);
  const db = new BrainDB(config.dbPath);
  const embedder = createEmbedder(config);
  const modules = await loadModules(config, db, embedder);

  try {
    return await fn({ db, config, embedder, modules });
  } finally {
    for (const mod of modules) {
      await mod.teardown?.();
    }
    db.close();
  }
}
```

---

## Namespace Isolation

### The Problem

Two modules might both define a `task` type. A CRM module's "task" (follow up with client) is structurally different from PM's "task" (implement feature X with dependencies). Without namespacing, these collide in:
- The `notes` table (`type` column)
- FTS search results
- CLI commands
- Frontmatter validation

### The Solution: Module-Prefixed Types

Every module-owned note gets module metadata in frontmatter:

**Identifier conventions:**
- Fully qualified: `module:instance:displayId` (e.g., `pm:openclaw:OC-08.05`) — used for cross-module references
- Within module context: bare display ID (e.g., `OC-08.05`) — used in frontmatter fields like `depends_on`

```yaml
---
type: task                    # local type name (module's concept)
module: pm                    # owning module namespace
module_instance: openclaw     # which project/instance (module-defined)
title: "Configure Brain CLI Access"
status: in-progress
priority: high
depends_on:
  - OC-08.02                  # bare display ID (within module context)
---
```

**Storage in notes table:**

The `notes` table gets three new columns:

```sql
ALTER TABLE notes ADD COLUMN module TEXT;           -- NULL for non-module notes
ALTER TABLE notes ADD COLUMN module_instance TEXT;   -- NULL if not instance-scoped
ALTER TABLE notes ADD COLUMN metadata TEXT;          -- JSON blob for module-specific fields
```

The `metadata` column is the extensible storage layer. Core fields (`title`, `type`, `tier`, `status`) remain as typed columns for brain's internal queries. Everything else — module-specific fields like `depends_on`, `priority`, `mode`, `claim_token` — lives in `metadata` as a JSON object.

This means:
- **Brain core** never needs schema changes for module fields
- **Simple modules** can store and query all their data via `json_extract(metadata, '$.field')`
- **Performance-sensitive modules** (like PM's dependency engine) can additionally build computed index tables or views that extract from `metadata` into typed columns
- **Any module** can add arbitrary fields without a migration

See the "Storage Extensibility" section below for the full design.

**Index on (module, module_instance, type)** for fast scoped queries.

**Fully qualified identifiers:** `<module>:<instance>:<note-id>` when cross-referencing. Within a module's own context, bare `<note-id>` is sufficient.

### Type Registration

```typescript
export interface ModuleNoteType {
  /** Local type name (e.g., "task", "workstream", "project") */
  name: string;

  /** JSON Schema for frontmatter validation */
  schema: JSONSchema;

  /** Visibility tier for search (see Query Scoping section) */
  visibility: 'public' | 'contextual' | 'private';

  /** Which frontmatter field defines the instance scope (e.g., "project") */
  instanceKey?: string;

  /** Fields that should be indexed for FTS */
  searchableFields: string[];

  /** Fields to exclude from general brain queries */
  internalFields?: string[];
}
```

When brain indexes a note with `module: pm` and `type: task`, it:
1. Looks up `pm`'s registered `task` type
2. Validates frontmatter against the declared JSON Schema
3. Logs warnings for invalid fields (doesn't reject — graceful degradation)
4. Stores module/instance metadata in the notes table
5. Applies visibility rules to search indexing

---

## Query Scoping & Visibility

### Visibility Tiers

Each module note type declares a visibility tier that controls when it appears in brain searches:

| Tier | `brain search "auth"` | `brain pm search "auth"` | `brain pm search "auth" --project openclaw` |
|------|----------------------|--------------------------|---------------------------------------------|
| **public** | Yes | Yes | Yes |
| **contextual** | Only if module/instance is active | Yes | Yes |
| **private** | Never | Yes (within module) | Yes |

### How Visibility Works in Practice

**Public** — The note's title, summary, and searchable fields are indexed into brain's global FTS and vector tables. Any `brain search` query can find them. Use for: reference docs, design decisions, project summaries.

**Contextual** — The note is indexed but tagged. Global search includes it only when:
- The user has set an active module context (`brain pm use openclaw`)
- The search explicitly requests module scope (`brain search --module pm`)
- OR the query semantically matches strongly enough (future: relevance threshold)

Use for: tasks, workstream details, progress notes. You want `brain search "authentication"` to find PM tasks about auth setup *when you're actively working on that project*, but not when you're just browsing personal notes.

**Private** — Not indexed in global FTS/vector tables at all. Only accessible through module-specific commands. Use for: dependency graph edges, internal state, computed metadata, raw prompt files.

### Implementation: Search Filter Injection

Brain's search pipeline gets a module filter step:

```typescript
// In search.ts, after getFilteredNoteIds()
function applyModuleVisibility(
  noteIds: Set<string>,
  db: BrainDB,
  activeModuleContext: ModuleContext | null
): Set<string> {
  if (!activeModuleContext) {
    // No module context active — exclude contextual/private module notes
    const publicOnly = db.getModuleNoteIds({ visibility: 'public' });
    const nonModuleNotes = db.getNonModuleNoteIds();
    return intersection(noteIds, union(publicOnly, nonModuleNotes));
  }

  // Module context active — include contextual for this module, exclude private from other modules
  const allowed = db.getModuleNoteIds({
    module: activeModuleContext.name,
    visibility: ['public', 'contextual']
  });
  const otherPublic = db.getModuleNoteIds({ visibility: 'public' });
  const nonModuleNotes = db.getNonModuleNoteIds();
  return intersection(noteIds, union(allowed, otherPublic, nonModuleNotes));
}
```

### Active Context

The "active module context" is stored as brain metadata (persists across sessions):

```bash
brain pm use openclaw        # Sets active context: module=pm, instance=openclaw
brain pm use --clear         # Clears module context
brain pm use --all           # Sets module context without instance filter
brain context                # Shows current active contexts (could have multiple)
```

Stored in `db_meta` table:
```sql
INSERT INTO db_meta (key, value) VALUES ('active_context', '{"module":"pm","instance":"openclaw"}');
```

---

## Schema Enforcement

### Frontmatter Validation

Modules declare JSON Schemas for their note types. Brain validates during indexing:

```typescript
// Example: PM module's task type schema
const taskSchema: JSONSchema = {
  type: 'object',
  required: ['title', 'status'],
  properties: {
    title: { type: 'string' },
    status: {
      type: 'string',
      enum: ['pending', 'claimed', 'in-progress', 'done', 'blocked', 'cancelled']
    },
    priority: {
      type: 'string',
      enum: ['critical', 'high', 'medium', 'low']
    },
    mode: {
      type: 'string',
      enum: ['human', 'assisted', 'agent', 'review']
    },
    assignee: { type: 'string' },
    depends_on: {
      type: 'array',
      items: { type: 'string' }  // qualified task IDs
    },
    blocks: {
      type: 'array',
      items: { type: 'string' }
    },
    project: { type: 'string' },
    workstream: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    due: { type: 'string', format: 'date' },
    completed_at: { type: 'string', format: 'date-time' },
    prompt_note: { type: 'string' },    // note_id of linked prompt note
    estimated_time: { type: 'string' }
  }
};
```

### Validation Behavior

Brain validates on index but **does not reject invalid notes**. Instead:

1. **Valid** — Note indexed normally with full module metadata
2. **Warnings** — Extra fields not in schema → indexed but flagged
3. **Errors** — Missing required fields or wrong types → note still indexed but marked `validation: 'error'` in metadata, module-specific features may not work
4. **No module** — Notes without `module:` frontmatter are plain brain notes, no module validation

This graceful degradation means you can manually create/edit markdown files and they'll still work — the schema catches mistakes without being a hard gate.

---

## Storage Extensibility

### The Problem

Brain's notes table has fixed typed columns (`title`, `type`, `tier`, `status`, etc.). If modules store their data in these columns, every new module field requires a core schema migration. The type system is extensible, but the storage isn't.

### The Solution: Core Columns + Metadata JSON

The notes table has three tiers of storage:

| Tier | Storage | Who Uses It | Performance |
|------|---------|-------------|-------------|
| **Core columns** | Typed SQL columns (`title`, `type`, `tier`, `status`, `module`, `module_instance`) | Brain core (search, FTS, graph, filtering) | Fast — native SQL indexes |
| **Metadata blob** | `metadata TEXT` (JSON) | Modules — all module-specific fields | Moderate — `json_extract()` queries |
| **Computed indexes** | Module-owned tables/views (e.g., `pm_dependency_edges`) | Modules with hot-path queries | Fast — proper indexes on extracted fields |

### How Indexing Works

When brain indexes a note with `module: pm`:

```
1. Parse frontmatter (gray-matter)
2. Core fields → typed columns (title, type, tier, status, module, module_instance)
3. ALL frontmatter → metadata JSON blob (including core fields, for completeness)
4. Module's onIndex hook fires:
   - PM reads json_extract(metadata, '$.depends_on')
   - PM updates pm_dependency_edges table
   - PM updates pm_tasks view/materialized cache
5. FTS index updated (title + searchable fields from metadata)
6. Vector embeddings computed (if body content changed)
```

### Module Storage Options

A module can choose its storage strategy based on query needs:

**Option A: Metadata-only** (simple modules)
```sql
-- Reading list module: just needs basic queries
SELECT json_extract(metadata, '$.author'), json_extract(metadata, '$.rating')
FROM notes WHERE module = 'reading-list' AND type = 'book';
```

**Option B: Metadata + SQL view** (moderate query needs)
```sql
-- PM tasks: view over metadata for convenience, no separate table
CREATE VIEW pm_tasks_view AS
SELECT id, json_extract(metadata, '$.display_id') as display_id,
       json_extract(metadata, '$.status') as pm_status, ...
FROM notes WHERE module = 'pm' AND type = 'task';
```

**Option C: Metadata + materialized tables** (hot-path queries)
```sql
-- PM dependency edges: real table for graph joins
-- Rebuilt on brain index from frontmatter metadata
CREATE TABLE pm_dependency_edges (...);
```

This graduated approach means simple modules need zero SQL tables (just metadata), while complex modules like PM can optimize their critical queries with proper indexes — without any changes to brain core.

---

## Data Protection

### The Problem

A user running `brain note edit <id>` could accidentally modify a PM-owned task in ways that break the dependency graph or corrupt state.

### Protection Model

**Soft protection** (recommended, implemented first):
- `brain note edit` on a module-owned note prints a warning: "This note is managed by the pm module. Edit with `brain pm task update` instead."
- The edit still works — we don't block it
- Module-specific commands validate state transitions (e.g., can't set status to 'done' if dependencies aren't met)

**Hard protection** (future, opt-in per module):
- Module can declare `protected: true` on a note type
- `brain note edit` refuses to modify protected notes
- Only module commands can write to them
- Escape hatch: `brain note edit --force` for emergencies

### Why Soft First

Hard protection adds complexity and frustrates users who need to manually fix things. Soft protection with good tooling (clear warnings, easy module commands) is better UX and covers 95% of cases.

---

## Command Registration

### Namespace Convention

Module commands live under `brain <module-name>`:

```bash
brain pm init "openclaw"
brain pm status
brain pm next
brain pm task add "Title" --priority high
brain pm task list --status pending
brain pm dispatch 08.05
brain pm complete 08.05
```

### Implementation

Modules register Commander.js commands via the module context:

```typescript
// In PM module's register():
register(ctx: ModuleContext): void {
  const pmCommand = new Command('pm')
    .description('Project management module');

  pmCommand.addCommand(createInitCommand(ctx));
  pmCommand.addCommand(createStatusCommand(ctx));
  pmCommand.addCommand(createNextCommand(ctx));
  pmCommand.addCommand(createTaskCommand(ctx));
  pmCommand.addCommand(createDispatchCommand(ctx));
  pmCommand.addCommand(createCompleteCommand(ctx));

  ctx.registerCommands([pmCommand]);
}
```

In `cli.ts`, after core commands are added:

```typescript
// Core commands
program.addCommand(searchCommand);
program.addCommand(indexCommand);
// ...

// Module commands
for (const mod of registry.getModules()) {
  for (const cmd of mod.commands) {
    program.addCommand(cmd);
  }
}
```

### JSON Output Convention

All module commands support `--json` output, following brain's existing pattern. This is critical for Claude Code integration — the orchestrator parses JSON to make decisions.

---

## Database Extensions

### Module Migration System

Modules can declare SQL migrations that run after core migrations:

```typescript
export interface ModuleMigration {
  /** Module-scoped version number (independent of core schema version) */
  version: number;

  /** SQL to execute */
  up: string;

  /** Optional rollback SQL */
  down?: string;
}
```

Module migration state is tracked in `db_meta`:

```sql
-- Key: "module_schema_<module_name>", Value: current version number
INSERT INTO db_meta (key, value) VALUES ('module_schema_pm', '3');
```

### Module Tables

Modules can create their own tables. Convention: prefix with module name.

```sql
-- PM module tables
CREATE TABLE IF NOT EXISTS pm_dependency_edges (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'depends_on',
  project TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id),
  FOREIGN KEY (source_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pm_decisions (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  decision TEXT NOT NULL,
  rationale TEXT,
  impacts TEXT,  -- JSON array of affected task/prompt IDs
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  source_task_id TEXT,
  FOREIGN KEY (source_task_id) REFERENCES notes(id)
);

CREATE TABLE IF NOT EXISTS pm_prompt_cache (
  task_id TEXT PRIMARY KEY,
  rendered_prompt TEXT NOT NULL,
  rendered_at TEXT NOT NULL,
  context_hash TEXT NOT NULL,  -- detect staleness
  FOREIGN KEY (task_id) REFERENCES notes(id) ON DELETE CASCADE
);
```

### Cascade Behavior

When brain deletes a note, module tables with foreign keys automatically cascade (via `ON DELETE CASCADE`). For more complex cleanup, modules can register cascade hooks:

```typescript
ctx.onNoteDelete((noteId: string) => {
  // Clean up PM-specific state for this note
  db.exec('DELETE FROM pm_dependency_edges WHERE source_note_id = ? OR target_note_id = ?', noteId, noteId);
});
```

---

## Memory Extraction Integration

### Module-Aware Extraction

Modules can register custom extraction strategies that brain uses when processing module-owned notes:

```typescript
export interface ModuleExtractionStrategy {
  /** Which note types this strategy applies to */
  noteTypes: string[];

  /** Custom system prompt for fact extraction */
  systemPrompt: string;

  /** Custom reconciliation rules */
  reconciliationRules?: string;

  /** Container tag for extracted memories */
  containerTag: string;
}
```

**Example:** PM module registers an extraction strategy for `task` notes that focuses on decisions, blockers, and outcomes rather than general facts:

```typescript
ctx.registerExtractionStrategy({
  noteTypes: ['task'],
  systemPrompt: `Extract from this task note:
    - Decisions made and their rationale
    - Blockers encountered and how they were resolved
    - Key outcomes and artifacts produced
    - Lessons learned
    Do NOT extract: status changes, routine progress updates, timestamps`,
  containerTag: 'pm-decisions',
});
```

This means when brain's memory extraction runs on a PM task note, it uses the PM-specific prompt and tags memories with `pm-decisions` — making them easily queryable as a decision log.

---

## Configuration

### Module Config Schema

Modules declare their config shape:

```typescript
ctx.registerConfig({
  schema: {
    defaultProject: { type: 'string', description: 'Active project on startup' },
    parallelAgents: { type: 'number', default: 3, description: 'Max concurrent agent tasks' },
    promptsDir: { type: 'string', description: 'Override prompts directory location' },
  },
  validate(config: Record<string, unknown>) {
    if (config.parallelAgents && (config.parallelAgents as number) > 10) {
      return { valid: false, errors: ['parallelAgents max is 10'] };
    }
    return { valid: true, errors: [] };
  }
});
```

Stored in brain's config.json under the module namespace:

```json
{
  "notesDir": "~/brain",
  "embedder": "local",
  "modules": {
    "pm": {
      "enabled": true,
      "defaultProject": "openclaw",
      "parallelAgents": 3
    }
  }
}
```

---

## Implementation Phases

### Phase 1: Core Module Infrastructure
- `ModuleRegistry` class
- `ModuleContext` interface
- Module discovery and loading (built-in only)
- `register()` lifecycle
- Module config in brain config.json
- Tests for registry, loading, lifecycle

### Phase 2: Namespace & Types
- `module` and `module_instance` columns on notes table
- Migration for new columns
- Module-aware frontmatter validation (JSON Schema)
- Soft protection warnings on `brain note edit`
- Tests for namespace isolation

### Phase 3: Command Registration
- Dynamic command registration in cli.ts
- `brain <module> <command>` routing
- `--json` output enforcement
- Tests for command discovery

### Phase 4: Query Scoping
- Visibility tier enforcement in search pipeline
- Active context management (`brain context`, `brain pm use`)
- Module filter injection in search.ts
- Tests for visibility tiers

### Phase 5: Database Extensions
- Module migration system
- Module-prefixed table convention
- Cascade hooks
- Tests for migrations and cascading

### Phase 6: Memory Integration
- Module extraction strategies
- Custom container tags
- Module-aware reconciliation
- Tests for extraction

---

## Open Questions

1. **External module distribution** — npm packages? git repos? For now, built-in only. External can come later when the interface is stable.

2. **Module dependencies** — Can modules depend on other modules? For now, no. Each module depends only on brain core. If needed later, add a `dependencies` field to BrainModule.

3. **Hot reload** — Should modules be reloadable without restarting brain? Not for v1. The CLI model (run command, exit) makes this unnecessary.

4. **Module isolation level** — Should each module get its own SQLite database? No — shared DB with table prefixing is simpler, enables cross-module queries, and avoids the distributed systems problems of multi-DB.

5. **Version compatibility** — How does a module handle brain core version changes? Add `minBrainVersion` to BrainModule interface, checked at load time.

---

## Migration Path: Adding Module Support to Brain

### Core Schema Migration

Brain v0.3.0 already has an unused `metadata TEXT` column in the `notes` table. The module system requires two additional columns:

```sql
-- Migration: brain_modules_v1
ALTER TABLE notes ADD COLUMN module TEXT;
ALTER TABLE notes ADD COLUMN module_instance TEXT;

CREATE INDEX idx_notes_module ON notes(module);
CREATE INDEX idx_notes_module_instance ON notes(module, module_instance);

-- Track module system version
INSERT INTO db_meta (key, value) VALUES ('module_system_version', '1');
```

### Backward Compatibility

- Existing notes get `NULL` for `module` and `module_instance` — they continue to work identically
- The `metadata` column already exists (set to `null` by `frontmatterToRecord()`) — the module system populates it with parsed frontmatter JSON during indexing
- `NoteType` widening (`CoreNoteType | (string & {})`) is non-breaking — existing type checks continue to work
- `brain index` must be rerun after migration to populate `module` and `metadata` for existing notes

### Module Infrastructure Bootstrap

The module system is gated behind a config flag:

```typescript
// config.ts
if (config.modules) {
  const registry = new ModuleRegistry();
  await loadModules(registry, ctx);
}
// If no modules configured, brain operates identically to pre-module version
```

### Upgrade Sequence

1. Ship core schema migration (adds columns, indexes)
2. Ship module infrastructure (registry, context, loading) — tested with zero modules
3. Ship PM module as first module — proves the system works
4. Run `brain index` to populate module metadata on existing notes (if any are retroactively classified)

---

## References

- Brain codebase analysis (27 injection points identified)
- Brain types.ts — current NoteType, NoteFrontmatter interfaces
- Brain brain-db.ts — migration system, schema versioning
- Brain cli.ts — command registration pattern
- Brain search.ts — filter pipeline, fusion strategies
- Obsidian plugin model — inspiration for manifest + lifecycle pattern
- Grafana plugin system — namespace isolation, data source registration
