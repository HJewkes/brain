# V15 Design: Task Data Quality Enforcement

**Date:** 2026-03-03
**Status:** Approved
**Branch:** feat/v15-data-quality

---

## Problem

V14 diagnostic revealed the worst quality scores in the series (3.8/5, 12 prompts at ≤3/5) despite best-ever efficiency. Root cause: 33/34 tasks have empty markdown bodies → 0 chunks indexed → invisible to hybrid search (BM25 + vector). This happened because new `--done-when`/`--ac`/`--refs` flags led the setup agent to put content in frontmatter instead of `--description` body. Additionally, `pm task list --json` omits `depends_on` despite 27 DB relations existing.

The fix: enforce data quality in product code, not prompts.

---

## Design

### 1. Required Description (Product Code)

**Files:** `src/modules/pm/data/task-ops.ts`, `src/modules/pm/commands/task.ts`

Make `--description` a required field:

- `task.ts`: Change `.option('--description ...')` to `.requiredOption('--description <text>', 'Task description/body content (required for search indexing)')`
- `task-ops.ts`: Change `CreateTaskInput.description` from optional to required (`description: string`)
- `task-ops.ts`: Add validation in `createTask()` — if `description` is empty/whitespace, return `fail('INVALID_INPUT', 'Task description is required — tasks without body content are invisible to search')`

**Rationale:** The V14 regression happened because agents *could* skip the body. Removing that possibility is the simplest, most direct fix. 3 lines of code.

### 2. Dependency JSON Fix (Product Code)

**File:** `src/modules/pm/data/task-ops.ts`

Fix `mergeDependsOn()` to return `[]` instead of `undefined` when no relations exist:

```ts
// Line 196-198 — before:
return relationDeps.length > 0 ? relationDeps : undefined;
// After:
return relationDeps.length > 0 ? relationDeps : (_frontmatterDeps ?? []);
```

Fix `createTask()` return value (line 283):
```ts
// Before:
depends_on: getDependencyDisplayIds(db, noteId) || undefined,
// After:
depends_on: getDependencyDisplayIds(db, noteId) ?? [],
```

**Rationale:** `depends_on: undefined` is omitted from JSON output. 27 DB relations exist but consumers see `dependencies: []`. This is a query gap, not a schema gap.

### 3. Setup Prompt Reduction

**File:** `docs/pm-module/diagnostic/prompts/setup.md`

Replace with ~2 lines:

> You are setting up a PM project for the workspace. Use `brain pm` CLI commands to create a project with workstreams and tasks based on the codebase. Run `brain pm --help` for available commands.

All quality requirements that were in the setup prompt are now enforced by:
- Product code: required `--description` (Section 1)
- Onboard skill: guidance on categories, priorities, body content (Section 4)

### 4. Onboard Skill Quality Guidance

**File:** `.claude/skills/pm-onboard/SKILL.md`

Add to Phase 3 instructions:
- "Use `--description` for every task with 2-4 sentences of context explaining what problem it solves and key technical considerations"
- "Use 3+ categories (implementation, testing, documentation, infrastructure, design)"
- "Include all priority levels — use `low` for speculative/nice-to-have items"
- "Populate workstream notes with goals, success criteria, and constraints"

This is LLM guidance complementing the hard gate in product code.

### 5. Test Infrastructure

#### 5a. Update test fixture
**File:** `__tests__/fixtures/pm-project.ts`

- Add `description` to all 6 task definitions (2-4 sentences each)
- Add `doneWhen` and `acceptanceCriteria` to 4+ tasks
- Add category variety (implementation, testing, documentation) and include `low` priority on 1-2 tasks

#### 5b. Prompt drift guard (new)
**File:** `__tests__/modules/pm/prompt-drift.test.ts`

Assertions:
- `setup.md` is ≤5 lines
- `setup.md` does NOT contain keywords: `category`, `priority`, `acceptance`, `description`, `example`
- Each `P-*.md` in `docs/pm-module/diagnostic/prompts/test-bench/` is ≤30 lines

#### 5c. Unit/integration tests (extend existing)
**File:** `__tests__/modules/pm/task-ops.test.ts`

New test cases:
- `createTask` without description → returns INVALID_INPUT error
- `createTask` with description → body written, task has chunks indexed
- `mergeDependsOn` with no relations → returns `[]`
- Task list JSON includes `depends_on: []` for all tasks (not undefined/missing)

#### 5d. Diagnostic pre-flight quality gate (new)
**File:** `scripts/diagnostic/quality-gate.sh`

Runs after setup agent, before test bench. Calls `brain pm task list --json --full` and asserts:
- Every task has non-empty body
- ≥2 distinct categories exist
- ≥1 `low` priority task exists
- All `depends_on` values are arrays

On failure: aborts with clear message. Flag `--skip-quality-gate` to bypass for debugging.

#### 5e. Wire quality gate into runner
**File:** `scripts/diagnostic/run.sh`

After `run_setup`, before `run_test_bench`: invoke `quality-gate.sh`.

---

## Files Modified

| File | Change |
|------|--------|
| `src/modules/pm/data/task-ops.ts` | Required description validation, `mergeDependsOn` fix, `createTask` return fix |
| `src/modules/pm/commands/task.ts` | `--description` → `.requiredOption()` |
| `docs/pm-module/diagnostic/prompts/setup.md` | Strip to 2 lines |
| `.claude/skills/pm-onboard/SKILL.md` | Add quality guidance to Phase 3 |
| `__tests__/fixtures/pm-project.ts` | Add realistic task bodies |
| `__tests__/modules/pm/prompt-drift.test.ts` | New — drift guard |
| `__tests__/modules/pm/task-ops.test.ts` | Extend — required desc + deps tests |
| `scripts/diagnostic/quality-gate.sh` | New — pre-flight gate |
| `scripts/diagnostic/run.sh` | Wire quality gate |

## Verification

1. `npm test` — all existing + new tests pass
2. `npm run typecheck` — no type errors
3. Manual: `brain pm task add "Test" --workstream 1` (no description) → validation error
4. Manual: `brain pm task add "Test" --workstream 1 --description "Context"` → succeeds, searchable
5. Manual: `brain pm task list --json` → `depends_on` is `[]` not missing
6. `./scripts/check.sh` — CI parity confirmed
