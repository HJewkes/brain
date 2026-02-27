# PM Module Wrap-Up — Design

**Date:** 2026-02-27
**Status:** Design approved, ready for implementation planning
**Scope:** Code review, documentation, setup scripts, validation checklists, e2e testing

---

## Context

Streams 0-3 are implemented: 1,006 tests, zero lint/type issues, zero TODOs. The PM module is functionally complete. This wrap-up addresses four remaining areas before the module is production-ready and open-source presentable.

## Current State

| Metric | Value |
|--------|-------|
| Source LOC | 5,956 (29 files across commands/, data/, engine/) |
| Test LOC | 7,110 (28 test files) |
| Tests | 1,006 passing |
| Design docs | 14 files, 8,685 LOC |
| User-facing docs | None |
| Setup automation | `brain pm install-hooks` exists but no unified setup |
| E2E validation | None (all tests are unit/integration, no agent interaction) |

---

## Workstream A: Code Review & Hardening

### Goal
Systematic review of PM module source and public API surface. Fix inconsistencies, type safety gaps, and missing test coverage.

### Scope
- All 29 source files under `src/modules/pm/`
- Public API surface: CLI commands, exported types, error handling patterns
- Existing integration tests (wave-1 through wave-9) — gap analysis

### Review Checklist

**Consistency:**
- Error handling: all commands use `formatError()` consistently, all set `process.exitCode` (never `process.exit()`)
- Output modes: all commands with `--json` produce valid JSON; human mode is readable
- Display ID handling: all commands uppercase input consistently
- `withBrain` usage: all DB-accessing commands wrapped properly

**Type Safety:**
- Unchecked `as` casts (especially `as TaskCategory`, `as TaskMode` in orchestrate.ts)
- Missing error paths (what happens when `getTask` returns not-found mid-flow?)
- Result<T> unwrapping: all `.ok` checks before `.data` access

**Code Quality:**
- Functions over 30 lines → extract
- Unused imports or exports
- Consistent naming patterns across layers

**Integration Test Gaps:**
- Claim → start → complete full lifecycle (currently tested in pieces across waves)
- Decision propagation through dispatch context
- Prompt versioning and staleness detection
- Worktree budget enforcement in realistic multi-task scenarios

### Deliverables
- Fix all identified issues in source
- Add missing integration tests (estimated 5-10 new tests)
- Clean passing suite

---

## Workstream B: Documentation (Open-Source Ready)

### Goal
Comprehensive user-facing documentation suitable for a GitHub repository. Five documents covering onboarding through advanced usage.

### B1: Quick-Start Guide

**File:** `docs/pm-module/quickstart.md`
**Target:** 5-minute path to first value

```
Contents:
1. Prerequisites (Node.js, brain installed)
2. Initialize a project
3. Create workstreams and tasks
4. View dependency waves
5. Run a briefing
6. Next steps (link to guide)
```

### B2: User Guide

**File:** `docs/pm-module/guide.md`
**Target:** Comprehensive reference for all PM workflows

```
Contents:
1. Projects — create, configure, manage lifecycle
2. Workstreams — organize parallel work tracks
3. Tasks — CRUD, state machine, dependencies, priorities
4. Dependencies & Waves — DAG construction, wave computation, eligible tasks
5. Claims & Dispatch — token mechanism, context bundling, agent routing
6. Decisions — ADR-style records, impact tracking, propagation
7. Prompts — versioning, staleness detection, rendering
8. Capture & Inbox — quick capture, processing pipeline
9. Verification — plans, checks, recording outcomes
10. Audit & Telemetry — cost tracking, performance metrics
11. Orchestration — routing, worktree management, session lifecycle
12. Configuration — automation modes, WIP limits, worktree budget
```

Each section includes: concept explanation, CLI examples, common patterns.

### B3: Architecture Overview

**File:** `docs/pm-module/architecture.md`
**Target:** Contributors understanding the codebase

