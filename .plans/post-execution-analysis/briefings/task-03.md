# Task 03: Fix session-start-handler.ts Task Ref Emission

## Architectural Context

`src/modules/sessions/hooks/session-start-handler.ts` runs once at session start. It needs to emit a `task_ref` event containing the task ID from the `BRAIN_PM_TASK` environment variable, so `aggregate.ts` can populate `taskRefs`. Emission must happen in the start handler (not the per-tool capture handler) to avoid duplicate events per AC-01/EC-02.

## File Ownership

**May modify:**
- `src/modules/sessions/hooks/session-start-handler.ts`

**Must not touch:**
- `src/modules/sessions/hooks/session-capture-handler.ts`
- `src/modules/sessions/engine/aggregate.ts` (owned by Task 01)

**Read for context (do not modify):**
- `src/modules/sessions/hooks/capture-event.ts` — event emission helper pattern
- `src/modules/sessions/types.ts` — event type constants

## Steps

### Step 1: Read the existing handler
Read `src/modules/sessions/hooks/session-start-handler.ts` fully before editing.

### Step 2: Emit task_ref event at session start
After session creation, add:
```typescript
const taskId = process.env.BRAIN_PM_TASK;
if (taskId) {
  await captureEvent(db, sessionId, 'task_ref', { taskId });
}
```
This fires once per session — the natural idempotency of the start handler prevents duplicates.

### Step 3: Verify typecheck passes
Run: `npx tsc --noEmit`
Expected: no errors

### Step 4: Commit
```
git add src/modules/sessions/hooks/session-start-handler.ts
git commit -m "Emit task_ref event at session start from BRAIN_PM_TASK env"
```

## Success Criteria

- [ ] `npx tsc --noEmit` passes
- [ ] `npx eslint src/modules/sessions/hooks/session-start-handler.ts` clean
- [ ] `task_ref` event emitted once at session start when `BRAIN_PM_TASK` is set
- [ ] No emission if `BRAIN_PM_TASK` is not set

## Anti-patterns

- Do NOT modify files outside the ownership list
- Do NOT modify CLAUDE.md
- Do NOT add features beyond the steps
- Do NOT emit `task_ref` in `session-capture-handler.ts` (fires per tool call, causes duplicates)
