# Consolidation Overview — Merging Orchestration Patterns into Brain PM

**Date:** 2026-02-26
**Status:** Draft
**Extends:** 00-overview.md, 01-brain-module-system.md, 02-pm-module-design.md, 03-orchestration-layer.md
**Part of:** Task Management Framework — Design Series

---

## Background

The PM module design (docs 01-07) provides a principled architecture: module system, data model, dependency engine, state machine, CLI, and orchestration layer. In parallel, a separate project-planning system was prototyped as a CLI-first orchestration tool for managing agent-driven workstreams with structured prompts, status tracking, and parallel execution.

This document consolidates the two systems. The PM module design is the foundation — it has the stronger storage layer, data model, and brain integration. The project-planning prototype contributes battle-tested orchestration patterns: task routing, wave-based execution, worktree isolation, structured prompt/summary templates, and status protocols.

---

## Architecture (Consolidated)

```
Claude Code Session
  ├── Orchestrator Skill (session flow, adaptive automation)
  │     ↓ calls
  ├── Brain PM CLI (brain pm status | next | dispatch | complete | verify)
  │     ↓ reads/writes
  ├── Brain Module System (registry, namespace, visibility)
  │     ↓ uses
  └── Brain Core
        ├── Notes + metadata JSON         ← all entities (docs 01, 02)
        ├── Note Relations                ← graph edges (docs 01, 02)
        ├── Activities                    ← workflow events (docs 01, 02)
        ├── Directory-backed Notes        ← NEW: content_dir for workspace artifacts (doc 09)
        └── Search + Memory + Graph       ← existing brain capabilities
```

### What Comes From Where

| Concept | Source | Reference |
|---------|--------|-----------|
| Three brain-level primitives (notes, relations, activities) | PM-module design | Docs 01, 02, 06 |
| Module system (registry, namespace, visibility, schema) | PM-module design | Doc 01 |
| Data hierarchy & identifiers (PROJECT-WS.TASK) | PM-module design | Doc 02 |
| State machine, claim tokens, dependency DAG | PM-module design | Doc 02 |
| Decision propagation, telemetry, audit | PM-module design | Docs 02, 03 |
| Session lifecycle, dispatch modes | PM-module design | Doc 03 |
| Skill chain (brainstorm → plan → execute) | PM-module design | Doc 04 |
| Directory-backed notes | **New** (consolidated) | Doc 09 |
| Task classification & routing | Orchestration prototype | Doc 10 |
| Wave-based parallel execution | Orchestration prototype | Doc 10 |
| Worktree budget & isolation safety | Orchestration prototype | Doc 10 |
| Just-in-time context delivery | **New** (consolidated) | Doc 10 |
| Verification as separate agent | **New** (consolidated) | Doc 10 |
| Adaptive automation levels | **New** (consolidated) | Doc 10 |
| Structured prompt/summary templates | Orchestration prototype | Doc 10 |
| Status push protocol (transitions only) | Orchestration prototype | Doc 10 |

### What Changes in Existing Docs

The consolidation **does not invalidate** docs 01-07. It extends them:

| Doc | Changes |
|-----|---------|
| 01 (Module System) | Add `content_dir` column to notes table schema. Add `DirectoryNoteHooks` to `ModuleContext`. See doc 09. |
| 02 (PM Module) | Task notes gain `content_dir` for output artifacts. Add `brain pm verify`, `brain pm context`, `brain pm waves` commands. See doc 10. |
| 03 (Orchestration) | Add task routing engine, wave computation, worktree management, adaptive automation, verification dispatch. See doc 10. |
| 04 (Workflows) | No changes. Skill chain and workflow phases are compatible. |

---

## Key Design Decisions (Consolidation-Specific)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage primitive for workspace artifacts | Directory-backed notes (content_dir on notes table) | First-class brain primitive; modules define directory schemas; brain manages lifecycle; searchable via FTS hooks |
| Prompt storage | Prompts are brain notes (type: prompt), not files in task content_dir | Task content_dir holds output artifacts (summary, references). Prompt notes are input instructions, searchable and versioned independently. |
| Shared workstream context | Workstream note body IS the shared context | No separate context.md file. `brain pm dispatch` pulls context from workstream note when assembling agent prompts. Single source of truth. |
| Which note types get content_dir | Only tasks | Projects, workstreams, decisions, and prompts use note body + metadata only. Tasks need content_dir for summary.md and references/. Keeps directory management minimal. |
| Wave computation ownership | CLI command (`brain pm waves`) computes dependency-free groups; orchestrator applies routing on top | CLI-first principle: deterministic DAG computation in code, routing decisions in the skill. |
| Automation level | Per-project/workstream `automation` metadata field (assisted \| autonomous) | Both levels use identical machinery (claims, WIP limits, telemetry). Only dispatch approval differs. |
| Verification approach | Separate verification agent spawned after implementation completes | Independent validation prevents self-assessment bias. Uses Haiku for speed/cost. |
| Worktree safety | Three layers: assignment at claim time, hook-based runtime validation, orchestrator-level tracking | Defense in depth. Worktree conflicts are one of the most dangerous failure modes in multi-agent execution. |

---

## Implementation Streams (Updated)

The existing roadmap (doc 00) defines three streams. The consolidation adds Stream 0 (brain core extensions) and enhances Streams 2 and 3.

### Stream 0: Brain Core Extensions (New)
_Must complete before module work._

1. `content_dir` column on notes table + migration
2. `DirectoryNoteHooks` in module context interface
3. Directory lifecycle management (create, archive, delete)
4. FTS integration for directory-backed note files
5. Extended `note_relations` with module columns (already in docs 01, 06)
6. `activities` table (already in docs 01, 06)
7. NoteType widening (already in doc 06)
8. metadata JSON population in indexer (already in doc 06)

### Stream 1: Module System (No changes from doc 00)

### Stream 2: PM Module Core (Enhanced)
_Additions from consolidation:_

- Task content_dir schema (summary.md, references/) — after CRUD
- `brain pm context` command for JIT context delivery — after orchestration commands
- `brain pm verify` command for verification plan generation — after orchestration commands
- `brain pm waves` command for dependency-free grouping — after dependency engine

### Stream 3: Orchestrator Skill + Hooks (Enhanced)
_Additions from consolidation:_

- Task routing engine (category + mode → agent type, model, isolation) — Phase 1
- Wave computation and dispatch planning — Phase 1
- Worktree budget management (allocation, tracking, recycling) — Phase 1
- Worktree validation hook — Phase 1
- Adaptive automation (assisted vs autonomous dispatch) — Phase 1
- Verification agent dispatch (SubagentStop → spawn verifier) — Phase 2
- JIT context push (state change → delta to in-flight agents) — Phase 2
- Status push protocol in agent prompt templates — Phase 1

### Critical Path

```
Stream 0 (items 1-4)
    ↓
Stream 1 (items 1-4)
    ↓
Stream 2 (items 1-5, then rest)
    ↓
Stream 3
```

---

## References

- Docs 01-07 (existing PM module design series)
- Doc 09 (directory-backed notes — this series)
- Doc 10 (orchestration enhancements — this series)
- Research: tools-and-patterns.md, methodologies.md, orchestration-patterns.md
