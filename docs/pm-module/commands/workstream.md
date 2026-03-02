# Workstream Commands

## brain pm workstream add

Create a new workstream inside a project.

**Usage:** `brain pm workstream add <name> --project <PREFIX> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `name` | Yes | Workstream name |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Parent project prefix | required |
| `--description <desc>` | Workstream description | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm workstream add "Frontend" --project WEB
WEB-01 - WEB 1 (active)
```

---

## brain pm workstream list

List workstreams for a project.

**Usage:** `brain pm workstream list --project <PREFIX> [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Filter by project prefix | required |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm workstream list --project WEB
WEB-01 - WEB 1 (active)
WEB-02 - WEB 2 (active)
```

---

## brain pm workstream show

Show workstream detail.

**Usage:** `brain pm workstream show <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Workstream display ID (e.g. `WEB-01`) |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm workstream show WEB-01
WEB-01 - WEB 1 (active)
```

---

## brain pm workstream update

Update a workstream's status.

**Usage:** `brain pm workstream update <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Workstream display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--status <status>` | New status | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm workstream update WEB-01 --status done
WEB-01 - WEB 1 (done)
```

---

## brain pm workstream delete

Delete a workstream.

**Usage:** `brain pm workstream delete <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Workstream display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--force` | Force delete even with tasks | false |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm workstream delete WEB-02 --force
Deleted workstream WEB-02
```
