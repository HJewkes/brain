# Task 04: PM Module importHints + Content Handler Rewrite

## Architectural Context

The PM module registers note types (`task`, `workstream`, `project`, `decision`, etc.) in `src/modules/pm/index.ts`. The current `PmContentHandler` in `content-handler.ts` claims `contentClasses: ['task-list']`, parses markdown pipe tables, and creates plain notes with PM metadata — but never calls `createTask()`, so imported tasks lack display IDs and don't appear in `brain pm task list`.

This task:
1. Adds `importHints` with `tableColumnAliases` and `archetypeText` to the PM task type registration
2. Rewrites `PmContentHandler` to implement the new `ContentHandler` interface (v2), receive `ExtractedItem[]` batches, auto-create a project/workstream if needed, and call `createTask()` for real PM entities

## File Ownership

**May modify:**
- `src/modules/pm/index.ts`
- `src/modules/pm/content-handler.ts`
- `__tests__/modules/pm/content-handler.test.ts`

**Must not touch:**
- `src/types.ts` (Task 1)
- `src/modules/types.ts` (Task 1)
- `src/commands/import.ts` (Task 7)

**Read for context (do not modify):**
- `src/modules/pm/data/task-ops.ts` — `createTask()`, `CreateTaskInput` interface
- `src/modules/pm/data/project-ops.ts` — `createProject()`, `CreateProjectInput`
- `src/modules/pm/data/workstream-ops.ts` — `createWorkstream()`, `CreateWorkstreamInput`
- `src/modules/pm/types.ts` — `TaskPriority`, `TaskStatus`, etc.
- `src/modules/types.ts` — new `ContentHandler` interface (from Task 1)

## Steps

### Step 1: Add importHints to PM task type registration

In `src/modules/pm/index.ts`, update the `task` note type registration to include `importHints`:

```typescript
ctx.registerNoteType({
  name: 'task',
  description: 'Actionable work item with status, priority, and ownership',
  tier: 'slow',
  schema: { /* keep existing schema */ },
  importHints: {
    tableColumnAliases: {
      name: ['title', 'name', 'task', 'item', 'summary', 'ticket'],
      status: ['status', 'state', 'stage'],
      priority: ['priority', 'urgency', 'p', 'pri', 'importance'],
      description: ['description', 'details', 'notes', 'body', 'content'],
      due_date: ['due', 'due_date', 'deadline', 'target_date', 'target'],
      category: ['category', 'type', 'kind', 'area', 'label'],
    },
    archetypeText: 'A list of actionable work items with status, priority, or ownership. Includes to-do lists, sprint backlogs, checkbox checklists, task tables, action items from meetings, and bug reports with steps to reproduce.',
  },
});
```

### Step 2: Rewrite PmContentHandler

Replace `src/modules/pm/content-handler.ts` with a handler that implements the new `ContentHandler` interface. It must:

- Claim `noteTypes: ['task']`
- Accept `ExtractedItem[]` batches
- Auto-create a PM project if none exists (name: "Imported", prefix from directory name or "IMPT")
- Auto-create a "General" workstream under the project
- Call `createTask()` for each item with mapped fields
- Also implement `LegacyContentHandler` temporarily for backward compat until Task 7 switches the import command

Key field mapping:
- `fields.name` or `item.title` → `CreateTaskInput.name`
- `fields.description` or `item.content` → `CreateTaskInput.description`
- `fields.priority` → map through priority normalizer → `CreateTaskInput.priority`
- `fields.status` → stored as metadata (PM tasks always start as `pending`)
- `fields.due_date` → `CreateTaskInput.dueDate`
- `fields.category` → `CreateTaskInput.category`

The handler needs `BrainConfig` to call `createProject`/`createWorkstream`/`createTask`. Since the `ContentHandler.materialize()` signature only gets `db` and `embedder`, extend the handler to accept `config` via constructor or a `setConfig` method.

### Step 3: Rewrite tests

Rewrite `__tests__/modules/pm/content-handler.test.ts` to test the new interface. Mock `createTask`, `createProject`, `createWorkstream` from their respective modules. Test:

- Batch of ExtractedItems creates real tasks
- Auto-creates project when none exists
- Auto-creates workstream
- Maps priority values (critical/high/medium/low)
- Uses existing active project if one exists
- Returns created note IDs
- Creates derived-from relations to source note

### Step 4: Run tests

Run: `npm test -- __tests__/modules/pm/content-handler.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/modules/pm/index.ts src/modules/pm/content-handler.ts __tests__/modules/pm/content-handler.test.ts
git commit -m "feat: rewrite PmContentHandler to create real PM tasks with auto-project creation"
```

## Success Criteria

- [ ] Tests pass: `npm test -- __tests__/modules/pm/content-handler.test.ts`
- [ ] Types check: `npm run typecheck`
- [ ] Handler creates tasks via `createTask()` (not raw `indexSingleFile`)
- [ ] Auto-creates project and workstream when none exist
- [ ] Priority mapping: `critical/urgent/p0` → `critical`, `high/p1` → `high`, etc.
- [ ] Legacy interface still works (backward compat) until Task 7

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT remove the legacy `ContentHandler` interface implementation yet — the import command still uses it until Task 7
- Do NOT add features beyond what is specified (no dependency inference, no workstream grouping logic)
