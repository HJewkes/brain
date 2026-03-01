# V8 Testing Phase — Design

**Date:** 2026-02-28
**Status:** Approved
**Scope:** Fix alias regression (O-57) + comprehensive PM module test suite (unit + E2E)

---

## Problem

The PM module has regressed twice on the same feature (plural aliases) because there are zero CLI-level tests. The command handler layer (~4,100 lines across 16 files) has near-zero test coverage despite solid data/engine layer tests. The diagnostic pipeline catches these issues but costs 30+ minutes per cycle — traditional tests would catch them in seconds.

### Regression History

| Regression | Cycle | Root Cause | Could Unit Test Catch? |
|-----------|-------|-----------|----------------------|
| O-136 | v6 | `allowUnknownOption` strips options | Yes (E2E subprocess) |
| O-57 | v7 | `from: 'user'` wrong on subcommand | Yes (E2E subprocess) |
| O-135 | v6 | Briefing filters raw status only | Yes (unit) |
| O-134 | v6 | resolveProject missing auto-resolve | Yes (unit) |
| O-149 | v6 | Setup prompt dropped body instruction | Partially (snapshot) |

---

## Part 1: Alias Fix (O-57)

### Root Cause

`pmCmd.parseAsync(['node', 'brain-pm', 'task', 'list', ...tail], { from: 'user' })` — Commander's `from: 'user'` on a non-root subcommand doesn't strip the first two elements as expected. `'node'` lands as an unknown command.

### Fix

Change `from: 'user'` to `from: 'node'` on lines 245 and 255 of `src/modules/pm/index.ts`. `from: 'node'` strips `argv[0]` (node binary) and `argv[1]` (script path), leaving `['task', 'list', ...tail]` which routes correctly.

```typescript
// Before (broken)
await pmCmd.parseAsync(['node', 'brain-pm', 'task', 'list', ...tail], { from: 'user' });

// After (fixed)
await pmCmd.parseAsync(['node', 'brain-pm', 'task', 'list', ...tail], { from: 'node' });
```

Same change for the `workstreams` alias.

### Files

- `src/modules/pm/index.ts` — change `from: 'user'` to `from: 'node'` (2 locations)

---

## Part 2: Unit Tests — Command Handler Layer

### Testing Pattern

Mock `withBrain` at module level, spy on `process.stdout.write`/`process.stderr.write`, invoke Commander's `.parseAsync()` directly. No subprocess needed.

```typescript
vi.mock('../../../../src/services/brain-service.js', () => ({
  withBrain: vi.fn(async (fn) => fn(mockSvc)),
}));

let stdoutChunks: string[];
beforeEach(() => {
  stdoutChunks = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdoutChunks.push(String(chunk)); return true;
  });
});

async function runCmd(argv: string[]) {
  process.exitCode = undefined;
  const cmd = createTaskCommands();
  await cmd.parseAsync(['node', 'task', ...argv], { from: 'node' });
}
```

### Per-Command Test Categories

For each command action, test 4 categories:
1. **Option parsing** — correct filter values reach data layer
2. **Text output** — formatting matches expected pattern
3. **JSON output** — valid JSON with correct shape
4. **Error paths** — exitCode=1, stderr populated

### File Plan

| # | Test File | Source File | Lines | Tests |
|---|-----------|------------|-------|-------|
| 1 | `__tests__/modules/pm/commands/task.test.ts` (expand) | task.ts (566) | ~300 | ~25 |
| 2 | `__tests__/modules/pm/commands/project.test.ts` (new) | project.ts (242) | ~200 | ~15 |
| 3 | `__tests__/modules/pm/commands/workstream.test.ts` (new) | workstream.ts (164) | ~150 | ~12 |
| 4 | `__tests__/modules/pm/commands/orchestration.test.ts` (new) | orchestration.ts (611) | ~250 | ~20 |
| 5 | `__tests__/modules/pm/commands/decision.test.ts` (new) | decision.ts (164) | ~150 | ~12 |
| 6 | `__tests__/modules/pm/commands/audit.test.ts` (new) | audit.ts (213) | ~200 | ~15 |
| 7 | `__tests__/modules/pm/commands/context.test.ts` (new) | context.ts (93) | ~100 | ~8 |
| 8 | `__tests__/modules/pm/commands/check.test.ts` (new) | check.ts (113) | ~100 | ~8 |
| 9 | `__tests__/modules/pm/commands/prompt.test.ts` (new) | prompt.ts (133) | ~100 | ~8 |
| 10 | `__tests__/modules/pm/commands/capture.test.ts` (new) | capture.ts (110) | ~100 | ~8 |
| 11 | `__tests__/modules/pm/commands/verify-cmd.test.ts` (new) | verify.ts (164) | ~80 | ~6 |

**Total unit tests: ~137 tests, ~1,730 lines**

### Command-Specific Coverage

**task.test.ts (Tier 1, ~25 tests):**
- `list`: --project, --workstream, --status, --priority, --category, --search, --sort, --limit, --json, combined filters, empty result message, error (no project)
- `add`: basic creation, --depends-on, --json, missing workstream error
- `show`: text + json output, task not found
- `update`: field updates, --json
- `done`/`claim`/`start`: lifecycle transitions, --json
- `delete`: success + not-found

