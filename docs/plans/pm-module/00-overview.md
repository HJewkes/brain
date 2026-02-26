# Task Management Framework — Design Overview

**Date:** 2026-02-25
**Status:** Draft — Design Phase
**Origin:** Extracted from OpenClaw project orchestration patterns

---

## What Is This?

A reusable framework for managing complex AI-assisted projects through their full lifecycle: research, design, planning, execution, and verification. Built as a **brain module** with a **Claude Code orchestration layer** on top.

The system was born from the OpenClaw setup project, where we built an ad-hoc orchestration system with markdown status files, JSON dependency graphs, workstream directories, and prompt files. This framework formalizes those patterns into a proper tool.

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
│  │  Notes, search, memory, SQLite, knowledge graph │ │
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

---

## Implementation Roadmap

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
2. Register PM relation types (depends_on, blocks, impacts) and activity types (execution, state_change)
3. Project/workstream/task/decision CRUD commands
4. Capture/process (GTD inbox)
5. State machine with transitions and edge cases
6. Dependency engine (eligible computation, cycle detection, impact analysis)
7. Claim mechanism with tokens and timeout
8. Prompt lifecycle (prompt notes, dispatch assembly, staleness detection)
9. Orchestration commands (next, dispatch, complete, briefing)
10. Decision propagation (impacts, prompt assembly)
11. Structured error format
12. Execution telemetry (activities, two-phase collection)
13. Audit commands (cost, performance, enrich from transcripts)
14. Import from OpenClaw plans

### Stream 3: Orchestration Layer (Integration)
1. Orchestrator skill (SKILL.md) with session lifecycle
2. SessionStart + SubagentStop hooks for telemetry
3. Parallel agent dispatch with claim tokens
4. Model selection by task category
5. Assisted walkthrough mode
6. Skill chain (brainstorming → writing-plans → PM)
7. Decision capture integration
8. Session summaries and cross-session continuity

### Dependencies
- Stream 2 depends on Stream 1 (module system must exist)
- Stream 3 depends on Stream 2 (PM commands must exist)
- Within each stream, items are roughly sequential but some can overlap
- Stream 1 items 1-4 are prerequisites for Stream 2 to begin
- Stream 2 items 1-8 are prerequisites for Stream 3 to begin

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