```
Contents:
1. Module system integration (how PM plugs into brain)
2. Layer architecture (commands → data → engine)
3. Data model (notes as storage, metadata JSON, relations)
4. State machine (6 states, virtual states, transitions)
5. Dependency engine (DAG, waves, eligible computation)
6. Routing table (category+mode → agent configuration)
7. Template rendering (prompt assembly pipeline)
8. Key design decisions (with rationale)
```

Distilled from the 14 design docs into a single accessible document.

### B4: Demo Workflow

**File:** `docs/pm-module/demo.md`
**Target:** Compelling end-to-end scenario showing full value

```
Scenario: "Build a CLI Todo App"
1. Initialize project with prefix TODO, 2 workstreams (core, tests)
2. Create 6 tasks with dependencies across workstreams
3. View wave plan — shows 3 waves of parallel work
4. Run briefing — shows eligible tasks, recommendations
5. Claim and dispatch first task — show routing, context bundle
6. Record a decision during execution
7. Complete task — show dependent unblocking
8. Run audit — show cost/performance metrics
9. Session end — show summary
```

This becomes the basis for e2e tests in Workstream E.

### B5: Command Reference

**File:** `docs/pm-module/commands.md`
**Target:** Quick lookup for all `brain pm` commands

Generated from CLI help output plus usage examples. Organized by command group (project, workstream, task, decision, prompt, capture, orchestrate, audit, admin).

### Deliverables
- 5 markdown documents committed to `docs/pm-module/`
- All code examples verified against current CLI

---

## Workstream C: Setup & Installation

### Goal
Single-command setup that installs all orchestration components and validates the installation.

### C1: Setup Command

Extend `brain pm install-hooks` or create `brain pm setup` that:

1. Runs `install-hooks` (shell scripts + settings.json + SKILL.md)
2. Validates installation:
   - Hook files exist and are executable
   - Settings.json has correct entries
   - SKILL.md is loadable
3. Creates a sample project (optional, with `--demo` flag)
4. Prints human-readable status and next steps

### C2: Verification Script

`brain pm doctor` extension or standalone script that checks:
- All hook files present and executable
- Settings.json entries correct
- Active project configured
- Database healthy
- Recent session data (if applicable)

### Deliverables
- Enhanced setup command
- Verification output in `brain pm doctor`

---

## Workstream D: Human-Interactive Validation Checklists

### Goal
Step-by-step checklists for features requiring real Claude Code agent interaction. Each checklist is a markdown file with numbered steps, expected outcomes, and pass/fail checkboxes.

### D1: Orchestrator Skill Validation

**File:** `docs/pm-module/validation/orchestrator-walkthrough.md`

```
Prerequisites:
- brain pm setup completed
- Active project with tasks in various states

Steps:
1. Open Claude Code in project directory
2. Verify: SessionStart hook fires, BRAIN_PM_ORCHESTRATE=1 set
3. Verify: Orchestrator skill activates, presents briefing
4. Say "dispatch the next eligible task"
5. Verify: Routing computed, worktree allocated (if applicable)
6. Verify: Agent prompt rendered with context bundle
7. Verify: Agent spawned with correct model
8. Wait for agent completion
9. Verify: Verification agent triggers (for implementation tasks)
10. Verify: Task status transitions correctly
11. Say "end session"
12. Verify: Session summary with task counts and worktree status

Expected: All steps produce correct output, no errors
```

### D2: Assisted Walkthrough Validation

**File:** `docs/pm-module/validation/assisted-walkthrough.md`

Steps for testing assisted mode: task with `mode: assisted`, orchestrator presents steps, human confirms each, decisions captured.

### D3: Skill Chain Validation

**File:** `docs/pm-module/validation/skill-chain.md`

Steps for testing the brainstorming → writing-plans → PM creation flow.

### D4: Decision Capture Validation

**File:** `docs/pm-module/validation/decision-capture.md`

Steps for testing decision recording and propagation during agent execution.

### Deliverables
- 4 validation checklist documents
- Each is self-contained with prerequisites, steps, expected outcomes

---

## Workstream E: End-to-End Testing

