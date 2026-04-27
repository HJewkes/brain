# Hook Dispatch Quick Start

Brain's hook system intercepts Claude Code events (tool calls, session start, agent completion) and enforces configurable checks: file ownership boundaries, git safety, WIP limits, definition of done, worktree isolation, and friction detection. All checks run through a single dispatch entry point so new checks can be added without modifying Claude Code settings.

## Prerequisites

- brain installed and initialized
- Claude Code project or user settings accessible

---

## 1. What Problem It Solves

Without hooks, agents can accidentally write outside their assigned files, push to protected branches, or spiral into retry loops. Hooks act as a guardrail layer that runs before and after tool calls, enforcing invariants that would otherwise require manual review after every agent run.

---

## 2. Install Hooks

Add brain hooks to your Claude Code project settings:

```bash
brain hook install --project    # writes to .claude/settings.json
brain hook install --user       # writes to ~/.claude/settings.json
```

This registers `brain hook dispatch <event>` as the handler for each supported Claude Code hook event.

---

## 3. Check Hook Status

See which checks are registered and enabled:

```bash
brain hook status
```

Output:

```
Registered checks (9):
  ✓ file-ownership      pre-tool-use   [enabled]
  ✓ git-safety          pre-tool-use   [enabled]
  ✓ wip-limit           pre-tool-use   [enabled]
  ✓ workspace           pre-tool-use   [enabled]
  ✓ worktree-isolation  pre-tool-use   [enabled]
  ✓ workflow-resource   pre-tool-use   [enabled]
  ✓ friction            pre-tool-use   [enabled]
  ✓ dod                 task-completed [enabled]
  ✓ agents:agent-done   agent-done     [enabled]
```

---

## 4. Configure Checks

Checks are configured in `ao.config.json` in the project root. A minimal example:

```json
{
  "hooks": {
    "enforcement": {
      "ownership": true,
      "gitSafety": true,
      "wipLimit": 5,
      "dod": true,
      "worktreeIsolation": true,
      "friction": true
    },
    "ownershipManifest": ".claude/ownership.json"
  }
}
```

Set a value to `false` to disable that check project-wide.

---

## 5. Define File Ownership

Create `.claude/ownership.json` to specify which agent or role owns which paths:

```json
{
  "src/modules/pm/": "pm-agent",
  "src/modules/workflow/": "workflow-agent",
  "docs/": "docs-agent"
}
```

The `file-ownership` check blocks writes to paths not owned by the current agent.

---

## 6. Dispatch a Hook Manually

Test a hook by dispatching an event from the command line (JSON on stdin):

```bash
echo '{"tool":"Write","path":"src/foo.ts"}' | brain hook dispatch pre-tool-use
```

Exit code 0 = allowed, non-zero = blocked (stderr contains the reason).

---

## Built-in Checks

| Check | Event | What It Enforces |
|---|---|---|
| `file-ownership` | `pre-tool-use` | Writes confined to owned paths |
| `git-safety` | `pre-tool-use` | Blocks destructive ops on protected branches |
| `wip-limit` | `pre-tool-use` | Max concurrent active agents (`wipLimit` in config) |
| `workspace` | `pre-tool-use` | Task dispatch requires clean git state |
| `worktree-isolation` | `pre-tool-use` | Agent confined to its allocated worktree |
| `workflow-resource` | `pre-tool-use` | Tool calls validated against workflow resource allocations |
| `friction` | `pre-tool-use` | Blocks consecutive failures of the same tool (retry spiral guard) |
| `dod` | `task-completed` | Completion requires passing typecheck + tests + lint |
| `agents:agent-done` | `agent-done` | Marks agent complete, releases worktree, updates PM task |

---

## How It Works

`HookRegistry` (`src/hooks/registry.ts`) maintains a sorted list of handlers. `dispatchHookEvent` (`src/hooks/dispatch.ts`) is the CLI entry point — it reads the event payload from stdin, runs handlers in priority order, and stops on the first failure. Configuration is merged from global and project `ao.config.json` files via `resolveHookConfig` (`src/hooks/config.ts`).

---

## Related

- Registry: `src/hooks/registry.ts`
- Config resolution: `src/hooks/config.ts`
- Built-in checks: `src/hooks/checks/`
