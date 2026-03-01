# V7 Diagnostic Fixes — Design

**Date:** 2026-02-28
**Status:** Draft
**Observations addressed:** O-102, O-113, O-134, O-135, O-136, O-137, O-142, O-143, O-144, O-149

---

## Problem

V6 fixed plumbing issues (virtual states, display ID resolution, NOT_FOUND guidance, frontmatter filter, cheat sheet) but quality remained flat at 3.5/5. Three regressions introduced in V6 cancelled the gains:

1. **Plural aliases don't pass options** (O-136) — 11/30 prompts hit this. `brain pm tasks --priority critical` fails.
2. **Task bodies empty** (O-149) — 0% body completeness (was 100% in v5). 7/30 prompts degraded.
3. **Briefing shows "Blocked: 0"** (O-135) — filters by raw status, not virtual states.

Beyond regressions, quality floors in Context Assembly (2.7/5), Agent Commands (2.5/5), and Cross-System (2.5/5) are driven by:
- Dispatch output identical to context (O-102, 6th cycle)
- Active project not auto-resolved (O-134)
- Search matches titles only, not workstream names (O-143)
- Missing UX basics: `--sort`, `--limit`, `next --workstream`, `waves --json depends_on`

## Design Principles

1. **Fix regressions first.** V6 introduced bugs. Those are non-negotiable.
2. **Move the quality floor.** Target the worst categories (Context Assembly, Agent Commands) with structural fixes, not workarounds.
3. **Make dispatch useful.** After 6 cycles of deferral, wire search into dispatch for genuine agent briefs.
4. **Independent fixes, parallel waves.** Each fix touches distinct files or distinct sections. No ordering dependencies within waves.

---

## Fix A: Plural Alias Option Passthrough (O-136)

### Problem
`brain pm tasks --priority critical --json` fails with "too many arguments" or "unknown option". The V6 alias uses `allowUnknownOption(true)` but Commander strips options before the action fires. Hit in 11/30 prompts — the most frequent friction source.

### Design
Replace the Commander-based alias approach. Instead of creating a Command with `.allowUnknownOption(true)`, use `process.argv` slicing to rewrite the command and re-parse:

```typescript
const tasksAlias = new Command('tasks')
  .description('List tasks (alias for "task list")')
  .helpOption(false)
  .action(async () => {
    // Rewrite argv: replace 'tasks' with 'task', 'list' and re-parse
    const idx = process.argv.indexOf('tasks');
    const tail = process.argv.slice(idx + 1);
    await pmCmd.parseAsync(['node', 'brain-pm', 'task', 'list', ...tail], { from: 'user' });
  });
```

The key insight: the alias should parse *nothing* — no options, no arguments. It just delegates. Using `helpOption(false)` prevents Commander from intercepting `--help`. All unknown tokens pass through in `process.argv`.

Similarly for `workstreams` → `workstream list`.

### Files changed
- `src/modules/pm/index.ts` — rewrite alias commands

### Tests
- `brain pm tasks --priority critical --json` returns same results as `brain pm task list --priority critical --json`
- `brain pm tasks --status blocked` works
- `brain pm tasks --search "test"` works
- `brain pm workstreams --json` works
- `brain pm tasks` with no flags works (bare listing)

---

## Fix B: Task Body Generation in Setup Prompt (O-149)

### Problem
The diagnostic setup prompt (`prompts/setup.md`) is a single line: "I just installed brain. Help me set up project management for ~/Documents/projects/voltras-workspace". The synthesis agent creates tasks with correct metadata but zero body content. All 41 tasks have `body: ""`.

### Design
Expand `prompts/setup.md` with explicit body generation instructions:

