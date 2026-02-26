# Task Management Framework — Design Overview

**Date:** 2026-02-25 (updated 2026-02-26)
**Status:** Streams 0+1 implemented — ready for Stream 2
**Origin:** Consolidated from brain PM module design + project orchestration prototype

---

## What Is This?

A reusable framework for managing complex AI-assisted projects through their full lifecycle: research, design, planning, execution, and verification. Built as a **brain module** with a **Claude Code orchestration layer** on top.

The system consolidates two parallel efforts: (1) a brain PM module design with principled storage primitives, data models, and dependency engines, and (2) a project orchestration prototype with battle-tested CLI patterns, agent coordination protocols, and parallel execution strategies. This framework formalizes the best of both into a unified brain module.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Claude Code                                         │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │  Skills Layer                                   │ │
│  │  brainstorming → writing-plans → orchestrator  │ │
│  └─────────────────────┬──────────────────────────┘ │
│                        │                             │
│  ┌─────────────────────▼──────────────────────────┐ │
│  │  PM Module CLI  (brain pm ...)                  │ │
│  │  Projects, workstreams, tasks, decisions        │ │
│  │  Dependency engine, state machine, dispatch     │ │
│  └─────────────────────┬──────────────────────────┘ │
│                        │                             │
│  ┌─────────────────────▼──────────────────────────┐ │
│  │  Brain Module System                            │ │
│  │  Type registration, namespace isolation,        │ │
│  │  query scoping, schema enforcement              │ │
│  └─────────────────────┬──────────────────────────┘ │
│                        │                             │
│  ┌─────────────────────▼──────────────────────────┐ │
│  │  Brain Core                                     │ │
│  │  Notes + directory-backed notes, search, memory,│ │
│  │  SQLite, knowledge graph, relations,            │ │
│  │  activities                                      │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## Design Documents

| # | Document | Scope |
|---|----------|-------|
| 01 | [Brain Module System](01-brain-module-system.md) | Module registry, namespace isolation, visibility tiers, schema enforcement, directory-backed notes, command registration, database extensions, memory integration |
| 02 | [PM Module Design](02-pm-module-design.md) | Data model (project/workstream/task/decision), state machine, dependency engine, decision propagation, CLI commands (incl. context, verify, waves), context bundling |
| 03 | [Orchestration Layer](03-orchestration-layer.md) | Orchestrator skill, adaptive automation, task routing, wave execution, worktree safety, session lifecycle, dispatch, JIT context, verification agents, telemetry |
| 04 | [Workflows & Skills](04-workflows-and-skills.md) | End-to-end workflows, skill chain (brainstorm → plan → execute), assisted walkthroughs, decision capture, retrospectives |

## Review Documents (Appendix)

Design reasoning trail from the iterative review process. Resolutions are incorporated into the main docs above.

