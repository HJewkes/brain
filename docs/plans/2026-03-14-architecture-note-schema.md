# Architecture Note Schema Design

## Overview

Architecture notes are a new note type for the `codebase` module that capture module-level codebase knowledge for AI agents. Each note describes one logical module: its purpose, public API, dependencies, and invariants.

Notes are stored at `.brain/notes/modules/codebase/<project>/<module-slug>.md` and indexed like any other brain note with frontmatter + markdown body.

## Frontmatter Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Module name (e.g., "search" or "pm/engine") |
| `type` | string | yes | Always `"architecture"` |
| `tier` | string | yes | Always `"slow"` (module summaries change infrequently) |
| `module` | string | yes | Always `"codebase"` |
| `module-instance` | string | yes | Project identifier (e.g., `"brain"`) |
| `status` | string | no | `"current"`, `"outdated"`, `"deprecated"`, `"draft"` |
| `tags` | string[] | no | Freeform tags |
| `project` | string | yes | Project name matching module-instance |
| `module_path` | string | yes | Relative path from project root (e.g., `"src/services/search.ts"`) |
| `purpose` | string | yes | One-sentence module purpose |
| `language` | string | yes | Primary language (`"typescript"`, `"python"`, etc.) |
| `export_hash` | string | yes | SHA-256 of sorted export signatures for staleness detection |
| `scanned_at` | string | yes | ISO 8601 timestamp of last scan |

## Metadata (stored in `metadata` JSON column)

The following structured data lives in the note's `metadata` JSON field, matching the PM module pattern:

```json
{
  "project": "brain",
  "module_path": "src/services/search.ts",
  "purpose": "Hybrid search orchestration combining BM25 and vector with RRF fusion",
  "language": "typescript",
  "export_hash": "a1b2c3d4...",
  "scanned_at": "2026-03-14T10:00:00Z",
  "exports": [
    {
      "name": "hybridSearch",
      "kind": "function",
      "signature": "hybridSearch(db: BrainDB, embedder: Embedder, query: string, opts: SearchOptions): Promise<SearchResult[]>"
    }
  ],
  "dependencies": {
    "internal": [
      { "path": "src/services/brain-db.ts", "imports": ["BrainDB"] },
      { "path": "src/services/reranker.ts", "imports": ["rerank"] }
    ],
    "external": [
      { "package": "better-sqlite3", "imports": ["Database"] }
    ]
  },
  "invariants": [
    "BM25 and vector scores are fused before reranking",
    "Results are capped at opts.limit after fusion"
  ]
}
```

## Module Registration Schema

The `codebase` module registers the `architecture` note type with this validation schema:

```typescript
ctx.registerNoteType({
  name: 'architecture',
  description: 'Module-level codebase architecture summary for AI agents',
  tier: 'slow',
  schema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Project identifier' },
      module_path: { type: 'string', description: 'Relative path from project root' },
      purpose: { type: 'string', description: 'One-sentence module purpose' },
      language: { type: 'string', description: 'Primary programming language' },
      export_hash: { type: 'string', description: 'SHA-256 of sorted export signatures' },
      scanned_at: { type: 'string', description: 'ISO 8601 timestamp of last scan' },
    },
    required: ['project', 'module_path', 'purpose', 'language', 'export_hash', 'scanned_at'],
  },
});
```

Visibility: `contextual` -- architecture notes should appear in search when the query relates to code structure, but not pollute general knowledge searches.

## Staleness Detection Strategy

1. **Scanner** extracts public exports from a module file (functions, classes, interfaces, constants).
2. Each export produces an `ExportSignature`: `{ name, kind, signature }`.
3. Signatures are sorted alphabetically by name, serialized to a canonical string, and SHA-256 hashed.
4. The hash is stored as `export_hash` in the note metadata.
5. On re-scan, if the new hash differs from the stored hash, the note is flagged for re-summarization.
6. If the hash matches, only `scanned_at` is updated -- no LLM call needed.

This exploits the research finding that implementation changes ~80%/cycle but exports change only ~5-10%, so most re-scans skip the expensive LLM step.

## Example: Search Module

```yaml
---
id: arch-brain-search
title: search
type: architecture
tier: slow
module: codebase
module-instance: brain
status: current
project: brain
module_path: src/services/search.ts
purpose: Hybrid search orchestration combining BM25 and vector with RRF fusion
language: typescript
export_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
scanned_at: "2026-03-14T10:00:00Z"
tags:
  - search
  - bm25
  - vector
---

## Public Exports

- `hybridSearch(db, embedder, query, opts)` -- Main search entry point. Runs BM25 and vector in parallel, fuses with RRF or score strategy, optionally reranks.
- `memorySearch(db, embedder, query, opts)` -- Searches extracted memories by vector similarity.

## Internal Dependencies

- `brain-db.ts` -- BrainDB facade for FTS5 and vector queries
- `reranker.ts` -- Cross-encoder reranking pipeline
- `search-throttle.ts` -- Token budget tracking

## External Dependencies

- `better-sqlite3` -- SQLite driver

## Invariants

- BM25 and vector scores are always fused before reranking is applied.
- Results are capped at `opts.limit` after fusion, before reranking.
- Memory search results are separate from note search results and merged at the caller level.
```

## Example: PM Engine

```yaml
---
id: arch-brain-pm-engine
title: pm/engine
type: architecture
tier: slow
module: codebase
module-instance: brain
status: current
project: brain
module_path: src/modules/pm/engine
purpose: State machine, routing, dispatch, and dependency management for the PM module
language: typescript
export_hash: "7d865e959b2466918c9863afca942d0fb89d7c9ac0c99bafc3749504ded97730"
scanned_at: "2026-03-14T10:00:00Z"
tags:
  - pm
  - state-machine
  - dispatch
---

## Public Exports

- `transitionTask(db, taskId, newStatus)` -- State machine for task lifecycle transitions with guard validation.
- `routeTask(task)` -- Determines execution mode (agent/assisted/human/review) based on task category and complexity.
- `dispatchTask(db, taskId)` -- Spawns agent or notifies human for task execution.
- `computeWaves(db, projectPrefix)` -- Calculates dependency waves for parallel execution scheduling.
- `checkConsistency(db, projectPrefix)` -- Validates referential integrity across PM entities.

## Internal Dependencies

- `pm/data/` -- CRUD operations for projects, workstreams, tasks
- `pm/types.ts` -- Type definitions and validators

## External Dependencies

- None (pure logic layer)

## Invariants

- Task transitions must pass guard validation before state is written.
- Dependency waves are computed from a DAG; cycles cause an error, not silent corruption.
- Dispatch never claims a task that is already claimed by another agent.
- Consistency checks are read-only and never mutate data.
```

## Relation Types

The codebase module registers one relation type:

- `describes` -- Links an architecture note to the project it describes. Inverse: `described_by`.

This enables graph traversal from a project note to all its architecture notes.
