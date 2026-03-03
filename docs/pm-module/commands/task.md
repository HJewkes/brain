# Task Commands

## brain pm task add

Create a new task within a workstream.

**Usage:** `brain pm task add <name> --project <PREFIX> --workstream <n> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `name` | Yes | Task name |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Parent project prefix | required |
| `--workstream <n>` | Workstream number (integer) | required |
| `--mode <mode>` | Task mode (`auto`\|`interactive`\|`review`) | — |
| `--category <cat>` | Task category | — |
| `--priority <pri>` | Task priority (`critical`\|`high`\|`medium`\|`low`) | — |
| `--depends-on <ids...>` | Display IDs this task depends on (space-separated) | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm task add "Build login form" --project WEB --workstream 1 \
    --category implementation --priority high --depends-on WEB-01.001
WEB-01.002 - pending [high] (auto)
```

---

## brain pm task list

List tasks for a project, with optional filters.

**Usage:** `brain pm task list --project <PREFIX> [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Filter by project prefix | active project |
| `--workstream <n>` | Filter by workstream number or display ID | — |
| `--status <status>` | Filter by status or virtual state (`blocked`, `ready`, `eligible`) | — |
| `--priority <level>` | Filter by priority | — |
| `--category <cat>` | Filter by category | — |
| `--search <text>` | Filter by title (case-insensitive substring) | — |
| `--json` | Output JSON (includes `virtualStates` and `depends_on`) | false |

**Notes:**
- `--status blocked` returns tasks with raw `blocked` status OR computed `+BLOCKED` virtual state
- `--status ready` and `--status eligible` filter by computed virtual states only
- When results are empty with active filters, output shows applied filters

**Example:**
```bash
$ brain pm task list --project WEB --status pending
WEB-01.001 - pending [high] (auto)
WEB-01.002 - pending [medium] (review)

$ brain pm tasks --status blocked
WEB-02.003 - pending [high] (auto) +BLOCKED
```

---

## brain pm task show

Show task detail.

**Usage:** `brain pm task show <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID (e.g. `WEB-01.003`) |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

---

## brain pm task update

Update task metadata fields (mode, category, priority).

**Usage:** `brain pm task update <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--mode <mode>` | New mode | — |
| `--category <cat>` | New category | — |
| `--priority <pri>` | New priority | — |
| `--json` | Output JSON | false |

---

## brain pm task done

Mark a task as done.

**Usage:** `brain pm task done <id> [options]`

---

## brain pm task block

Mark a task as blocked.

**Usage:** `brain pm task block <id> [options]`

---

## brain pm task unblock

Unblock a task by setting it back to `pending`.

**Usage:** `brain pm task unblock <id> [options]`

---

## brain pm task claim

Claim an eligible task, transitioning from `pending` to `claimed`. Returns a claim token required by `task start`.

**Usage:** `brain pm task claim <id> [options]`

**Example:**
```bash
$ brain pm task claim WEB-01.001 --json
{
  "display_id": "WEB-01.001",
  "status": "claimed",
  "token": "clm_a1b2c3d4e5f6"
}
```

---

## brain pm task start

Start a claimed task, transitioning from `claimed` to `in-progress`. Requires the claim token from `task claim`.

**Usage:** `brain pm task start <id> --token <token> [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--token <token>` | Claim token from `task claim` | required |
| `--json` | Output JSON | false |

---

## brain pm task release

Release a claim on a task, returning it to `pending`.

**Usage:** `brain pm task release <id> [options]`

---

## brain pm task delete

Delete a task.

**Usage:** `brain pm task delete <id> [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--force` | Force delete even with dependents | false |
| `--json` | Output JSON | false |
