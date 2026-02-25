# Lineage System + Web Extraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Add a general-purpose lineage/provenance system (derived-from relations, cascade delete/archive, access tracking) and a web content extraction pipeline to Brain.

**Architecture:** Extends the existing repository pattern with new relation type `derived-from`, a `note_access` tracking table (schema V6), cascade operations via recursive CTE, an archive directory, and a web extraction service using `@mozilla/readability` + `turndown` + `jsdom`. All changes are additive — no breaking changes to existing schema or APIs.

**Tech Stack:** TypeScript, better-sqlite3, sqlite-vec, @mozilla/readability, turndown, jsdom, Vitest

**Design Doc:** `docs/plans/2026-02-23-research-skill-design.md`

## Dependency Graph

```
Task 1 (types + schema) ──┬──> Task 4 (cascadeDelete)
Task 2 (inbox fix)        │──> Task 5 (cascadeArchive) ──> Task 6 (lineage CLI)
Task 3 (repo helpers) ────┘──> Task 7 (access in search)
                                Task 8 (web-extract) ──> Task 9 (add --url + ingest --urls)
```

## Wave Plan

- **Wave 1** (parallel): Task 1, Task 2, Task 3
- **Wave 2** (depends on Wave 1): Task 4, Task 5, Task 8
- **Wave 3** (depends on Wave 2): Task 6, Task 7, Task 9

## Tasks

| # | Name | Files | Wave | Depends On |
|---|------|-------|------|------------|
| 1 | Types + Schema V6 migration | `src/types.ts`, `src/services/brain-db.ts`, `__tests__/services/brain-db.test.ts` | 1 | — |
| 2 | Fix inbox source preservation | `src/services/indexing.ts`, `__tests__/services/indexing.test.ts` | 1 | — |
| 3 | NoteRepo lineage + access helpers | `src/services/repos/note-repo.ts`, `__tests__/services/repos/note-repo.test.ts` | 1 | — |
| 4 | CascadeDelete on BrainDB | `src/services/brain-db.ts`, `__tests__/services/brain-db.test.ts` | 2 | Task 1, 3 |
| 5 | CascadeArchive on BrainDB | `src/services/brain-db.ts`, `src/services/indexing.ts`, `__tests__/services/brain-db.test.ts` | 2 | Task 1, 3 |
| 6 | brain lineage CLI command | `src/commands/lineage.ts`, `src/cli.ts`, `__tests__/commands/lineage.test.ts` | 3 | Task 4, 5 |
| 7 | Access tracking in search + promotion | `src/services/search.ts`, `__tests__/services/search.test.ts` | 3 | Task 3 |
| 8 | Web extraction service | `src/services/web-extract.ts`, `__tests__/services/web-extract.test.ts`, `package.json` | 2 | — |
| 9 | brain add --url + ingest --urls | `src/commands/add.ts`, `src/commands/ingest.ts`, `__tests__/commands/add.test.ts` | 3 | Task 8 |

Detailed task specs: `./briefings/task-NN.md`

## Phase Note

This plan covers **Phase 1 (Lineage Foundation)** and **Phase 2 (Web Extraction)** from the design doc. Phase 3 (Research Pipeline), Phase 4 (Claude Code Skill), and Phase 5 (Polish) will be separate plans that build on this foundation.