```markdown
For every task created with `brain pm task add`, you MUST include a `--description` flag with:
1. A 2-3 sentence "done" description (what does complete look like?)
2. Acceptance criteria as a bullet list (3-5 items)
3. References to relevant docs, files, or code locations discovered during analysis

Example:
brain pm task add "Fix BLE reconnection timeout" \
  --workstream 1 --priority high --category bug \
  --description "The node-sdk BLE adapter drops connections after 30s idle without attempting reconnection. Done: adapter implements exponential backoff retry (3 attempts, 1s/2s/4s) with configurable timeout.\n\nAcceptance criteria:\n- Reconnection attempts logged at debug level\n- Timeout configurable via constructor option\n- Unit test covers retry exhaustion path\n\nRef: packages/node-sdk/src/ble-adapter.ts, docs/bluetooth-protocol.md §Connection Lifecycle"
```

Also add instructions for:
- Setting `mode: manual` for tasks requiring physical hardware or human interaction
- Writing a project note body (not just title echo)
- Sequential task numbering within workstreams (no gaps)

### Files changed
- `docs/pm-module/diagnostic/prompts/setup.md` — expand with body/quality instructions

---

## Fix C: Briefing Blocked Count Uses Virtual States (O-135)

### Problem
`orchestration.ts` line 342: `const blocked = allTasks.filter(t => t.status === 'blocked')`. Since V6, `listTasks()` returns `virtualStates` on each task, but the briefing doesn't use it. Briefing shows "Blocked: 0" despite 9 dependency-blocked tasks.

### Design
Change the blocked filter to include both raw status and virtual state:

```typescript
const blocked = allTasks.filter(
  (t) => t.status === 'blocked' || t.virtualStates?.includes('+BLOCKED')
);
```

Also update the workstream breakdown (line 399) to use the same logic:
```typescript
blocked: wsTasks.filter(
  (t) => t.status === 'blocked' || t.virtualStates?.includes('+BLOCKED')
).length,
```

### Files changed
- `src/modules/pm/commands/orchestration.ts` — briefing blocked filter

---

## Fix D: Active Project Auto-Resolution (O-134)

### Problem
`resolveProject()` fails when no explicit prefix given and no active project set, even when exactly one project exists. After `brain reset` + `brain pm onboard`, the onboard command doesn't call `setActiveProject`. Agents see "no active project set" on every first command despite `brain pm list` showing `(active)` (which is the project's lifecycle status, not the context marker).

### Design
In `resolveProject()`, add a fallback: when `getActiveProject` returns null, query all projects. If exactly 1 exists, auto-resolve to its prefix and persist it via `setActiveProject`:

```typescript
export function resolveProject(db: BrainDB, explicit: string | undefined): Result<string> {
  if (explicit) return ok(explicit.toUpperCase());
  const active = getActiveProject(db);
  if (active) return ok(active);

  // Auto-resolve single project
  const projects = getPmNotes(db, 'project');
  if (projects.length === 1) {
    const meta = JSON.parse(projects[0].metadata!) as Record<string, unknown>;
    const prefix = meta.prefix as string;
    setActiveProject(db, prefix);
    return ok(prefix);
  }

  if (projects.length > 1) {
    const prefixes = projects.map(p => {
      const m = JSON.parse(p.metadata!) as Record<string, unknown>;
      return m.prefix as string;
    });
    return fail('INVALID_INPUT',
      `Multiple projects found: ${prefixes.join(', ')}. Use --project <prefix> or "brain pm use <prefix>" to set context.`
    );
  }

  return fail('INVALID_INPUT',
    'No projects found. Run "brain pm onboard <name>" to create one.'
  );
}
```

Also add `setActiveProject` to the onboard command's project creation path.

### Files changed
- `src/modules/pm/data/queries.ts` — auto-resolve single project, improve error messages
- `src/modules/pm/commands/onboard.ts` — call `setActiveProject` after project creation

---

## Fix E: Search Matches Workstream Names (O-143)

### Problem
`task list --search analytics` returns 0 results even though VOLTR-05 (Analytics Accuracy and Completeness) has 7 tasks. The `--search` filter only matches task title substrings.

