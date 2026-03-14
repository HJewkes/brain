# AO Merge Design: Hooks as Core, Agents as Module

## Problem

Brain and agent-orchestration (`~/agent_orchestration/`) are tightly coupled but maintained separately. AO calls `brain pm task claim/done`, brain's hooks call `ao check-*`. Session intelligence, PM, and enforcement all need hook infrastructure but each implements it ad-hoc. The boundary is artificial — hooks are infrastructure that multiple modules need, not a standalone product.

## Architecture

### Layer 1: Core Hooks System (`src/hooks/`)

The hook dispatch and enforcement engine becomes a core brain capability, alongside the database, search, and embeddings. Any module can register hook handlers.

```
src/hooks/
  types.ts          — HookEvent, HookInput, HookResult, HookHandler interfaces
  registry.ts       — HookRegistry: register handlers, dispatch events, aggregate results
  dispatcher.ts     — Event dispatch: reads stdin, runs registered handlers, outputs result
  install.ts        — Hook file scaffolding (.claude/settings.json, .claude/hooks/*.sh)
  checks/           — Built-in enforcement checks (core, not module-specific)
    ownership.ts    — File scope enforcement
    git-safety.ts   — Block destructive git ops
    workspace.ts    — Warn uncommitted changes
    dod.ts          — Definition of Done validation
    wip.ts          — WIP limit warnings
```

**Key design decisions:**
- `HookRegistry` is a singleton created during brain init, like `ModuleRegistry`
- Modules register handlers via `ctx.addHookHandler(event, handler)` in their `register()` call
- Handlers return `HookResult` (allow/block/inject context)
- Dispatch aggregates: first block wins, context injections merge
- Config lives in `ao.config.json` (renamed to `brain.hooks.json` or merged into brain config)
- The `brain hook <event>` CLI command replaces `ao hook <event>`

**HookHandler interface:**
```ts
interface HookHandler {
  name: string;
  event: HookEvent;
  priority: number;        // lower = runs first
  enabled(config: HookConfig): boolean;
  run(input: HookInput, config: HookConfig): HookResult;
}
```

**Module registration example:**
```ts
// In sessions module register():
ctx.addHookHandler({
  name: 'session-capture',
  event: 'pre-tool-use',
  priority: 100,  // after enforcement checks
  enabled: () => true,
  run: (input) => captureSessionEvent(db, input),
});
```

### Layer 2: Agent Module (`src/modules/agents/`)

Agent lifecycle, coordination, and worktree management become a brain module — same pattern as PM and sessions.

```
src/modules/agents/
  index.ts          — BrainModule registration
  types.ts          — AgentState, AgentIdentity, WorktreeAlloc
  data/
    agent-ops.ts    — Agent CRUD (SQLite, replacing YAML files)
    worktree-ops.ts — Worktree allocation/release
  engine/
    lifecycle.ts    — register → start → complete/abandon state machine
    dispatch.ts     — Agent dispatch with brain PM integration
  commands/
    register.ts     — brain agent register
    start.ts        — brain agent start
    complete.ts     — brain agent complete
    status.ts       — brain agent status
    worktree.ts     — brain agent worktree alloc/check/release
  hooks/
    ownership.ts    — Worktree boundary enforcement (registers into core hooks)
    workflow.ts     — Branch ownership validation
```

**Key changes from current AO:**
- Agent state moves from YAML files → SQLite (brain's DB, searchable)
- Agent notes become brain notes (type: 'agent', module: 'agents')
- Worktree tracking moves from JSON file → brain_kv or dedicated table
- `ao register/start/complete` → `brain agent register/start/complete`
- Brain PM integration becomes direct function calls instead of CLI subprocess
- Snowflake IDs already in brain (PM module uses them)

### Layer 3: Unified CLI

```
brain hook <event>              — Dispatch hook (replaces ao hook)
brain hook install              — Install hooks into .claude/
brain hook status               — Show installed hooks
brain agent register            — Register new agent
brain agent start <id>          — Start agent session
brain agent complete <id>       — Mark agent done
brain agent status              — List agents
brain agent worktree alloc      — Allocate worktree
brain agent worktree release    — Release worktree
```

The `ao` CLI becomes a thin wrapper that delegates to `brain`:
```bash
#!/bin/bash
brain "$@"  # or specific subcommand mapping during transition
```

## Migration Strategy

### Wave 0: Core Hooks Infrastructure
1. Create `src/hooks/` with types, registry, dispatcher
2. Port enforcement checks from ao (ownership, git-safety, workspace, dod, wip)
3. Add `brain hook <event>` CLI command
4. Add `ctx.addHookHandler()` to ModuleContext
5. Wire existing brain hooks (session capture, PM task-completed) through registry
6. Update .claude/hooks/*.sh to call `brain hook` instead of `ao hook`

### Wave 1: Agent Module
7. Create `src/modules/agents/` module skeleton
8. Design agent state schema (SQLite migration)
9. Port agent lifecycle (register, start, complete, abandon)
10. Port worktree management
11. Wire agent module hooks (ownership, workflow-resource) through core registry

### Wave 2: Integration & Cleanup
12. Port `ao query-insights` → brain search with appropriate filters
13. Move ao.config.json settings into brain config
14. Update hook install to scaffold for brain CLI
15. Create `ao` compatibility shim (delegates to brain)
16. Update CLAUDE.md and docs

### Wave 3: Deprecate Standalone AO
17. Archive ~/agent_orchestration repo
18. Remove global ao CLI symlink
19. Update agents-skills repo if it references ao directly

## What Gets Dropped

- **ao's monorepo structure** — brain is the only package
- **YAML agent state files** — replaced by SQLite
- **worktrees.json** — replaced by brain_kv or agent table
- **ao's own .brain/ knowledge base** — insights migrate to brain notes
- **Separate config resolution** — merged into brain's config system
- **js-yaml dependency** — brain uses gray-matter (already has YAML)

## What Gets Preserved

- All 7 enforcement checks (exact same logic)
- HookResult interface (exit 0/2 pattern)
- Agent lifecycle state machine
- Worktree allocation with budget
- Brain PM integration (now direct calls)
- Block-once pattern for git safety
- 209 tests (ported to brain's test structure)

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Breaking existing hook scripts | Compatibility shim: `ao` → `brain` delegation |
| Agent state migration | Support reading old YAML files during transition |
| Config format change | Merge ao.config.json into brain config with defaults |
| Test port complexity | Tests are pure Vitest, same framework — mechanical port |
| Performance (hooks add latency) | Enforcement checks are <50ms; same as current ao |
