# Smart Import Pipeline v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Replace the hardcoded content classification system with module-registered note types and a three-tier extraction pipeline (deterministic → local LLM → agent queue), enabling `brain import ~/my-notes` to route task content into real PM tasks end-to-end.

**Architecture:** Modules register note types with `importHints` (table column aliases, archetype text). A new extraction pipeline replaces `document-splitter.ts` + `content-classifier.ts`. Content handlers receive `ExtractedItem[]` batches instead of individual classified sections. A new `knowledge` module owns core note types; PM module's handler creates real tasks via `createTask()`.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Ollama (qwen2.5:3b for Tier 2)

## Dependency Graph

```
Task 1 (types + interfaces)
  ├── Task 2 (registry methods) ── depends on Task 1
  ├── Task 3 (knowledge module) ── depends on Task 1
  │     └── Task 6 (Tier 1 deterministic) ── depends on Tasks 2, 3, 4
  └── Task 4 (PM importHints + handler rewrite) ── depends on Task 1
        └── Task 6
              └── Task 7 (import command refactor) ── depends on Task 6
                    └── Task 8 (Tier 2 LLM classifier) ── depends on Task 7
                          └── Task 9 (Tier 3 agent queue) ── depends on Task 8
Task 5 (ContentClass removal) ── depends on Tasks 3, 4
  └── Task 7
```

## Wave Plan

- **Wave 1** (parallel): Task 1, Task 2, Task 3, Task 4
- **Wave 2** (depends on Wave 1): Task 5, Task 6
- **Wave 3** (depends on Wave 2): Task 7
- **Wave 4** (depends on Wave 3): Task 8, Task 9

## Tasks

| # | Name | Files | Wave | Depends On |
|---|------|-------|------|------------|
| 1 | ExtractedItem type + ContentHandler interface | `src/types.ts`, `src/modules/types.ts` | 1 | — |
| 2 | Registry importHints methods | `src/modules/registry.ts`, `src/modules/context.ts` | 1 | — |
| 3 | Knowledge module | `src/modules/knowledge/index.ts`, `__tests__/modules/knowledge/index.test.ts` | 1 | — |
| 4 | PM module importHints + content handler rewrite | `src/modules/pm/index.ts`, `src/modules/pm/content-handler.ts`, `__tests__/modules/pm/content-handler.test.ts` | 1 | — |
| 5 | Remove ContentClass enum + migrate references | `src/types.ts`, `src/services/content-classifier.ts`, `src/services/content-archetypes.ts`, `src/services/document-splitter.ts`, `src/modules/types.ts` | 2 | 3, 4 |
| 6 | Tier 1: Deterministic extraction | `src/services/extraction-pipeline.ts`, `src/services/extraction-tiers/deterministic.ts`, `__tests__/services/extraction-tiers/deterministic.test.ts` | 2 | 2, 3, 4 |
| 7 | Import command refactor | `src/commands/import.ts`, `__tests__/commands/import.test.ts` | 3 | 5, 6 |
| 8 | Tier 2: LLM classifier | `src/services/extraction-tiers/llm-classifier.ts`, `__tests__/services/extraction-tiers/llm-classifier.test.ts` | 4 | 7 |
| 9 | Tier 3: Agent queue | `src/services/extraction-tiers/agent-queue.ts`, `__tests__/services/extraction-tiers/agent-queue.test.ts` | 4 | 7 |

Detailed task specs: `./briefings/task-NN.md`