| Document | Scope |
|----------|-------|
| [Design Review](reviews/05-design-review.md) | Self-review: consistency, gaps, feasibility, recommendations |
| [Review Resolutions](reviews/06-review-resolutions.md) | Resolution of review issues: virtual ready state, storage primitives, claim mechanism |
| [Design Review #2](reviews/07-design-review-2.md) | Full consistency, gap, and research analysis with implementation risk assessment |

## Research Documents

| Document | Scope |
|----------|-------|
| [Tools & Patterns](research/tools-and-patterns.md) | CLI task managers, AI orchestration frameworks, project management data models, plugin systems, dependency graph engines |
| [Methodologies](research/methodologies.md) | GTD, Shape Up, PARA, Kanban, Agile adaptations, Zettelkasten, ADRs |
| [Orchestration Patterns](research/orchestration-patterns.md) | Claude Code's Task/Team tools, ReAct/plan-and-execute patterns, context management, state machines, human-in-the-loop, decision propagation |

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Brain integration model | Module within brain (not independent tool) | Leverages existing search, memory, graph; one system of record |
| Namespace isolation | Module + instance frontmatter metadata | Prevents type collisions, enables query scoping |
| Visibility tiers | Public / contextual / private | Balances discoverability with noise reduction |
| Data protection | Soft (warnings) first, hard (enforcement) later | Better UX, covers 95% of cases |
| Storage extensibility | Three brain-level primitives: notes.metadata, extended relations, activities | Zero module-specific tables; modules compose brain primitives; reusable across all modules |
| State machine | 6 states with virtual computed states | Matches real execution patterns; virtual states (BLOCKED, STALE) add intelligence without complexity |
| Ready state | Virtual (+READY), never stored | Avoids cascading writes; dependency engine computes eligibility at query time |
| Dependency engine | Frontmatter as source of truth, SQL index for queries | Human-readable + fast computation |
| Orchestrator location | Claude Code skill (not standalone prompt) | Auto-loads, project-agnostic, versioned |
| Context bundling | `brain pm dispatch --json` renders everything | Clean agent isolation, no context pollution |
| Decision tracking | ADR-style notes with impact chains | Enables downstream propagation without complex event systems |
| Telemetry collection | Two-phase: metadata on complete, transcript parsing for tokens | Task tool doesn't return token counts; transcripts have full data |
| Session tracking | CLAUDE_ENV_FILE via SessionStart hook | Persists across all Bash commands; cleaner than temp files |
| Task claiming | Claim tokens with 10-min timeout | Prevents double-dispatch in parallel execution; auto-recovers from crashes |
| GTD capture | Capture notes with interactive processing | Quick inbox for ad-hoc items during sessions |
| Workspace artifacts | Directory-backed notes (content_dir on notes table) | First-class brain primitive; modules define schemas; brain manages lifecycle; FTS-indexed |
| Prompt vs summary storage | Prompts are notes; summaries live in task content_dir | Prompts are input (searchable, versioned). Summaries are output artifacts. |
| Shared workstream context | Workstream note body IS the context | No separate context.md. Single source of truth. Dispatch assembles from note body. |
| Adaptive automation | Per-project/workstream assisted vs autonomous mode | Same machinery in both modes. Only dispatch approval differs. |
| Verification approach | Separate verification agent post-implementation | Independent validation prevents self-assessment bias. Uses Haiku for cost. |
| Worktree safety | Three-layer defense (claim assignment, hook validation, orchestrator tracking) | Worktree conflicts are the most dangerous multi-agent failure mode. Defense in depth. |
| Context efficiency | Just-in-time via CLI; lean startup, on-demand retrieval | Prevents context bloat. Agents fetch what they need when they need it. |
| Wave execution | CLI computes dependency groups; orchestrator applies routing | CLI-first: deterministic DAG in code, routing decisions in skill. |

---

## Implementation Roadmap

### Stream 0: Brain Core Extensions ✅ (branch: `feat/module-system`)
1. ✅ `content_dir` column on notes table + migration (v6→v7)
2. ✅ `registerDirectorySchemas` in ModuleContext interface (via `DirectorySchema` on `ModuleNoteType`)
3. ✅ Directory lifecycle management (create, archive, delete) — `src/services/content-dir.ts`
4. ✅ FTS integration for directory-backed note files — appends indexable content in `indexSingleFile`
5. ✅ Extended `relations` table with module/module_instance columns (note: actual table is `relations`, not `note_relations`)
6. ✅ `activities` table + `ActivityRepo` CRUD — `src/services/repos/activity-repo.ts`
7. ✅ NoteType widening (`CoreNoteType | (string & {})`) + RelationType widening
8. ✅ metadata JSON population in indexer (when `module` present in frontmatter)

### Stream 1: Brain Module System ✅ (branch: `feat/module-system`)
1. ✅ Core schema migration (module, module_instance columns; populate metadata JSON)
2. ✅ ModuleRegistry + ModuleContext interfaces — `src/modules/registry.ts`, `src/modules/types.ts`
3. ✅ Module discovery, loading, and error handling — `src/modules/loader.ts`
4. ✅ NoteType widening and module-aware coercion — parser passes unknown types through when `module` present
5. ✅ Namespace columns, query scoping, visibility tiers — `getModuleNoteIds`, private note filtering in search
6. ✅ Frontmatter schema validation — `src/modules/validation.ts`
7. ✅ Command registration (Commander.js dynamic subcommands) — CLI loads module commands in `main()`
8. ✅ Module database migrations — `runModuleMigrations` in loader
9. ✅ Memory extraction integration — extraction strategy hook in `memory-extractor.ts`

**Verification:** 501 tests (72 new), zero type errors, zero lint warnings.

**Known gap:** No integration tests yet. Unit tests cover individual pieces but don't prove the full module registration → indexing → search loop works end-to-end. Recommended before starting Stream 2.

**Table name correction:** Design docs reference `note_relations` but the actual table is `relations`. Docs 01, 02, and reviews should be updated.

### Stream 2: PM Module (Core)
1. PM module skeleton (register, types, migrations)
2. Register PM relation types (depends_on, blocks, impacts) and activity types (execution, state_change, verification)
3. Project/workstream CRUD with metadata
4. Task CRUD with directory-backed notes (content_dir for summary.md, references/)
5. State machine with transitions and edge cases
6. Dependency engine (eligible computation, cycle detection, impact analysis)
7. Claim mechanism with tokens and timeout
8. Prompt lifecycle (prompt notes, dispatch assembly, staleness detection)
9. Decision propagation (impacts, prompt assembly)
10. `brain pm context` command for JIT context delivery (see doc 03)
11. `brain pm verify` command for verification plans (see doc 03)
12. `brain pm waves` command for dependency-free grouping (see doc 03)
13. Orchestration commands (next, dispatch, complete, briefing)
14. Capture/process (GTD inbox)
15. Structured error format
16. Execution telemetry (activities, two-phase collection)
17. Audit commands (cost, performance, enrich from transcripts)
18. Import tools

### Stream 3: Orchestration Layer (Integration — doc 03)
1. Orchestrator skill (SKILL.md) with session lifecycle
2. SessionStart + SubagentStop hooks for telemetry
3. Task routing engine (category + mode to agent type, model, isolation) (see doc 03)
4. Wave computation and dispatch planning (see doc 03)
5. Worktree budget management (allocation, tracking, recycling) (see doc 03)
6. Worktree validation hook (PreToolUse) (see doc 03)
7. Adaptive automation (assisted vs autonomous dispatch) (see doc 03)
8. Parallel agent dispatch with claim tokens
9. Status push protocol in dispatch prompt templates (see doc 03)
10. Verification agent dispatch (SubagentStop trigger) (see doc 03)
11. JIT context push for in-flight agents (see doc 03)
12. Assisted walkthrough mode
13. Skill chain (brainstorming → writing-plans → PM)
14. Decision capture integration
15. Session summaries and cross-session continuity

### Dependencies
- ~~Stream 0 must complete before Stream 1~~ ✅ Both complete
- ~~Stream 1 items 1-4 are prerequisites for Stream 2 to begin~~ ✅ All Stream 1 complete
- Stream 2 items 1-8 are prerequisites for Stream 3 to begin
- Within each stream, items are roughly sequential but some can overlap
- Stream 3 items 3-7 (doc 03 patterns) can be developed in parallel once basic orchestration works

### Next Steps
1. **Integration tests** for Streams 0+1 (see Verification Strategy below)
2. **Fix `note_relations` → `relations`** in docs 01, 02, and review docs
3. **Stream 2 task 1**: PM module skeleton

---

## Verification Strategy

Each stream boundary requires integration tests that prove the seams work before building the next layer on top. Unit tests cover individual functions; these tests prove the *composition*.

### After Streams 0+1 (Module System) — **gate for Stream 2**

The core question: can a module register itself, index notes with custom types, search them, validate them, and have visibility/extraction hooks fire correctly?

**V1. Smoke Test Module** (`__tests__/integration/smoke-module.test.ts`)
A minimal "widget" module that registers every extension point:
- Note type (`widget`) with a JSON Schema (required `priority` field)
- Relation type (`depends-on`)
- Filter with `contextual` visibility
- Extraction strategy (skip extraction for widgets)
- A no-op migration

Test sequence:
1. `loadModules({ modules: [widgetModule] })` → registry populated
2. Create BrainDB, index a markdown file with `module: widget`, `type: gadget` frontmatter
3. Assert: type preserved (not coerced to `'note'`), metadata JSON populated, module/moduleInstance columns set
4. Search for the note content → found in results
5. `validateNoteFrontmatter` against the widget schema → catches missing `priority`
6. Extraction strategy hook → `shouldExtract` returns false, extraction skipped
7. Private visibility filtering → private module notes excluded from general search

**V2. Migration Round-Trip** (`__tests__/integration/migration-v7.test.ts`)
- Fresh DB: create BrainDB, verify v7 schema has all new columns, tables, indexes
- Upgrade DB: build a v6 DB with raw SQL (copy `schemaV1` without v7 additions), insert some notes, open with new BrainDB, verify migration runs, existing notes untouched, new columns are null

**V3. Content Directory + FTS** (`__tests__/integration/content-dir-search.test.ts`)
- Create a note with `content-dir` pointing at a temp directory
- Put a `.md` file in that directory with distinctive text ("xylophone-quantum-42")
- Index the note
- Search for the distinctive text → note returned as a hit
- Archive the content dir → moved to `.archive/`
- Delete the content dir → removed

### After Stream 2 (PM Module) — **gate for Stream 3**

The core question: does the PM module work as a real brain module end-to-end, from CLI commands through the dependency engine to search integration?

**V4. PM Module Smoke Test** (`__tests__/integration/pm-smoke.test.ts`)
- Load the PM module via `loadModules`
- Create a project note (frontmatter: `module: pm`, `type: project`)
- Create a workstream note under the project
- Create two task notes: task-B `depends_on` task-A
- Assert: all notes indexed with correct module/type, relations stored with module scope
- Query `getModuleNoteIds({ module: 'pm', type: 'task' })` → both tasks returned
- Query `getRelationsFiltered({ module: 'pm', type: 'depends_on' })` → dependency found

**V5. State Machine + Dependency Engine** (`__tests__/integration/pm-state-machine.test.ts`)
- Create task-A (status: OPEN) and task-B (depends_on: task-A, status: OPEN)
- Assert: task-B is BLOCKED (virtual state), task-A is eligible
- Transition task-A → IN_PROGRESS → DONE
- Assert: task-B is now eligible (unblocked)
- Cycle detection: task-C depends_on task-D depends_on task-C → error

**V6. CLI Commands** (`__tests__/integration/pm-cli.test.ts`)
- Use Commander's `.parseAsync(['node', 'brain', 'pm', ...])` to test commands programmatically
- `brain pm project create` → project note written to disk
- `brain pm task list --project X` → lists tasks from DB
- `brain pm dispatch --task T --json` → outputs context bundle JSON
- `brain pm waves --project X` → outputs dependency-free groups

**V7. Directory-Backed Tasks** (`__tests__/integration/pm-content-dir.test.ts`)
- Create a task with `content_dir`
- Write `summary.md` and `references/spec.md` to the content directory
- Index → FTS includes content from both files
- Search for text unique to `spec.md` → task found
- `brain pm dispatch --task T` → context bundle includes directory contents

### After Stream 3 (Orchestration) — **gate for production**

The core question: does the full stack — skill → CLI → brain → agents — work as an integrated system?

**V8. Orchestrator Dry Run** (`__tests__/integration/orchestrator-dry-run.test.ts`)
- Create a project with workstreams and tasks in various states
- Call the wave computation logic → verify correct grouping
- Call the task routing logic → verify correct agent type/model assignment
- Call dispatch context assembly → verify JSON bundle is complete
- No actual agent spawning — this tests the decision logic

**V9. Session Lifecycle** (`__tests__/integration/orchestrator-session.test.ts`)
- Simulate session start → verify session activity recorded
- Simulate task claim → verify claim token created
- Simulate task complete → verify activity recorded, state transitioned
- Simulate session resume → verify cross-session state recovery

**V10. End-to-End Scenario** (manual or scripted)
This one is harder to automate because it involves real Claude Code agent dispatch. Best done as a scripted walkthrough:
1. `brain pm project create --name "Test Project"` with 3 tasks
2. `/orchestrator` → verifies it reads the project, identifies eligible tasks
3. Agent dispatched to one task → completes, result verified
4. `/orchestrator` (next session) → recognizes completion, offers next task
5. `brain pm audit summary` → shows telemetry

This can start as a manual checklist and graduate to a scripted integration test once the pieces are stable.

### Verification Summary

| Gate | Tests | What it Proves |
|------|-------|---------------|
| Streams 0+1 → 2 | V1-V3 | Module system composes correctly |
| Stream 2 → 3 | V4-V7 | PM module works end-to-end as a real module |
| Stream 3 → prod | V8-V10 | Full orchestration stack works |

Each gate is a hard prerequisite — don't start the next stream until the gate tests pass.

---

## What This Enables

Once built, starting a new project looks like:

```bash
# Brainstorm and design
/brainstorm "Build a web application with auth and real-time features"
# → design doc written to brain
# → writing-plans creates project in PM

# Execute
/orchestrator
# → "Project WEB initialized. 4 workstreams, 28 tasks.
#    Phase 1 has 8 eligible tasks. 3 are agent-executable.
#    Want me to fire off the agents while we work on setup?"

# Pick up next session
/orchestrator
# → "Welcome back. 3 agent tasks completed overnight.
#    2 review tasks pending. 1 human task ready.
#    Recommendation: review the auth research first."
```

```bash
# Check project spend
brain pm audit summary --project WEB --json
# → "Total: $12.40 across 28 tasks. Research: $3.20 (Sonnet), Implementation: $8.10 (Opus), Validation: $1.10 (Haiku)"
```

Every project gets: structured backlog, dependency tracking, parallel agent execution, decision capture, cross-session continuity, and brain-integrated knowledge management — automatically.
