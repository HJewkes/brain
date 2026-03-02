# Context & Verification Commands

## brain pm context

Assemble rich context for a task: prompt, dependencies, and decisions.

**Usage:** `brain pm context <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--decisions` | Include decisions | true |
| `--deps` | Include dependencies | true |
| `--since <timestamp>` | Filter to activities/decisions after timestamp | — |
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm context WEB-01.002
Task: WEB-01.002
Status: pending
Category: implementation
Priority: high

--- Prompt ---
Implement JWT middleware

--- Dependencies ---
  WEB-01.001 [done] Setup project scaffold

Context hash: a3f9b2c1
```

---

## brain pm verify

Generate a verification checklist for a task, tailored to its category.

**Usage:** `brain pm verify <id> [options]`

**Arguments:**
| Name | Required | Description |
|------|----------|-------------|
| `id` | Yes | Task display ID |

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output JSON | false |

**Example:**
```bash
$ brain pm verify WEB-01.001
Verification Plan: WEB-01.001
Category: implementation

Verification steps:
  [ ] Verify all acceptance criteria are met
  [ ] Run unit tests for changed modules
  [ ] Check for regressions in dependent code
  [ ] Review code for style and correctness
```

---

## brain pm audit summary

Aggregated activity stats for PM module (total, completed, failed, counts by type).

**Usage:** `brain pm audit summary [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <p>` | Filter by project | — |
| `--since <date>` | Filter by start date (ISO 8601) | — |
| `--json` | Output JSON | false |

---

## brain pm audit cost

Cost estimation from token usage recorded in activity metadata.

**Usage:** `brain pm audit cost [options]`

---

## brain pm audit performance

Completion rates and average duration from activity records.

**Usage:** `brain pm audit performance [options]`

---

## brain pm audit enrich

Add telemetry (token count and model) to an existing activity record.

**Usage:** `brain pm audit enrich <activity-id> --tokens <n> --model <m> [options]`

---

## brain pm check

Run consistency checks on a PM project. Returns a JSON report of structural issues and (with `--deep`) semantic analysis pairs.

**Usage:** `brain pm check [options]`

**Options:**
| Flag | Description | Default |
|------|-------------|---------|
| `--project <PREFIX>` | Project prefix; uses active project if omitted | — |
| `--deep` | Include semantic analysis | false |
| `--json` | Output JSON | false |

**Structural checks (always run):**
- Orphaned decisions — decisions with no task impacts
- Stale prompts — prompts older than their impacting decisions
- Broken dependencies — tasks referencing nonexistent dependency targets
- Blocked without cause — blocked tasks whose dependencies are all done
- Cancelled dependencies — active tasks depending on cancelled tasks

**Semantic analysis (with `--deep`):**
- Decision pairs — decisions sharing impact targets
- Task-decision alignment — tasks with their impacting decisions
- Supersession gaps — decisions on the same source task without formal supersession
- Source document clustering — groups ingested docs by title similarity