### Goal
Automated tests for the documented demo workflow and skill integration. Research-driven approach.

### E1: Research Spike — Headless Testing Approaches

**Finding:** Three viable approaches for automated Claude Code testing:

| Approach | How | Best For |
|----------|-----|----------|
| `claude -p` headless | Shell script, `--allowedTools`, `--output-format json` | Quick smoke tests, CI |
| Agent SDK (TypeScript) | `@anthropic-ai/claude-agent-sdk`, callback hooks | Trace-based assertions, tool-use validation |
| Promptfoo | YAML eval configs with `claude-agent-sdk` provider | Regression testing, comparison across changes |

**Recommendation:** Start with `claude -p` for basic validation (hooks fire, skill loads, commands work). Graduate to Agent SDK for trace-based tests if deeper validation needed.

**Limitations:**
- User-invoked skills (`/orchestrator`) only work in interactive mode, not `-p` mode
- Agent SDK can load project skills via `settingSources: ['project']`
- Real agent dispatch costs money — budget-cap with `--max-budget-usd`

### E2: Demo Workflow Tests

Convert the demo from Workstream B4 into automated tests:

1. **CLI-level tests** (no agent interaction) — `brain pm` commands in sequence, assert on JSON output. These are standard integration tests.
2. **Headless agent tests** (via `claude -p`) — verify hooks fire, skill detects active project, briefing works.
3. **Full agent dispatch test** (via Agent SDK or `claude -p`) — spawn an agent for a simple task, verify completion. Budget-capped.

### E3: Hook & Skill Trigger Tests

Validate the installation works end-to-end:
- SessionStart hook sets `BRAIN_PM_ORCHESTRATE=1` when active project exists
- PreToolUse hook validates worktree paths (mock scenario)
- SKILL.md loads and is accessible to Claude Code

### Deliverables
- Research summary document with recommended approach
- CLI-level demo integration tests (wave-10 file)
- Headless agent smoke tests (if viable with budget constraints)
- Hook trigger validation tests

---

## Dependency Graph

```
A: Code Review ──────────────┐
                              ├── E: E2E Tests (needs demo from B4)
B: Documentation ────────────┤
                              │
C: Setup & Installation ─────┘

D: Validation Checklists ──── (independent, can run parallel)
```

- **A** and **B** can run in parallel (different file sets)
- **C** depends on A (setup should reference clean API)
- **D** is independent (checklists are documentation)
- **E** depends on B4 (demo workflow must exist before converting to tests) and C (setup must work)

## Wave Plan

| Wave | Tasks | Parallel? |
|------|-------|-----------|
| 1 | A (code review) + B (documentation) + D (checklists) | Yes |
| 2 | C (setup) | After A |
| 3 | E (e2e tests) | After B4 + C |

## Estimated New Files

| File | Type |
|------|------|
| `docs/pm-module/quickstart.md` | Documentation |
| `docs/pm-module/guide.md` | Documentation |
| `docs/pm-module/architecture.md` | Documentation |
| `docs/pm-module/demo.md` | Documentation |
| `docs/pm-module/commands.md` | Documentation |
| `docs/pm-module/validation/orchestrator-walkthrough.md` | Checklist |
| `docs/pm-module/validation/assisted-walkthrough.md` | Checklist |
| `docs/pm-module/validation/skill-chain.md` | Checklist |
| `docs/pm-module/validation/decision-capture.md` | Checklist |
| `__tests__/integration/pm/wave-10-e2e.test.ts` | Tests |
| Source fixes from code review | Patches |

## Success Criteria

- [ ] Code review complete: all identified issues fixed
- [ ] Integration test gaps filled: full lifecycle paths covered
- [ ] 5 documentation files written and verified
- [ ] Setup command works end-to-end
- [ ] 4 validation checklists written
- [ ] E2E research spike completed with recommended approach
- [ ] Demo workflow automated as integration test
- [ ] All tests pass, types clean, lint clean
- [ ] Overview doc (`00-overview.md`) updated to reflect completed status
