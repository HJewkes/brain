# Brain Module System Design

**Date:** 2026-02-25
**Status:** Draft
**Depends on:** Brain codebase analysis (v0.3.0)
**Part of:** Task Management Framework — Design Series

---

## Overview

This document designs a **module system for brain** that allows first-class extensions to register custom note types, CLI commands, relation types, activity types, search filters, and memory extraction strategies — while maintaining namespace isolation, query scoping, and data protection. Modules store all data through three brain-level primitives (notes+metadata, relations, activities) rather than creating module-specific database tables.

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

  /** Register database migrations (rarely needed — most modules use the three primitives) */
  registerMigrations(migrations: ModuleMigration[]): void;

  /** Register relation types this module uses in relations */
  registerRelationTypes(types: string[]): void;   // e.g., ['depends_on', 'impacts', 'blocks']

  /** Register activity types this module writes to the activities table */
  registerActivityTypes(types: string[]): void;    // e.g., ['execution', 'state_change', 'verification']

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

  /** Register directory schemas for module note types that use managed directories */
  registerDirectorySchemas(schemas: DirectorySchema[]): void;

  /** Access brain's core services (read-only unless module owns the data) */
  readonly db: BrainDB;
  readonly config: BrainConfig;
  readonly embedder: Embedder;
}

export interface DirectorySchema {
  /** Which note type this schema applies to (e.g., 'task') */
  noteType: string;

  /** Files that must exist in the directory */
  required: string[];

  /** Files that may exist */
  optional: string[];

  /** Subdirectories that may exist */
  optionalDirs: string[];

  /** Which files to feed into brain's FTS index */
  ftsIndexable: string[];

  /** Called when a note with content_dir is created */
  onCreate?(dirPath: string, noteMetadata: Record<string, unknown>): Promise<void>;

  /** Called when a note with content_dir is archived or deleted */
  onLifecycle?(event: 'archive' | 'delete', dirPath: string): Promise<void>;
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
      "defaultProject": "webproject"
    }
  }
}
```

**Loading order:**
1. Brain core initializes (DB, config, embedder)
2. Core migrations run (including relations extension, activities table)
3. Module registry created
4. Each module's `register()` called in dependency order (registers types, relation types, activity types, commands)
5. Module migrations run (if any — most modules don't need them)
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
- Fully qualified: `module:instance:displayId` (e.g., `pm:webproject:WEB-08.05`) — used for cross-module references
- Within module context: bare display ID (e.g., `WEB-08.05`) — used in frontmatter fields like `depends_on`

```yaml
---
type: task                    # local type name (module's concept)
module: pm                    # owning module namespace
module_instance: webproject     # which project/instance (module-defined)
title: "Configure Brain CLI Access"
status: in-progress
priority: high
depends_on:
  - WEB-08.02                  # bare display ID (within module context)
---
```

**Storage in notes table:**

The `notes` table gets three new columns:

```sql
ALTER TABLE notes ADD COLUMN module TEXT;           -- NULL for non-module notes
ALTER TABLE notes ADD COLUMN module_instance TEXT;   -- NULL if not instance-scoped
ALTER TABLE notes ADD COLUMN metadata TEXT;          -- JSON blob for module-specific fields
ALTER TABLE notes ADD COLUMN content_dir TEXT;       -- NULL unless note has a managed directory
```

The `metadata` column is the extensible storage layer. Core fields (`title`, `type`, `tier`, `status`) remain as typed columns for brain's internal queries. Everything else — module-specific fields like `depends_on`, `priority`, `mode`, `claim_token` — lives in `metadata` as a JSON object.

This means:
- **Brain core** never needs schema changes for module fields
- **All modules** store and query their entity data via `json_extract(metadata, '$.field')`
- **Graph edges** between notes use brain's `relations` table (extended with module scope)
- **Workflow events** use brain's `activities` table
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

| Tier | `brain search "auth"` | `brain pm search "auth"` | `brain pm search "auth" --project webproject` |
|------|----------------------|--------------------------|---------------------------------------------|
| **public** | Yes | Yes | Yes |
| **contextual** | Only if module/instance is active | Yes | Yes |
| **private** | Never | Yes (within module) | Yes |

### How Visibility Works in Practice

**Public** — The note's title, summary, and searchable fields are indexed into brain's global FTS and vector tables. Any `brain search` query can find them. Use for: reference docs, design decisions, project summaries.

**Contextual** — The note is indexed but tagged. Global search includes it only when:
- The user has set an active module context (`brain pm use webproject`)
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
brain pm use webproject        # Sets active context: module=pm, instance=webproject
brain pm use --clear         # Clears module context
brain pm use --all           # Sets module context without instance filter
brain context                # Shows current active contexts (could have multiple)
```

