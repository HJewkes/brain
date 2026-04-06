# Task 02: Fix session-post-tool-handler.ts Event Emission

## Architectural Context

`src/modules/sessions/hooks/session-post-tool-handler.ts` runs after each tool call. It currently detects PR creation but does not emit `file_touch` or `skill_use` events. This fix adds emission of those two event types (one per invocation, `count: 1`) so `aggregate.ts` can populate `filesTouched`, `filesWritten`, and `skillUsage`.

## File Ownership

**May modify:**
- `src/modules/sessions/hooks/session-post-tool-handler.ts`

**Must not touch:**
- `src/modules/sessions/engine/aggregate.ts` (owned by Task 01)
- `src/modules/sessions/hooks/session-start-handler.ts` (owned by Task 03)

**Read for context (do not modify):**
- `src/modules/sessions/hooks/capture-event.ts` — event emission helper pattern
- `src/modules/sessions/types.ts` — event type constants

## Steps

### Step 1: Read the existing handler
Read `src/modules/sessions/hooks/session-post-tool-handler.ts` fully before editing.

### Step 2: Emit file_touch event for Write tool calls
After the existing PR detection logic, add:
```typescript
if (toolName === 'Write' || toolName === 'Edit') {
  const filePath = input?.file_path ?? input?.path;
  if (filePath) {
    await captureEvent(db, sessionId, 'file_touch', { filePath, toolName });
  }
}
```

### Step 3: Emit skill_use event for Skill tool calls
```typescript
if (toolName === 'Skill') {
  const skillName = input?.skill ?? input?.name;
  if (skillName) {
    await captureEvent(db, sessionId, 'skill_use', { skillName, count: 1 });
  }
}
```

### Step 4: Verify typecheck passes
Run: `npx tsc --noEmit`
Expected: no errors

### Step 5: Commit
```
git add src/modules/sessions/hooks/session-post-tool-handler.ts
git commit -m "Emit file_touch and skill_use events in post-tool handler"
```

## Success Criteria

- [ ] `npx tsc --noEmit` passes
- [ ] `npx eslint src/modules/sessions/hooks/session-post-tool-handler.ts` clean
- [ ] `file_touch` emitted for Write and Edit tool calls
- [ ] `skill_use` emitted for Skill tool calls with `count: 1`

## Anti-patterns

- Do NOT modify files outside the ownership list
- Do NOT modify CLAUDE.md
- Do NOT add features beyond the steps
- Do NOT emit events for tools other than Write, Edit, Skill