**project.test.ts (Tier 1, ~15 tests):**
- `init`: creates project + workstreams, --json, prefix collision
- `list`: text + json, empty state
- `status`: formatted output with counts, priority matrix
- `use`: sets active project, unknown prefix error
- `update`/`delete`: success + error paths

**workstream.test.ts (Tier 1, ~12 tests):**
- `add`: basic + --json
- `list`: text + json, empty state, --project filter
- `show`: text + json, not-found
- `update`/`delete`: success + error paths

**orchestration.test.ts (Tier 2, ~20 tests):**
- `next`: basic, --workstream filter, --limit, --json, empty state
- `waves`: text + json (includes depends_on), no active tasks
- `dispatch`: enriched output (peer tasks, related notes, workstream desc), --json, not-found
- `briefing`: default + --verbose (workstream breakdown, priority matrix)
- `complete`: success + missing token + not-found

**decision.test.ts (Tier 2, ~12 tests):**
- `add`: basic + --impacts + --json
- `list`: text + json + empty
- `show`: text + json + not-found
- `supersede`: success + not-found

**audit.test.ts (Tier 2, ~15 tests):**
- `summary`: default + --days filter + --json
- `cost`: default + --days + --json
- `executions`: list + --json
- `performance`: metrics output + --json

**Tier 3 (context, check, prompt, capture, verify — ~38 tests):**
- Standard CRUD coverage per command
- context: formatHuman output rendering
- check: consistency issues display + clean state
- prompt: write/read/list lifecycle
- capture: create/list/delete
- verify: suggestVerificationSteps for each category

---

## Part 3: E2E Integration Tests

### File

`__tests__/integration/pm-cli.test.ts` (new, separate from `cli.test.ts`)

### Pattern

```typescript
const CLI = `npx tsx ${join(PROJECT_ROOT, 'src', 'cli.ts')}`;

function pm(args: string): string {
  return execSync(`${CLI} pm ${args}`, {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, HOME: fakeHome, NODE_NO_WARNINGS: '1' },
  }).trim();
}
```

### Setup

`beforeAll`: init workspace, create project with `brain pm onboard`, seed 2 workstreams and 5 tasks with dependencies.

### Test Groups

| Group | Tests | What |
|-------|-------|------|
| Project init / list / status / use | 5 | Lifecycle, JSON output, active project |
| Workstream add / list / show | 4 | CRUD, JSON |
| Task add / list / show + filters | 6 | --status, --priority, --sort, --limit, --search, --json |
| Task lifecycle | 4 | claim → start → done, verify state transitions |
| **Aliases** | 3 | `tasks --json`, `tasks --priority critical --json`, `workstreams --json` |
| next / waves | 3 | Default, --workstream, --json with depends_on |
| dispatch / context | 3 | Dispatch enriched, context base, not-found |
| briefing | 2 | Default, --verbose |
| Decision CRUD | 3 | add, list, supersede |
| check | 2 | Clean state, consistency issues |

**Total: ~35 E2E tests, ~500 lines**

---

## Part 4: Regression Coverage Matrix

Every historical regression gets a dedicated test:

| Regression | Test File | Test Type | Assertion |
|-----------|-----------|-----------|-----------|
| O-57/O-136 (alias twice) | pm-cli.test.ts | E2E | `pm tasks --json` exits 0, returns array |
| O-135 (blocked count) | orchestration.test.ts | Unit | Briefing blocked count includes +BLOCKED virtual state |
| O-134 (auto-resolve) | project.test.ts | Unit | Commands work without `pm use` when 1 project exists |
| O-149 (task body) | setup-prompt.test.ts | Snapshot | Setup prompt contains `--description` instruction |

---

## Coverage Targets

| Metric | Current | Target |
|--------|---------|--------|
| PM unit line coverage | ~55% | 80%+ |
| PM branch coverage | ~60% | 80%+ |
| Command layer coverage | ~5% | 70%+ |
| E2E PM commands covered | 0 | 35+ tests |
| Historical regressions tested | 0 | 4/4 |

---

## Wave Structure

| Wave | Tasks | Gate |
|------|-------|------|
| 1 | Alias fix (O-57) + E2E test suite | typecheck + tests pass |
| 2 | Unit tests Tier 1 (task, project, workstream) | typecheck + tests pass |
| 3 | Unit tests Tier 2 (orchestration, decision, audit) | typecheck + tests pass |
| 4 | Unit tests Tier 3 (context, check, prompt, capture, verify) | typecheck + tests pass + coverage check |

---

## What's NOT in Scope

- Refactoring command handlers to extract shared functions (deferred — the unit test pattern works with vi.mock)
- Testing `orchestrate.ts` (heavy worktree mocking, already covered by wave-9 integration)
- Testing `setup.ts` / `install-hooks.ts` / `import.ts` (already have dedicated tests)
- Coverage for non-PM source files
