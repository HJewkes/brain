# Task 05: Create skill-counters.ts

## Architectural Context

`src/modules/sessions/analytics/skill-counters.ts` reads and writes skill counter brain notes (one note per skill). Each note stores `uses`, `successes`, `failures`, `gpaSum`, `gpaCount`, `utilityScore`, and a `version` integer for optimistic locking. `avgGpa` is computed as `gpaSum / gpaCount` on read. Concurrent writes are protected by a read-modify-write loop with up to 3 retries on version mismatch.

## File Ownership

**May modify:**
- `src/modules/sessions/analytics/skill-counters.ts` (create)
- `__tests__/modules/sessions/analytics/skill-counters.test.ts`

**Must not touch:**
- `src/modules/sessions/analytics/post-execution-analyzer.ts` (Task 06)
- `src/modules/sessions/analytics/gpa-scorer.ts` (Task 04)

**Read for context (do not modify):**
- `src/services/brain-service.ts` — `BrainService` type and note write helpers
- `src/modules/sessions/types.ts` — `SessionAnalytics` type

## Steps

### Step 1: Verify spec test exists
Confirm `__tests__/modules/sessions/analytics/skill-counters.test.ts` exists.
Run: `npm test -- skill-counters` — expected: ERR_MODULE_NOT_FOUND

### Step 2: Define SkillCounter interface and implement getSkillCounter
```typescript
export interface SkillCounter {
  skillName: string; uses: number; successes: number; failures: number;
  gpaSum: number; gpaCount: number; utilityScore: number; version: number; lastUpdated: string;
}
```
Note: `module: sessions`, `type: skill-counter` in frontmatter. Slug: `skill-counter-<skillName>`.
`getSkillCounter`: read note by slug; if not found, return zero-state counter with version 0.

### Step 3: Implement updateSkillCounter with optimistic locking
```
for attempt 0..2:
  read current note from disk, get version V
  if in-memory version !== V: continue (retry)
  compute new state: uses++, successes/failures++, gpaSum/gpaCount updated, utilityScore recomputed
  write note with version = V + 1
  return
log warning and skip on 3rd failure
```
`utilityScore = (successes / uses) * (gpaSum / gpaCount)` — recomputed on each update.
Session-level granularity: 1 `uses` increment per skill per session (not per invocation).

### Step 4: Implement listSkillCounters
Read all notes with `module: sessions` and `type: skill-counter`; sort by `utilityScore` descending.

### Step 5: Run test to verify it passes
Run: `npm test -- skill-counters`
Expected: all tests pass (AC-10, AC-13, NF-03)

### Step 6: Commit
```
git add src/modules/sessions/analytics/skill-counters.ts __tests__/modules/sessions/analytics/skill-counters.test.ts
git commit -m "Add skill-counters.ts: read/write skill counter notes with optimistic locking"
```

## Success Criteria

- [ ] `npm test -- skill-counters` passes (AC-10, AC-13, NF-03)
- [ ] `npx eslint src/modules/sessions/analytics/skill-counters.ts` clean
- [ ] `npx tsc --noEmit` passes
- [ ] Version mismatch retries up to 3 times; 4th attempt logs warning and skips

## Anti-patterns

- Do NOT modify files outside the ownership list
- Do NOT modify CLAUDE.md
- Do NOT add features beyond the steps
- Do NOT throw on 3rd retry failure — log warning and skip silently