### Design
In `listTasks()`, when `search` filter is active, also match against the parent workstream's title and description. Load workstream metadata once per project (single query), build a `Map<number, { title: string; description?: string }>`, and include tasks whose workstream title/description contains the search term:

```typescript
// In listTasks after initial filter
if (filters.search) {
  const term = filters.search.toLowerCase();
  const wsMap = buildWorkstreamMap(db, project);

  filtered = filtered.filter((t) => {
    // Match task title
    if (t.title.toLowerCase().includes(term)) return true;
    // Match workstream title/description
    const ws = wsMap.get(t.workstream);
    if (ws?.title.toLowerCase().includes(term)) return true;
    if (ws?.description?.toLowerCase().includes(term)) return true;
    return false;
  });
}
```

### Files changed
- `src/modules/pm/data/task-ops.ts` — extend search filter to workstream names

---

## Fix F: Dispatch Enrichment (O-102)

### Problem
`assembleContext()` returns `relatedNotes: []` always. `dispatch` and `context` commands produce identical output. This has been confirmed for 6 consecutive diagnostic cycles.

### Design
Create `assembleDispatch()` that extends `assembleContext` with search-based enrichment:

```typescript
export interface DispatchBundle extends ContextBundle {
  peerTasks: Array<{ displayId: string; title: string; status: string }>;
  workstreamDescription: string;
  downstreamDependents: Array<{ displayId: string; title: string }>;
}

export async function assembleDispatch(
  db: BrainDB,
  embedder: Embedder,
  config: BrainConfig,
  taskDisplayId: string
): Promise<Result<DispatchBundle>> {
  // 1. Get base context
  const ctxResult = assembleContext(db, taskDisplayId);
  if (!ctxResult.ok) return ctxResult;
  const ctx = ctxResult.data;

  // 2. Semantic search for related notes
  const searchQuery = `${ctx.task.title} ${ctx.body}`.trim();
  if (searchQuery) {
    const results = await search(db, embedder, searchQuery, {
      limit: 5,
      includePm: true,
    }, config.fusionWeights);
    ctx.relatedNotes = results.map(r => ({
      title: r.title,
      excerpt: r.excerpt ?? '',
      score: r.score,
    }));
  }

  // 3. Peer tasks in same workstream
  const peersResult = listTasks(db, ctx.task.project, { workstream: ctx.task.workstream });
  const peerTasks = peersResult.ok
    ? peersResult.data
        .filter(t => t.display_id !== taskDisplayId)
        .map(t => ({ displayId: t.display_id, title: t.title, status: t.status }))
    : [];

  // 4. Workstream description
  const wsResult = getWorkstream(db, ctx.task.project, ctx.task.workstream);
  const workstreamDescription = wsResult.ok ? (wsResult.data.description ?? '') : '';

  // 5. Downstream dependents (who depends on this task)
  const allTasksResult = listTasks(db, ctx.task.project);
  const downstreamDependents = allTasksResult.ok
    ? allTasksResult.data
        .filter(t => t.depends_on?.includes(taskDisplayId))
        .map(t => ({ displayId: t.display_id, title: t.title }))
    : [];

  return ok({
    ...ctx,
    peerTasks,
    workstreamDescription,
    downstreamDependents,
  });
}
```

Update both the `dispatch` command in `orchestration.ts` and the `context` command in `context.ts` to call `assembleDispatch` instead of `assembleContext`. Both command handlers use `withBrain` which provides access to the embedder.

Update `formatHuman` in context.ts (or create `formatDispatchHuman` in orchestration.ts) to render the new sections:
- `--- Peer Tasks ---` — other tasks in the same workstream
- `--- Workstream ---` — workstream description
- `--- Downstream ---` — tasks that depend on this one
- `--- Related Notes ---` (already in template, now populated)

**Note:** The V7 implementation only updated `orchestration.ts` (dispatch), leaving `context.ts` still calling `assembleContext` with empty `relatedNotes`. This was fixed in V8 (commit `5723c9e`).

