# Task 09: Create skill-stats.ts CLI Command and Register Both Commands

## Architectural Context

`src/modules/sessions/commands/skill-stats.ts` implements `brain session skill-stats [--json]`, which calls `listSkillCounters` and prints a table sorted by utility descending. This is also the task that wires both `analyze` and `skill-stats` into `src/modules/sessions/commands/index.ts`. Task 08 (analyze.ts) must be complete before this task runs since commands/index.ts imports from it.

## File Ownership

**May modify:**
- `src/modules/sessions/commands/skill-stats.ts` (create)
- `src/modules/sessions/commands/index.ts`

**Must not touch:**
- `src/modules/sessions/commands/analyze.ts` (Task 08, read-only context)
- `src/modules/sessions/analytics/skill-counters.ts` (Task 05)

**Read for context (do not modify):**
- `src/modules/sessions/commands/analyze.ts` — command pattern to follow
- `src/modules/sessions/commands/index.ts` — existing registrations pattern
- `src/modules/sessions/analytics/skill-counters.ts` — `listSkillCounters` interface

## Steps

### Step 1: Create skill-stats.ts
Pattern: `program.command('skill-stats').option('--json')`.
- Call `listSkillCounters(brain)`
- Print table columns: skill | uses | successRate (%) | avgGpa | utility (AC-13)
- `--json`: print raw JSON array
- Rows sorted by utility descending (already sorted by `listSkillCounters`)

### Step 2: Register both commands in commands/index.ts
Read `src/modules/sessions/commands/index.ts` fully, then add:
```typescript
import { registerAnalyzeCommand } from './analyze.js';
import { registerSkillStatsCommand } from './skill-stats.js';
// ...
registerAnalyzeCommand(sessionProgram);
registerSkillStatsCommand(sessionProgram);
```
Follow the existing registration pattern exactly.

### Step 3: Run full verification
Run: `npx tsc --noEmit`
Run: `npm test`
Run: `npx eslint src/modules/sessions/commands/`
Expected: all pass

### Step 4: Commit
```
git add src/modules/sessions/commands/skill-stats.ts src/modules/sessions/commands/index.ts
git commit -m "Add brain session skill-stats command and register analyze + skill-stats"
```

## Success Criteria

- [ ] `npm test` passes (all existing tests + session tests)
- [ ] `npx tsc --noEmit` passes
- [ ] `npx eslint src/modules/sessions/commands/` clean
- [ ] `brain session skill-stats` prints table sorted by utility desc (AC-13)
- [ ] Both `analyze` and `skill-stats` are registered in commands/index.ts
- [ ] `npx tsx src/cli.ts session --help` shows `analyze` and `skill-stats` subcommands

## Anti-patterns

- Do NOT modify files outside the ownership list
- Do NOT modify CLAUDE.md
- Do NOT add features beyond the steps
- Do NOT compute utility on read — `listSkillCounters` already returns sorted data
