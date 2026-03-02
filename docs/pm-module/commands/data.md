# Data Commands

## brain pm onboard

Set up a PM project from a codebase. Detects components, discovers docs, ingests them, and creates a project with an onboard manifest.

**Usage:** `brain pm onboard <project-name> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `project-name` | Yes | Project name |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--prefix <PREFIX>` | Project prefix (2-5 uppercase chars) | derived from name |
| `--cwd <path>` | Project directory to scan | current working directory |
| `--max-docs <n>` | Max docs to ingest (0 = no limit) | no limit |
| `--skip-ingest` | Skip doc ingestion phase | false |
| `--reset` | Wipe existing onboard data and start fresh | false |
| `--json` | Output JSON | false |

**Phases:**
1. **Detect** — Scan `--cwd` for components (package.json, Cargo.toml, etc.)
2. **Create** — Create project note with prefix
3. **Discover** — Find and score `.md` files across component paths
4. **Ingest** — Copy docs to brain notes dir, add frontmatter, index
5. **Reference** — Ingest PM reference docs (commands.md, architecture.md) from brain package

**Example:**
```bash
$ cd ~/projects/my-app
$ brain pm onboard "My App" --prefix APP
Onboarded "My App" (APP)
  Components: 3 (frontend, backend, shared)
  Docs: 15/15 ingested
  Manifest note: app-onboard-manifest
```

---

## brain pm import

Import an entire project structure (project, workstreams, tasks with dependencies) from a JSON file.

**Usage:** `brain pm import --from-json <file> [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--from-json <file>` | JSON file to import | required |
| `--json` | Output JSON | false |

**JSON file format:**
```json
{
  "name": "Web Relaunch",
  "prefix": "WEB",
  "workstreams": [
    {
      "name": "Frontend",
      "tasks": [
        { "name": "Setup scaffold", "priority": "high" },
        { "name": "Build login", "priority": "medium", "depends_on": ["WEB-01.001"] }
      ]
    }
  ]
}
```

---

## brain pm capture

Quick-capture a note into the PM inbox.

**Usage:** `brain pm capture <text> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `text` | Yes | Text to capture |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <p>` | Project scope | — |
| `--source <s>` | Capture source identifier | `cli` |
| `--json` | Output JSON | false |

---

## brain pm inbox

List unprocessed captures.

**Usage:** `brain pm inbox [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <p>` | Filter by project | — |
| `--all` | Include processed captures | false |
| `--json` | Output JSON | false |

---

## brain pm process

Process a capture into a task.

**Usage:** `brain pm process <capture-id> --task-name <n> --workstream <ws> --project <p> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `capture-id` | Yes | Capture note ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--task-name <n>` | Name for the new task | required |
| `--workstream <ws>` | Workstream number (integer) | required |
| `--project <p>` | Project prefix | required |
| `--json` | Output JSON | false |