### Files changed
- `src/modules/pm/engine/dispatch.ts` — add `assembleDispatch`, `DispatchBundle` type
- `src/modules/pm/commands/orchestration.ts` — dispatch command uses `assembleDispatch`, format new sections
- `src/modules/pm/commands/context.ts` — context command uses `assembleDispatch` (fixed in V8)

---

## Fix G: Workstream ID Routing Hint (O-142)

### Problem
`brain pm task show VOLTR-03` returns NOT_FOUND with no hint that VOLTR-03 is a workstream display ID.

### Design
In the NOT_FOUND error path of `resolveDisplayId` (or `getTask`), check if the ID matches the workstream display ID pattern (`PREFIX-NN` without task number `.MM`). If a workstream with that display_id exists, include a routing hint:

```
"VOLTR-03 is a workstream, not a task. Try: brain pm workstream show VOLTR-03"
```

Implementation: in `queries.ts` where NOT_FOUND errors are enriched (from V6 Fix C), add a check:

```typescript
// If ID matches PREFIX-NN pattern (no .MM), check if it's a workstream
if (/^[A-Z]+-\d{2}$/.test(displayId)) {
  const wsNotes = getPmNotes(db, 'workstream', { display_id: displayId });
  if (wsNotes.length > 0) {
    return fail('NOT_FOUND',
      `"${displayId}" is a workstream, not a task. Try: brain pm workstream show ${displayId}`
    );
  }
}
```

### Files changed
- `src/modules/pm/data/queries.ts` — workstream routing hint in NOT_FOUND

---

## Fix H: Task List `--sort` and `--limit` (O-144)

### Problem
No `--sort priority --limit 3` on `brain pm task list`. Agents must retrieve all tasks and pipe through python to get top-N.

### Design
Add `--sort <field>` and `--limit <n>` options to the task list command:

**Sort fields:**
- `priority` — canonical order: critical(0) > high(1) > medium(2) > low(3)
- `workstream` — by workstream number
- `status` — pending > claimed > in-progress > blocked > done
- `created` — by note creation timestamp (newest first)

**Implementation in task-ops.ts:**
```typescript
const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// After all filters applied:
if (sort) {
  filtered.sort((a, b) => {
    switch (sort) {
      case 'priority': return (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
      case 'workstream': return a.workstream - b.workstream;
      default: return 0;
    }
  });
}
if (limit) {
  filtered = filtered.slice(0, limit);
}
```

**CLI in task.ts:**
```typescript
.option('--sort <field>', 'Sort by: priority, workstream, status, created')
.option('--limit <n>', 'Limit results', parseInt)
```

### Files changed
- `src/modules/pm/commands/task.ts` — add --sort and --limit options
- `src/modules/pm/data/task-ops.ts` — sort and limit logic

---

## Fix I: `next --workstream` and `--json` (O-137)

### Problem
`brain pm next` has no workstream filter (forces `--limit 50` + python pipe) and no `--json` output (caps with "and N more").

### Design
Add `--workstream <n|PROJ-NN>` filter using `resolveWorkstreamFilter` from V6. Add `--json` flag that outputs the full eligible list as a JSON array without truncation.

```typescript
nextCmd
  .option('--workstream <ws>', 'Filter by workstream number or display ID')
  .option('--json', 'Output JSON (no truncation)')
```

When `--workstream` is provided, filter the eligible list by workstream number. When `--json` is provided, output the full array.

### Files changed
- `src/modules/pm/commands/orchestration.ts` — next command options

---

## Fix J: `waves --json` Includes `depends_on` (O-113)

### Problem
`waves --json` task objects omit `depends_on`. Agents need a second `pm tasks` call to understand blocking relationships.

### Design
The waves command currently builds its own task objects. Since V6, `listTasks()` returns `depends_on` on each task. Update the waves JSON output to include `depends_on` from the task data.

### Files changed
- `src/modules/pm/commands/orchestration.ts` — waves JSON includes depends_on

---

## File Change Summary

