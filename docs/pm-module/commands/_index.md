# PM Commands Overview

Quick-lookup reference for all `brain pm` commands, organized by command group.

## Enum Values

- `--status`: `pending`, `claimed`, `in-progress`, `done`, `blocked`, `cancelled`
- `--status` (virtual states): `blocked`, `ready`, `eligible` — computed from dependencies, not stored
- `--mode`: `auto`, `interactive`, `review`, `agent`, `assisted`, `human`
- `--category`: `implementation`, `testing`, `documentation`, `research`, `review`, `infrastructure`, `configuration`, `design`, `migration`
- `--priority`: `critical`, `high`, `medium`, `low`

## Aliases

| Alias | Expands To |
|-------|------------|
| `brain pm tasks` | `brain pm task list` (passes through all flags) |
| `brain pm workstreams` | `brain pm workstream list` (passes through all flags) |

## Common Flags

| Flag | Description |
|------|-------------|
| `--json` | Output JSON instead of human-readable text |
| `--project <PREFIX>` | Specify project prefix (many commands use active project as default) |
| `--format <fmt>` | Output format where supported |

## Command Groups

- **Project** — `init`, `list`, `status`, `use`, `show`, `update`, `delete`
- **Workstream** — `add`, `list`, `show`, `update`, `delete`
- **Task** — `add`, `list`, `show`, `update`, `done`, `block`, `unblock`, `claim`, `start`, `release`, `delete`
- **Planning** — `waves`, `next`, `dispatch`, `briefing`, `orchestrate`
- **Context** — `context`, `verify`, `audit`, `check`
- **Data** — `onboard`, `relate`, `activity`, `import`, `capture`
- **Setup** — `setup`, `decision`, `prompt`, `template`, `install-hooks`
