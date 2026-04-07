# Task 08: Create analyze.ts CLI Command

## Architectural Context

`src/modules/sessions/commands/analyze.ts` implements `brain session analyze [session-id] [--all] [--force]`. Single-session mode calls `runPostExecutionAnalysis` and prints a result table. `--all` iterates sessions with `jsonl_path` set, runs analysis on each (using `sessionNoteMetaToScoringInput` for JSONL-only sessions), and prints a summary. `--force` overwrites existing analysis notes.

## File Ownership

**May modify:**
- `src/modules/sessions/commands/analyze.ts` (create)

**Must not touch:**
- `src/modules/sessions/commands/index.ts` (owned by Task 09 — will register this command)
- `src/modules/sessions/commands/skill-stats.ts` (Task 09)

**Read for context (do not modify):**
- `src/modules/sessions/commands/list.ts` — existing CLI command pattern (table output)
- `src/modules/sessions/analytics/post-execution-analyzer.ts` — `runPostExecutionAnalysis`, `sessionNoteMetaToScoringInput`
- `src/modules/sessions/data/` — session lookup functions

## Steps

### Step 1: Create analyze.ts with Commander subcommand
Pattern: `program.command('analyze [session-id]').option('--all').option('--force')`.
Read `src/modules/sessions/commands/list.ts` first to match the existing command pattern.

### Step 2: Implement single-session path
- Look up session by ID; if not found, exit 1 with error message
- Check for existing analysis note; if exists and `--force` not set: print "Already analyzed — use --force to re-run", exit 0
- Call `runPostExecutionAnalysis(brain, sessionId, taskDescription)`
- Print result table: GPA score, dimensions (goal, plan, action), analysis note path
- Exit 0

### Step 3: Implement --all path
- List all sessions with `jsonl_path != null`
- For each session: call `runPostExecutionAnalysis`; if session has no live events, use `sessionNoteMetaToScoringInput`
- Print "Analyzed N sessions" summary (AC-14)

### Step 4: Typecheck
Run: `npx tsc --noEmit`
Expected: no errors

### Step 5: Commit
```
git add src/modules/sessions/commands/analyze.ts
git commit -m "Add brain session analyze command with --all and --force flags"
```

## Success Criteria

- [ ] `npx tsc --noEmit` passes
- [ ] `npx eslint src/modules/sessions/commands/analyze.ts` clean
- [ ] Single-session path prints table with GPA, dimensions, note path (AC-12)
- [ ] `--force` overwrites existing analysis; without flag prints skip message (EC-03)
- [ ] `--all` prints "Analyzed N sessions" (AC-14)

## Anti-patterns

- Do NOT modify files outside the ownership list
- Do NOT modify CLAUDE.md
- Do NOT add features beyond the steps
- Do NOT register in commands/index.ts — that is Task 09's responsibility