Stored in `db_meta` table:
```sql
INSERT INTO db_meta (key, value) VALUES ('active_context', '{"module":"pm","instance":"webproject"}');
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

Brain's notes table has fixed typed columns (`title`, `type`, `tier`, `status`, etc.). If modules store their data in these columns, every new module field requires a core schema migration. If modules create their own tables, brain ends up with module-specific schemas that duplicate data, complicate upgrades, and prevent cross-module queries from working naturally.

### The Solution: Three Brain-Level Primitives

Instead of modules creating custom tables, brain provides three storage primitives that cover all module needs:

| Primitive | What it stores | Query mechanism | Example |
|-----------|---------------|-----------------|---------|
| **Notes + metadata** | All entity data (tasks, decisions, prompts, captures) | `json_extract(metadata, '$.field')` | Task status, priority, assignee |
| **Relations** | All graph edges between notes | SQL joins on `relations` | depends_on, impacts, blocks |
| **Activities** | All workflow events and audit trail | Filter by module + activity_type | Task executions, state changes, reviews |

Modules create **zero custom tables**. They register relation types and activity types, then read/write using brain's primitives.

#### Primitive 1: Notes + metadata JSON

Core fields (`title`, `type`, `tier`, `status`) remain as typed columns for brain's internal queries. Everything else — module-specific fields like `depends_on`, `priority`, `mode`, `claim_token` — lives in `metadata` as a JSON object, queryable via `json_extract()`.

```sql
-- All entity data lives in notes.metadata
SELECT id, json_extract(metadata, '$.display_id') as display_id,
       json_extract(metadata, '$.status') as pm_status,
       json_extract(metadata, '$.priority') as priority
FROM notes WHERE module = 'pm' AND type = 'task';
```

#### Primitive 2: Extended relations

Brain already has a `relations` table for its knowledge graph. Extend it to support module-typed, instance-scoped edges:

```sql
-- Extend existing relations
ALTER TABLE relations ADD COLUMN module TEXT;
ALTER TABLE relations ADD COLUMN module_instance TEXT;

-- Example relation types by module:
-- PM: depends_on, blocks, impacts, supersedes
-- Knowledge: relates_to, contradicts, supports, cites
-- Any module registers its own relation types
```

This replaces what would have been `pm_dependency_edges`. The dependency engine queries brain's native relation system filtered by `module = 'pm'` and `relation_type = 'depends_on'`.

#### Primitive 3: Activities (brain-level table)

A generic activity/event log for workflow tracking:

```sql
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  note_ids TEXT,            -- JSON array of related note IDs
  module TEXT,
  module_instance TEXT,
  activity_type TEXT,       -- 'execution', 'state_change', 'verification', 'capture', etc.
  actor_type TEXT,          -- 'agent', 'human', 'system'
  actor_id TEXT,
  session_id TEXT,
  metadata TEXT,            -- JSON blob for activity-specific data
  outcome TEXT,
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX idx_activities_module ON activities(module, module_instance);
CREATE INDEX idx_activities_type ON activities(module, activity_type);
CREATE INDEX idx_activities_session ON activities(session_id);
```

Any module can write activities. PM writes execution telemetry as activities with `activity_type: 'execution'` and token/model/cost data in `metadata`. A learning module writes study sessions. A CRM writes interaction logs.

### Why No Module-Specific Tables

Modules operate entirely through brain's three primitives (notes+metadata, relations, activities). This means:
- **No schema migrations** when adding a module — brain's core schema already has everything
- **Cross-module queries** work naturally — search finds all notes regardless of module, relations span modules, activities provide a unified audit trail
- **No data duplication** — task data lives in one place (the note's metadata), not mirrored across tables
- **Brain upgrades** don't break modules — modules don't own database objects that could conflict

### How Indexing Works with Modules

When brain indexes a note with `module: pm`:

```
1. Parse frontmatter (gray-matter)
2. Core fields → typed columns (title, type, tier, status, module, module_instance)
3. ALL frontmatter → metadata JSON blob (including core fields, for completeness)
4. Module's onIndex hook fires:
   - PM reads json_extract(metadata, '$.depends_on')
   - PM writes module-scoped relation entries to relations
     (for depends_on, impacts, blocks edges parsed from frontmatter)
   - Task data stays in notes.metadata — no separate table to update
