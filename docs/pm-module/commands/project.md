# Project Commands

## brain pm init

Initialize a new project.

**Usage:** `brain pm init <name> --prefix <PREFIX> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `name` | Yes | Project name |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--prefix <PREFIX>` | Project prefix, 2-5 uppercase chars | required |
| `--phase <phase>` | Initial phase label | — |
| `--wip-limit <n>` | WIP limit (integer) | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm init "Web Relaunch" --prefix WEB
WEB - WEB-000 (active)
```

---

## brain pm list

List all projects.

**Usage:** `brain pm list [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm list
WEB - WEB-000 (active)
API - API-000 (active)
```

---

## brain pm status

Show project status. Uses active project if no prefix given.

**Usage:** `brain pm status [prefix] [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `prefix` | No | Project prefix; falls back to active project |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm status WEB
WEB - WEB-000 [alpha] (active)
```

---

## brain pm use

Set the active project context for the current session.

**Usage:** `brain pm use <prefix>`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `prefix` | Yes | Project prefix to activate |

**Example:**
```bash
$ brain pm use WEB
Active project set to WEB
```

---

## brain pm project update

Update project fields.

**Usage:** `brain pm project update <prefix> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `prefix` | Yes | Project prefix |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--status <status>` | New status | — |
| `--phase <phase>` | New phase label | — |
| `--wip-limit <n>` | New WIP limit (integer) | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm project update WEB --phase beta --status active
WEB - WEB-000 [beta] (active)
```

---

## brain pm project delete

Delete a project.

**Usage:** `brain pm project delete <prefix> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `prefix` | Yes | Project prefix |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--force` | Force delete even with dependent notes | false |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm project delete WEB --force
Deleted project WEB
```
