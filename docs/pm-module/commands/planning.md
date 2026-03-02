# Planning Commands

## brain pm next

Show eligible tasks — those in `pending` status with all dependencies `done`.

**Usage:** `brain pm next [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Project prefix; uses active project if omitted | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm next
WEB-01.001  high
WEB-01.003  medium  [stale-prompt]
```

---

## brain pm waves

Show topological wave grouping of remaining tasks. Wave 1 tasks have no incomplete dependencies; later waves depend on earlier ones.

**Usage:** `brain pm waves [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Project prefix; uses active project if omitted | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm waves
Wave 1: WEB-01.001, WEB-01.003
Wave 2: WEB-01.002
Wave 3: WEB-01.004
```

---

## brain pm briefing

Print a session briefing with project state overview: task counts by status, recent decisions, stale prompts, and recommended next actions.

**Usage:** `brain pm briefing [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Project prefix; uses active project if omitted | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm briefing
=== Briefing: WEB-000 ===
Status: active | Phase: alpha

Tasks: 8 total
  Done: 3
  In-progress: 1
  Eligible: 2 (WEB-01.004, WEB-02.001)
  Blocked: 0
  Pending: 2

Recommended actions:
  -> Pick up eligible task: WEB-01.004
```

---

## brain pm dispatch

Assemble and output a context bundle for a task (task metadata, prompt, dependencies, decisions, context hash).

**Usage:** `brain pm dispatch <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

---

## brain pm orchestrate

Orchestration subcommands for session lifecycle, routing, rendering, and worktree allocation.

### session-start

Initialize an orchestration session. Called by the `SessionStart` hook.

**Usage:** `brain pm orchestrate session-start`

### route

Compute routing for a task: agent type, model, isolation, verification, concurrency.

**Usage:** `brain pm orchestrate route <id> [options]`

### render

Render the agent prompt (or verification prompt) for a task.

**Usage:** `brain pm orchestrate render <id> [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--worktree <path>` | Worktree path to include in prompt | — |
| `--verification` | Render verification prompt instead | false |
| `--json` | Output JSON with metadata | false |

### worktree-alloc / worktree-check / worktree-release / worktree-status

Manage git worktree allocation for tasks.

### agent-done

Record sub-agent completion. Called by the `SubagentStop` hook.

### session-end

End an orchestration session and output a summary.