5. FTS index updated (title + searchable fields from metadata)
6. Vector embeddings computed (if body content changed)
```

---

## Directory-Backed Notes

### Overview

Directory-backed notes extend brain's note primitive with an optional **managed directory** for workspace artifacts. This is a brain core feature, not module-specific — any module can use it.

The `modules/` directory lives within the notes directory and follows the same git workflow as notes. Task artifacts (summary.md, references/) are committed by the user after review.

Some notes need more than a title, metadata, and markdown body. A PM task needs a completion summary, reference files, and potentially output logs. A research note might have downloaded PDFs and data extracts. Rather than cramming everything into the note body or creating a parallel file management system, brain manages the directory as part of the note lifecycle.

### The `content_dir` Column

The `notes` table includes an optional `content_dir TEXT` column. When set:

- Brain manages a directory at `{notesDir}/modules/{module}/{content_dir}/`
- The note's `content` column (markdown body) holds searchable summary text
- The directory holds structured artifacts whose schema is defined by the owning module
- Brain's index pipeline asks the module hook "which files should I FTS-index?"

When `content_dir` is NULL (the default), the note behaves exactly as it does today — no directory management, no overhead.

### Directory Location Convention

```
{notesDir}/
├── notes/                      ← existing brain notes (markdown files)
├── modules/
│   ├── pm/                     ← PM module's managed directories
│   │   ├── WEB-01/03/          ← task WEB-01.03's content directory
│   │   │   ├── summary.md
│   │   │   └── references/
│   │   ├── WEB-02/01/
│   │   │   ├── summary.md
│   │   │   └── references/
│   │   │       └── api-spec.yaml
│   │   └── ...
│   └── crm/                    ← hypothetical CRM module
│       └── ...
└── inbox/                      ← existing brain inbox
```

The `content_dir` value stored in the database is the relative path from `{notesDir}/modules/{module}/` — e.g., `WEB-01/03` for task WEB-01.03 in the PM module.

### Module Hook Contract (DirectorySchema)

Modules that use directory-backed notes register hooks via the `registerDirectorySchemas` method on `ModuleContext` (see the interface definition above). Each `DirectorySchema` declares:

- **`noteType`** — Which note type this schema applies to (e.g., `'task'`)
- **`required` / `optional`** — Files that must or may exist in the directory
- **`optionalDirs`** — Subdirectories that may exist (e.g., `'references'`)
- **`ftsIndexable`** — Which files brain should feed into its FTS index
- **`onCreate`** — Hook called when a note with `content_dir` is created (scaffold directory)
- **`onLifecycle`** — Hook called on archive or delete (module decides cleanup behavior)

**Example:** PM module registers a directory schema for task notes:

```typescript
ctx.registerDirectorySchemas([
  {
    noteType: 'task',
    required: [],           // nothing required at creation; summary.md written on completion
    optional: ['summary.md'],
    optionalDirs: ['references'],
    ftsIndexable: ['summary.md'],
    async onCreate(dirPath) {
      await fs.mkdir(dirPath, { recursive: true });
      await fs.mkdir(path.join(dirPath, 'references'), { recursive: true });
    },
    async onLifecycle(event, dirPath) {
      if (event === 'delete') {
        await fs.rm(dirPath, { recursive: true, force: true });
      }
      // 'archive' — leave directory intact (preserves history)
    },
  },
]);
```

Not all module note types need directories. For example, PM's project, workstream, decision, prompt, and capture types store everything in the note body and metadata — only tasks produce output artifacts that warrant a managed directory.

### Indexing Integration

When brain indexes a note with a `content_dir`:

```
1. Standard indexing: parse frontmatter → notes table (title, type, module, metadata)
2. Body indexing: note's content field → FTS5 (as usual)
3. Directory indexing (new):
   a. Look up module's DirectorySchema for this note type
   b. For each file in ftsIndexable:
      - Read file content from {notesDir}/modules/{module}/{content_dir}/{file}
      - Append to FTS index entry for this note
   c. This means `brain search "authentication"` can find a task whose
      summary.md mentions authentication, even if the note body doesn't
```

After task completion, the orchestrator calls `brain index <note-id>` to update FTS for any new directory content (e.g., summary.md).

### Lifecycle Management

Brain manages the directory lifecycle in coordination with note operations:

| Note Operation | Directory Effect |
|---------------|-----------------|
| Create note with content_dir | Call module's `onCreate` hook — scaffold directory |
| Index note | Read ftsIndexable files — update FTS |
| Archive note | Call module's `onLifecycle('archive')` — module decides (PM: keep) |
| Delete note | Call module's `onLifecycle('delete')` — module decides (PM: remove) |
| Move/rename note | Update `content_dir` column; move directory if needed |

`brain doctor` detects "note references missing content directory" — cases where a note has `content_dir` set but the directory does not exist on disk.

### Path Resolution

```typescript
function resolveContentDir(note: NoteRecord, config: BrainConfig): string | null {
  if (!note.contentDir || !note.module) return null;
  return path.join(config.notesDir, 'modules', note.module, note.contentDir);
}
```

### Migration

```sql
-- Migration: brain_content_dir_v1
-- Adds nullable content_dir column to notes table
ALTER TABLE notes ADD COLUMN content_dir TEXT;