| # | File | Fixes | Type | Est. Lines |
|---|------|-------|------|-----------|
| 1 | `src/modules/pm/index.ts` | A | Edit | +20 |
| 2 | `docs/pm-module/diagnostic/prompts/setup.md` | B | Edit | +40 |
| 3 | `src/modules/pm/commands/orchestration.ts` | C, I, J | Edit | +80 |
| 4 | `src/modules/pm/data/queries.ts` | D, G | Edit | +30 |
| 5 | `src/modules/pm/data/task-ops.ts` | E, H | Edit | +40 |
| 6 | `src/modules/pm/engine/dispatch.ts` | F | Edit | +80 |
| 7 | `src/modules/pm/commands/task.ts` | H | Edit | +10 |
| 8 | `src/modules/pm/commands/onboard.ts` | D | Edit | +5 |

### Wave Structure

| Wave | Tasks | Gate |
|------|-------|------|
| 1 | A (index.ts), B (setup.md), C (orchestration.ts:briefing), D (queries.ts + onboard.ts), G (queries.ts) | Typecheck + tests pass |
| 2 | E (task-ops.ts), H (task-ops.ts + task.ts) | Typecheck + tests pass |
| 3 | I (orchestration.ts:next), J (orchestration.ts:waves) | Typecheck + tests pass |
| 4 | F (dispatch.ts + orchestration.ts:dispatch) | Typecheck + tests pass |

**Note:** D and G both touch `queries.ts` — assign to same agent in Wave 1. C, I, J all touch `orchestration.ts` but in different sections — C is in Wave 1 (briefing), I and J are in Wave 3 (next/waves). No file conflicts within waves.

### Tests

| File | Coverage |
|------|----------|
| `__tests__/modules/pm/index.test.ts` | Plural alias passthrough with various flag combinations |
| `__tests__/modules/pm/queries.test.ts` | Single project auto-resolution, multi-project error, workstream routing hint |
| `__tests__/modules/pm/task-ops.test.ts` | Search matches workstream names, sort by priority, limit |
| `__tests__/modules/pm/dispatch.test.ts` | assembleDispatch returns enriched bundle with related notes, peer tasks, downstream |
| `__tests__/modules/pm/orchestration.test.ts` | Briefing blocked count includes virtual states, next --workstream, waves --json depends_on |

---

## Expected V7 Impact

| Metric | v5 | v6 | v7 (projected) |
|--------|-----|-----|----------------|
| Avg quality | 3.5/5 | 3.5/5 | 4.0+/5 |
| Prompts ≤3/5 | 14/30 | 15/30 | 7-9/30 |
| Prompts at 5/5 | 5/30 | 4/30 | 7-9/30 |
| Avg calls/prompt | 15.5 | 17.0 | 12-14 |

**Per-fix impact projection:**
- Fix A: 11 prompts recover 1-3 wasted calls each (alias friction elimination)
- Fix B: 7 prompts in Context/Planning gain body content → +0.5-1.0 quality
- Fix D: Every session saves 1 `brain pm use` call
- Fix E: 3 prompts find tasks via workstream name search
- Fix F: Agent Commands category 2.5 → 3.5+ (dispatch actually useful)
- Fix H: 2 prompts can get top-N without python pipe

---

## What's NOT in V7

| Item | Observation | Why defer |
|------|-------------|-----------|
| Note graph relations | O-25 | Most frequent gap (8 prompts) but requires architectural design for auto-linking |
| Fuzzy/prefix matching | O-117 | Cross-cutting, touches many commands |
| Temporal planning | O-116 | New data model fields, needs design |
| Full doc retrieval | O-120 | Core brain feature, not PM-specific |
| brain init safeguard | O-146 | Core brain command, not PM-specific |
| brain pm onboard --self | O-147 | Needs design for self-targeting workflow |
| CI coverage ingestion | O-141 | New data model, low prompt impact |
| Task audit trail | O-140 | New feature, not a fix |
