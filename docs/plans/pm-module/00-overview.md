# Task Management Framework — Design Overview

**Date:** 2026-02-25 (updated 2026-02-26)
**Status:** Draft — Design Phase
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
│  │  SQLite, knowledge graph, note_relations,       │ │
│  │  activities                                      │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## Design Documents

| # | Document | Scope |
|---|----------|-------|
| 01 | [Brain Module System](01-brain-module-system.md) | Module registry, namespace isolation, visibility tiers, schema enforcement, command registration, database extensions, memory integration |
| 02 | [PM Module Design](02-pm-module-design.md) | Data model (project/workstream/task/decision), state machine, dependency engine, decision propagation, CLI commands, context bundling |
| 03 | [Orchestration Layer](03-orchestration-layer.md) | Claude Code orchestrator skill, session lifecycle, task dispatch by mode, parallel execution, error handling, cross-session continuity |
| 04 | [Workflows & Skills](04-workflows-and-skills.md) | End-to-end workflows, skill chain (brainstorm→plan→execute), assisted walkthroughs, decision capture, retrospectives |
| 05 | [Design Review](05-design-review.md) | Self-review: consistency, gaps, feasibility, recommendations |
| 06 | [Design Review Resolutions](06-review-resolutions.md) | Resolution of review issues: virtual ready state, storage primitives, claim mechanism |
| 07 | [Design Review #2](07-design-review-2.md) | Full consistency, gap, and research analysis with implementation risk assessment |
| 08 | [Consolidation Overview](08-consolidation-overview.md) | How the two systems merge, what comes from where, updated implementation streams |
| 09 | [Directory-Backed Notes](09-directory-backed-notes.md) | Brain core extension: managed directories for workspace artifacts (summary.md, references/) |
| 10 | [Orchestration Enhancements](10-orchestration-enhancements.md) | Adaptive automation, task routing, wave execution, worktree safety, JIT context, verification agents |

## Research Documents

| Document | Scope |
|----------|-------|
| [Tools & Patterns](../research/tools-and-patterns.md) | CLI task managers, AI orchestration frameworks, project management data models, plugin systems, dependency graph engines |
| [Methodologies](../research/methodologies.md) | GTD, Shape Up, PARA, Kanban, Agile adaptations, Zettelkasten, ADRs |
| [Orchestration Patterns](../research/orchestration-patterns.md) | Claude Code's Task/Team tools, ReAct/plan-and-execute patterns, context management, state machines, human-in-the-loop, decision propagation |

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Brain integration model | Module within brain (not independent tool) | Leverages existing search, memory, graph; one system of record |
| Namespace isolation | Module + instance frontmatter metadata | Prevents type collisions, enables query scoping |
| Visibility tiers | Public / contextual / private | Balances discoverability with noise reduction |
| Data protection | Soft (warnings) first, hard (enforcement) later | Better UX, covers 95% of cases |
| Storage extensibility | Three brain-level primitives: notes.metadata, extended note_relations, activities | Zero module-specific tables; modules compose brain primitives; reusable across all modules |
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

### Stream 0: Brain Core Extensions (New — doc 09)
1. `content_dir` column on notes table + migration
2. `DirectoryNoteHooks` in ModuleContext interface
3. Directory lifecycle management (create, archive, delete)
4. FTS integration for directory-backed note files
5. Extended `note_relations` with module/module_instance columns
6. `activities` table (brain-level workflow event log)
7. NoteType widening (`CoreNoteType | (string & {})`)
8. metadata JSON population in indexer

### Stream 1: Brain Module System (Foundation)
1. Core schema migration (module, module_instance columns; populate metadata JSON)
2. ModuleRegistry + ModuleContext interfaces
3. Module discovery, loading, and error handling
4. NoteType widening and module-aware coercion
5. Namespace columns, query scoping, visibility tiers
6. Frontmatter schema validation
7. Command registration (Commander.js dynamic subcommands)
8. Module database migrations
9. Memory extraction integration

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
10. `brain pm context` command for JIT context delivery (doc 10)
11. `brain pm verify` command for verification plans (doc 10)
12. `brain pm waves` command for dependency-free grouping (doc 10)
13. Orchestration commands (next, dispatch, complete, briefing)
14. Capture/process (GTD inbox)
15. Structured error format
16. Execution telemetry (activities, two-phase collection)
17. Audit commands (cost, performance, enrich from transcripts)
18. Import tools

### Stream 3: Orchestration Layer (Integration — docs 03, 10)
1. Orchestrator skill (SKILL.md) with session lifecycle
2. SessionStart + SubagentStop hooks for telemetry
3. Task routing engine (category + mode to agent type, model, isolation) (doc 10)
4. Wave computation and dispatch planning (doc 10)
5. Worktree budget management (allocation, tracking, recycling) (doc 10)
6. Worktree validation hook (PreToolUse) (doc 10)
7. Adaptive automation (assisted vs autonomous dispatch) (doc 10)
8. Parallel agent dispatch with claim tokens
9. Status push protocol in dispatch prompt templates (doc 10)
10. Verification agent dispatch (SubagentStop trigger) (doc 10)
11. JIT context push for in-flight agents (doc 10)
12. Assisted walkthrough mode
13. Skill chain (brainstorming → writing-plans → PM)
14. Decision capture integration
15. Session summaries and cross-session continuity

### Dependencies
- Stream 0 must complete before Stream 1
- Stream 1 items 1-4 are prerequisites for Stream 2 to begin
- Stream 2 items 1-8 are prerequisites for Stream 3 to begin
- Within each stream, items are roughly sequential but some can overlap
- Stream 3 items 3-7 (doc 10 patterns) can be developed in parallel once basic orchestration works

---

## What This Enables

Once built, starting a new project looks like:

```bash
# Brainstorm and design
/brainstorm "Build a home automation system"
# → design doc written to brain
# → writing-plans creates project in PM

# Execute
/orchestrator
# → "Project HA initialized. 4 workstreams, 28 tasks.
#    Phase 0 has 8 eligible tasks. 3 are agent-executable.
#    Want me to fire off the agents while we work on setup?"

# Pick up next session
/orchestrator
# → "Welcome back. 3 agent tasks completed overnight.
#    2 review tasks pending. 1 human task ready.
#    Recommendation: review the network research first."
```

```bash
# Check project spend
brain pm audit summary --project HA --json
# → "Total: $12.40 across 28 tasks. Research: $3.20 (Sonnet), Implementation: $8.10 (Opus), Validation: $1.10 (Haiku)"
```

Every project gets: structured backlog, dependency tracking, parallel agent execution, decision capture, cross-session continuity, and brain-integrated knowledge management — automatically.
