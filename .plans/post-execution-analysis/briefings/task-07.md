# Task 07: Create session-analysis-handler.ts and Register Hook

## Architectural Context

`src/modules/sessions/hooks/session-analysis-handler.ts` is the hook handler at priority 25 that fires after `sessions:commit` (priority 20). It must return `hookAllow()` in < 50ms (NF-01) by dispatching `runPostExecutionAnalysis` asynchronously via `setImmediate`. Errors from async analysis are caught to prevent unhandled rejections. It registers in `src/modules/sessions/index.ts` under the `sessions:analysis` event.

## File Ownership

**May modify:**
- `src/modules/sessions/hooks/session-analysis-handler.ts` (create)
- `src/modules/sessions/index.ts`
- `__tests__/modules/sessions/session-analysis-handler.test.ts`

**Must not touch:**
- `src/modules/sessions/analytics/post-execution-analyzer.ts` (Task 06)
- `src/modules/sessions/hooks/session-commit-handler.ts`

**Read for context (do not modify):**
- `src/modules/sessions/hooks/session-commit-handler.ts` — pattern for hook handler shape
- `src/modules/sessions/index.ts` — existing hook registrations
- `src/hooks/registry.ts` — `HookRegistry` interface

## Steps

### Step 1: Verify spec test exists
Confirm `__tests__/modules/sessions/session-analysis-handler.test.ts` exists.
Run: `npm test -- session-analysis-handler` — expected: ERR_MODULE_NOT_FOUND

### Step 2: Create session-analysis-handler.ts
```typescript
export async function sessionAnalysisHandler(event: HookEvent): Promise<HookResult> {
  const { sessionId, taskDescription } = extractContext(event);
  setImmediate(() => {
    runPostExecutionAnalysis(brain, sessionId, taskDescription ?? null)
      .catch(err => console.warn('[sessions:analysis] analysis failed:', err));
  });
  return hookAllow();
}
```
Handler checks: if session metadata doesn't exist (commit failed), skip gracefully.

### Step 3: Register in sessions/index.ts
In `src/modules/sessions/index.ts`, add handler registration:
```typescript
registry.register('agent-done', sessionAnalysisHandler, { priority: 25, name: 'sessions:analysis' });
```
Follow the same pattern as existing registrations in that file.

### Step 4: Run test to verify it passes
Run: `npm test -- session-analysis-handler`
Expected: all tests pass (AC-15, NF-01)

### Step 5: Commit
```
git add src/modules/sessions/hooks/session-analysis-handler.ts src/modules/sessions/index.ts __tests__/modules/sessions/session-analysis-handler.test.ts
git commit -m "Add session-analysis-handler at priority 25 with fire-and-forget async"
```

## Success Criteria

- [ ] `npm test -- session-analysis-handler` passes (AC-15, NF-01)
- [ ] `npx eslint src/modules/sessions/hooks/session-analysis-handler.ts` clean
- [ ] `npx tsc --noEmit` passes
- [ ] Handler returns `hookAllow()` synchronously (< 50ms)
- [ ] Analysis dispatched via `setImmediate` (fire-and-forget)

## Anti-patterns

- Do NOT modify files outside the ownership list
- Do NOT modify CLAUDE.md
- Do NOT add features beyond the steps
- Do NOT await `runPostExecutionAnalysis` in the handler — must be fire-and-forget
