# Task 01: Fix aggregate.ts Capture Bugs

## Architectural Context

`src/modules/sessions/engine/aggregate.ts` converts raw `session_events` rows into `SessionAnalytics`. It currently ignores `task_ref`, `pr_created`, `file_touch`, `skill_use`, and `plan_present` events — this fix populates `taskRefs`, `prLinks`, `filesTouched`, `filesWritten`, `skillUsage`, and `planPresent`. A `parsePrUrl` helper handles PR URL parsing for AC-02.

## File Ownership

**May modify:**
- `src/modules/sessions/engine/aggregate.ts`
- `__tests__/modules/sessions/aggregate-capture-bugs.test.ts`

**Must not touch:**
- `src/modules/sessions/hooks/session-post-tool-handler.ts`
- `src/modules/sessions/hooks/session-start-handler.ts`

**Read for context (do not modify):**
- `src/modules/sessions/types.ts` — `SessionAnalytics`, `SessionEvent` interfaces

## Steps

### Step 1: Unstash spec tests
Run: `git stash list` and find `spec-tests-post-execution-analysis`
Run: `git stash pop stash@{N}` (N = index of `spec-tests-post-execution-analysis`)
Confirm `__tests__/modules/sessions/aggregate-capture-bugs.test.ts` exists.

### Step 2: Run test to verify it fails
Run: `npm test -- aggregate-capture-bugs`
Expected: multiple failures (task_ref, pr_created, file_touch, skill_use, plan_present not handled)

### Step 3: Add parsePrUrl helper and fix aggregate switch
Export from `aggregate.ts`:
```typescript
export function parsePrUrl(url: string): { number: number; repo: string; url: string } | null {
  const m = url.match(/https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { repo: m[1], number: parseInt(m[2], 10), url };
}
```
Add switch cases using underscore event names (`pr_created` not `pr:created`):
- `task_ref` → push `event.data.taskId` to a `Set<string>`, convert to array at end (dedup EC-02)
- `pr_created` → call `parsePrUrl(event.data.pr_url)`, push if non-null
- `file_touch` → add to `filesTouched` Map with tool name; if `Write`, also add to `filesWritten`
- `skill_use` → `skillUsage.set(name, (skillUsage.get(name) ?? 0) + (event.data.count ?? 1))`
- `plan_present` → set `planPresent = true`

### Step 4: Run test to verify it passes
Run: `npm test -- aggregate-capture-bugs`
Expected: all tests pass

### Step 5: Commit
```
git add src/modules/sessions/engine/aggregate.ts __tests__/modules/sessions/aggregate-capture-bugs.test.ts
git commit -m "Fix aggregate.ts: populate taskRefs, prLinks, filesTouched, skillUsage, planPresent"
```

## Success Criteria

- [ ] `npm test -- aggregate-capture-bugs` passes
- [ ] `npx eslint src/modules/sessions/engine/aggregate.ts` clean
- [ ] `npx tsc --noEmit` passes
- [ ] `parsePrUrl` is exported from aggregate.ts

## Anti-patterns

- Do NOT modify files outside the ownership list
- Do NOT modify CLAUDE.md
- Do NOT add features beyond the steps
- Do NOT use colon-separated event names (`pr_created`, not `pr:created`)
