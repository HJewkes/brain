# Setup & Admin Commands

## brain pm install-hooks

Install orchestration hooks and skills into `~/.claude/`. Writes hook scripts and registers them in `~/.claude/settings.json`. Also installs the orchestrator and sanity-check skills.

**Usage:** `brain pm install-hooks [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--remove` | Remove installed hooks and skill | false |
| `--dry-run` | Preview changes without writing files | false |

**Example:**
```bash
$ brain pm install-hooks
Installed 5 items.
Orchestration hooks are ready. Start a new Claude Code session to activate.

$ brain pm install-hooks --dry-run
Would install:
  ~/.claude/hooks/brain-pm-session.sh
  ~/.claude/hooks/brain-pm-worktree.sh
  ~/.claude/hooks/brain-pm-agent-done.sh
  ~/.claude/skills/orchestrator/SKILL.md
  ~/.claude/skills/sanity-check/SKILL.md
  Hook entries in ~/.claude/settings.json
```

---

## brain pm decision add

Record a new architectural or design decision linked to a task.

**Usage:** `brain pm decision add <name> --project <PREFIX> --source-task <id> [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Parent project prefix | required |
| `--source-task <id>` | Task display ID that prompted this decision | required |
| `--impacts <ids...>` | Display IDs of impacted tasks (space-separated) | — |
| `--json` | Output JSON | false |

---

## brain pm decision list

List decisions for a project.

**Usage:** `brain pm decision list --project <PREFIX> [options]`

---

## brain pm decision show

Show decision detail including content body.

**Usage:** `brain pm decision show <id> [options]`

---

## brain pm decision supersede

Supersede an existing decision with a new one.

**Usage:** `brain pm decision supersede <old-id> <name> [options]`

---

## brain pm prompt write

Write (or update) a prompt for a task.

**Usage:** `brain pm prompt write <task-id> --project <PREFIX> [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Parent project prefix | required |
| `--content <text>` | Prompt content; reads stdin if omitted | — |
| `--json` | Output JSON | false |

---

## brain pm prompt show

Show the current (or a specific version of) prompt for a task.

**Usage:** `brain pm prompt show <task-id> [options]`

---

## brain pm prompt list

List prompts for a project.

**Usage:** `brain pm prompt list --project <PREFIX> [options]`

---

## brain pm prompt history

Show all versions of prompts for a task.

**Usage:** `brain pm prompt history <task-id> [options]`