-- No separate index needed — queries on content_dir are rare (only on note creation/deletion)
-- The module + module_instance index handles scoped queries
```

### Backward Compatibility

- Existing notes get `NULL` for `content_dir` — no behavioral change
- `brain search`, `brain index`, and all existing commands work identically
- The FTS directory indexing only runs for notes with non-NULL `content_dir` and a registered `DirectorySchema`
- Modules that don't use directory-backed notes are completely unaffected
- The `{notesDir}/modules/` directory is created on first use by any module; no upfront scaffolding needed

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
brain pm init "webproject"
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

Most modules won't need migrations since the three primitives (notes+metadata, relations, activities) cover most storage needs. The migration system exists for brain core schema changes (like adding the activities table or extending relations) and for the rare module that genuinely needs custom storage beyond the primitives.

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

### Module Data Storage

Modules store all data through brain's three primitives. No module-specific tables are needed.

**Entity data** lives in notes with module-specific fields in the `metadata` JSON column. Decisions are notes with `type: decision`, queried via `json_extract()`. Prompt caching can use in-memory caches or brain-level cache mechanisms.

**Graph edges** live in `relations` with module and relation_type filtering:

```sql
-- PM dependency edge (stored in brain's relations)
-- source_id: the task that depends
-- target_id: the task it depends ON
-- relation_type: 'depends_on'
-- module: 'pm'
-- module_instance: 'webproject'

-- Eligible task query uses relations directly:
SELECT n.id, json_extract(n.metadata, '$.display_id') as display_id,
       json_extract(n.metadata, '$.title') as title
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
```

**Workflow events** live in the `activities` table, filtered by module and activity_type.

### Cascade Behavior

When brain deletes a note:

- **Relations:** Brain's native `ON DELETE CASCADE` on `relations` handles edge cleanup automatically. No module-specific cascade logic needed.
- **Activities:** Activity records referencing deleted notes keep their records (audit trail preservation). The `note_ids` entries become orphaned, which is acceptable for historical data.
- **Metadata:** Deleted with the note row itself.

For any additional cleanup beyond this, modules can still register cascade hooks:

```typescript
ctx.onNoteDelete((noteId: string) => {
  // Module-specific cleanup if needed beyond automatic cascading
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
      "defaultProject": "webproject",
      "parallelAgents": 3
    }
  }
}
```

---

## Implementation Roadmap

See [00-overview.md](00-overview.md) for the consolidated implementation roadmap.

---

## Open Questions

1. **External module distribution** — npm packages? git repos? For now, built-in only. External can come later when the interface is stable.

2. **Module dependencies** — Can modules depend on other modules? For now, no. Each module depends only on brain core. If needed later, add a `dependencies` field to BrainModule.

3. **Hot reload** — Should modules be reloadable without restarting brain? Not for v1. The CLI model (run command, exit) makes this unnecessary.

4. **Module isolation level** — Should each module get its own SQLite database? No — shared DB with three brain-level primitives (notes+metadata, relations, activities) is simpler, enables cross-module queries naturally, and avoids the distributed systems problems of multi-DB. Modules don't create their own tables.

5. **Version compatibility** — How does a module handle brain core version changes? Add `minBrainVersion` to BrainModule interface, checked at load time.

---

## Migration Path: Adding Module Support to Brain

### Core Schema Migration

Brain v0.3.0 already has an unused `metadata TEXT` column in the `notes` table. The module system requires two additional columns:

```sql
-- Migration: brain_modules_v1
ALTER TABLE notes ADD COLUMN module TEXT;
ALTER TABLE notes ADD COLUMN module_instance TEXT;
ALTER TABLE notes ADD COLUMN content_dir TEXT;       -- managed directory path (see Directory-Backed Notes)

CREATE INDEX idx_notes_module ON notes(module);
CREATE INDEX idx_notes_module_instance ON notes(module, module_instance);

-- Extend relations for module-scoped edges
ALTER TABLE relations ADD COLUMN module TEXT;
ALTER TABLE relations ADD COLUMN module_instance TEXT;

-- Activities table for workflow event tracking
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  note_ids TEXT,
  module TEXT,
  module_instance TEXT,
  activity_type TEXT,
  actor_type TEXT,
  actor_id TEXT,
  session_id TEXT,
  metadata TEXT,
  outcome TEXT,
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX idx_activities_module ON activities(module, module_instance);
CREATE INDEX idx_activities_type ON activities(module, activity_type);
CREATE INDEX idx_activities_session ON activities(session_id);

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
