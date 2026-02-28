# V6 Diagnostic Fixes — Design

**Date:** 2026-02-28
**Status:** Implemented
**Observations addressed:** O-103, O-104, O-105, O-106, O-107, O-108, O-110, O-112, O-115, O-119, O-123, O-124, O-128, O-129, O-130

---

## Problem

V5 introduced `brain pm onboard`, which dramatically improved data quality (43 tasks with 7 categories, 21% dependency coverage, 100% body completeness — all firsts). But test bench average quality dropped from 3.7 to 3.5, with prompts scoring ≤3/5 increasing from 9 to 14.

The regression is concentrated in three root causes:
1. **Agents can't find command syntax** (O-103) — `commands.md` (1452 lines) isn't indexed. 13+ prompts degraded by flag guessing.
2. **Small CLI friction points compound** — wrong display ID format silently returns empty (O-107), NOT_FOUND errors give no guidance (O-108), plural commands fail (O-112), workstream descriptions invisible (O-110).
3. **Onboard leaves gaps** — empty Triage workstream (O-124), brain dev docs pollute project namespace (O-123), no manifest inspection command (O-128), no `--cwd` flag (O-104).

## Design Principles

1. **Zero tool calls for common syntax.** Session hook injects a command cheat sheet — agents never need to search for basic flag names.
2. **Errors guide recovery.** Every NOT_FOUND, empty result, and validation failure includes what to do next.
3. **Onboard is the single setup entry point.** Reference doc ingestion, namespace isolation, and manifest inspection all live in the onboard flow.
4. **Independent fixes, parallel implementation.** Each fix touches distinct files. No ordering dependencies between items.

---

## Fix A: Command Reference Context Delivery

### Problem
Agents guess command syntax because `commands.md` isn't discoverable. This causes 13+ prompt degradations — the single largest quality driver.

### Design

**Two layers:**

**Layer 1 — Session hook cheat sheet (compaction-resilient)**

Extend `brain pm orchestrate session-start` to output a text block after the JSON metadata. This text is injected into the agent's context at session start and survives context compaction.

The cheat sheet covers the most-used command patterns with correct flags (~50 lines):

```
## brain pm — Quick Reference

brain pm list                              # List projects
brain pm status [--json]                   # Project status summary
brain pm briefing [--full] [--json]        # Current state briefing

brain pm task list [--status <s>] [--workstream <n|PROJ-NN>] [--category <c>] [--priority <p>] [--json]
brain pm task add "<title>" --workstream <n|PROJ-NN> --project <PREFIX> --category <cat> --priority <pri> [--description "<desc>"] [--depends-on <id>]
brain pm task show <PROJ-WS.TT> [--json]
brain pm task claim <PROJ-WS.TT>
brain pm task start <PROJ-WS.TT> --token <token>
brain pm task done <PROJ-WS.TT>

brain pm workstream list [--project <PREFIX>] [--json]
brain pm workstream add --project <PREFIX> "<name>" [--description "<desc>"]
brain pm workstream show <PROJ-NN> [--json]

brain pm waves [--json]                    # Dependency-ordered task waves
brain pm next [--json]                     # Next eligible tasks
brain pm context <PROJ-WS.TT> [--json]    # Task context bundle
brain pm dispatch <PROJ-WS.TT> [--json]   # Agent dispatch brief
brain pm audit [--json]                    # Data quality audit
brain pm check [--deep] [--json]           # Consistency checks

brain pm onboard <name> [--prefix <PFX>] [--cwd <path>] [--skip-ingest] [--reset] [--json]
brain pm onboard status [<prefix>] [--json]

Statuses: pending, claimed, in-progress, done
Virtual states (computed): blocked, ready, eligible
Categories: bug, feature, improvement, research, documentation, testing, design, infrastructure, refactor
Priorities: critical, high, medium, low
```

**Layer 2 — Reference doc ingestion in onboard (depth for edge cases)**

After the ingest phase (Phase 4), add a Phase 4b: ingest the PM module's own reference docs if they aren't already indexed. Files:
- `docs/pm-module/commands.md` — full command reference
- `docs/pm-module/architecture.md` — state machine, routing, virtual states

These are located relative to the brain package install path, not the project being onboarded. The onboard command resolves them via the module's own `__dirname` or package root.

Idempotent — if already indexed (by hash), skip.

### Files changed
- `src/modules/pm/commands/orchestrate.ts` — add cheat sheet output to session-start
- `src/modules/pm/commands/onboard.ts` — add Phase 4b reference doc ingestion

---

## Fix B: Workstream Display ID Resolution (O-107)

### Problem
`--workstream VOLT-06` silently returns empty results. The filter expects an integer but agents naturally use display IDs.

### Design
In `--workstream` option parsing in `task.ts`, detect display ID format (matches `<PREFIX>-<NN>`) and resolve to the integer workstream number. Fall back to `parseInt` for raw numbers. On invalid format, error with: `"Invalid workstream filter. Use a number (6) or display ID (VOLT-06). Run 'workstream list' to see options."`

### Files changed
- `src/modules/pm/commands/task.ts` — workstream option parsing

---

## Fix C: NOT_FOUND Recovery Guidance (O-108)

### Problem
5 prompts spent 5-10 calls diagnosing wrong prefixes (`VLT` vs `VOLT`). NOT_FOUND errors give no hint about valid prefixes.

### Design
When `resolveDisplayId` returns NOT_FOUND, query all known project prefixes and append to the error message: `"Task 'VLT-01.01' not found. Known projects: VOLT. Run 'brain pm list' to see all projects."`

If the workstream portion of the ID resolves but the task number doesn't exist, say so: `"Workstream VOLT-06 exists but has no task .01."`

### Files changed
- `src/modules/pm/data/queries.ts` — enrich NOT_FOUND error in `resolveDisplayId`

---

## Fix D: Plural Command Aliases (O-112)

### Problem
Every agent session wastes 2-5 calls guessing `brain pm tasks` (fails) vs `brain pm task list` (works). Hit in 9 prompts.

### Design
Add aliases in the PM command registration:
- `brain pm tasks` → delegates to `brain pm task list` (passes through all flags)
- `brain pm workstreams` → delegates to `brain pm workstream list`

Use Commander's command forwarding pattern — the alias command parses the same options and calls the same action.

### Files changed
- `src/modules/pm/index.ts` — add alias commands

---

## Fix E: Workstream Description in Show/List (O-110)

### Problem
Workstream descriptions set at creation are invisible. `workstream show` returns id/title/status but no description. Agents can't determine workstream scope without reading all task titles.

### Design
Add `description` field to `WorkstreamMetadata` interface. Read the description from the note body (first paragraph after the heading) in `getWorkstream()`. Include in both plain text and JSON output for `workstream show` and `workstream list`.

### Files changed
- `src/modules/pm/data/workstream-ops.ts` — add description to metadata, read from note body

---

## Fix F: Empty Filter Result Diagnostic (O-115)

### Problem
`--status done` returns "No tasks found" — agents can't tell if the filter was accepted (genuinely zero results) or silently rejected.

### Design
When task list returns 0 results with active filters, output the applied filters: `"0 tasks found matching: status=done, workstream=VOLT-06"`. This disambiguates accepted-filter-empty-result from silent failure.

### Files changed
- `src/modules/pm/commands/task.ts` — enhance empty result output

---

## Fix G: Onboard `--cwd` Flag (O-104)

### Problem
Agent ran `brain pm onboard` from home directory, got 1 component instead of 4. No warning, no `--cwd` flag.

### Design
Add `--cwd <path>` option to the onboard command. When provided, use it instead of `process.cwd()`.

Add a heuristic warning after detection: if fewer than 2 components found, print: `"Warning: Only 1 component detected. If this is a monorepo or workspace, try --cwd <project-root> for better coverage."`

### Files changed
- `src/modules/pm/commands/onboard.ts` — add --cwd option, add low-component warning

---

## Fix H: Onboard Cleanup (O-124, O-123, O-129)

### Problem
Three onboard issues compound:
1. Empty Triage workstream created unconditionally
2. Brain dev docs with existing `module:` frontmatter get re-ingested under the project namespace
3. `--max-docs` cap hit silently (already fixed: default is now uncapped, but warn when cap is explicitly set and hit)

### Design

**Skip auto-Triage:** Remove the automatic Triage workstream creation from the onboard command. The synthesis agent creates workstreams based on actual work themes. If it needs a triage workstream, it creates one. No empty placeholder.

**Filter existing brain notes from doc scanner:** In `walkForDocs`, read the first 500 bytes of each `.md` file. If the file already has YAML frontmatter containing `module:`, skip it — it's a brain note, not a project doc. This prevents brain's own design docs from being re-ingested under the project namespace.

**Warn on explicit cap hit:** When `--max-docs N` is explicitly passed and the cap is reached, print: `"Warning: doc limit reached (N/N). Some components may have reduced coverage. Omit --max-docs for full ingestion."`

### Files changed
- `src/modules/pm/commands/onboard.ts` — remove auto-Triage, add cap warning
- `src/modules/pm/engine/doc-scanner.ts` — skip files with existing `module:` frontmatter

---

## Fix I: `task list --json` Includes Virtual States (O-105, O-106)

### Problem
`task list --json` omits `virtualStates` and `depends_on`. Agents need N+1 `task show` calls to find blocked tasks. `--status blocked` returns nothing because blocked is a computed virtual state.

### Design
In `listTasks()`, compute virtual states for each task using the same logic as `getTask()` but batched. Include `virtualStates` and `depends_on` arrays in JSON output.

Make `--status` accept virtual state names (`blocked`, `ready`, `eligible`). When a virtual state is passed, filter by computed state instead of raw status. The help text documents which values are statuses vs virtual states.

### Files changed
- `src/modules/pm/data/task-ops.ts` — batch virtual state computation in listTasks
- `src/modules/pm/commands/task.ts` — virtual state filter support in --status

---

## Fix J: `brain pm onboard status` (O-128)

### Problem
Agents `cat` the manifest file at a hardcoded path to inspect onboard results. No CLI command exposes the manifest.

### Design
Add a `status` subcommand to onboard: `brain pm onboard status [prefix]`. Reads the onboard manifest note from the DB, formats as a summary table:

```
Onboard Manifest — VOLT (voltras)
  Created: 2026-02-28

Components (4):
  voltra-node-sdk     node           packages/node-sdk
  voltra-private      node           packages/private
  titan-design        react-native   packages/titan-design
  workout-analytics   node           packages/workout-analytics

Documentation:
  Discovered: 20 | Ingested: 20 | Coverage: 100%

Phases:
  Detect:   4 components found
  Create:   Project created
  Discover: 20 docs found
  Ingest:   20 docs ingested
```

If `--json` is passed, output the raw manifest JSON.

When no prefix is given, use the active project (from `getActiveProject`).

### Files changed
- `src/modules/pm/commands/onboard.ts` — add status subcommand

---

## File Change Summary

| # | File | Fixes | Type | Est. Lines |
|---|------|-------|------|-----------|
| 1 | `src/modules/pm/commands/orchestrate.ts` | A | Edit | +60 |
| 2 | `src/modules/pm/commands/onboard.ts` | A, G, H, J | Edit | +120 |
| 3 | `src/modules/pm/commands/task.ts` | B, F, I | Edit | +40 |
| 4 | `src/modules/pm/data/queries.ts` | C | Edit | +15 |
| 5 | `src/modules/pm/index.ts` | D | Edit | +20 |
| 6 | `src/modules/pm/data/workstream-ops.ts` | E | Edit | +20 |
| 7 | `src/modules/pm/data/task-ops.ts` | I | Edit | +30 |
| 8 | `src/modules/pm/engine/doc-scanner.ts` | H | Edit | +15 |

### Tests

| File | Coverage |
|------|----------|
| `__tests__/modules/pm/commands/onboard.test.ts` | --cwd flag, skip Triage, onboard status, reference doc ingestion, cap warning, frontmatter filtering |
| `__tests__/modules/pm/commands/task.test.ts` | Workstream display ID resolution, virtual state filter, empty filter diagnostic |
| `__tests__/modules/pm/data/queries.test.ts` | NOT_FOUND enrichment with known prefixes |
| `__tests__/modules/pm/engine/doc-scanner.test.ts` | Skip files with module: frontmatter |

---

## Expected V6 Impact

| Metric | V5 | V6 (projected) |
|--------|-----|----------------|
| Avg quality | 3.5/5 | 4.2+/5 |
| Prompts ≤3/5 | 14/30 | 5-7/30 |
| Prompts at 5/5 | 5/30 | 8-10/30 |
| Avg calls/prompt | 15.5 | 10-12 |

25 of 30 prompts are directly impacted by at least one fix in this scope.

---

## What's NOT in V6

| Item | Observation | Why defer |
|------|-------------|-----------|
| Dispatch enrichment | O-102 | Most complex change, dispatch works functionally |
| Graph relations | O-25 | Needs its own design, large scope |
| Temporal planning | O-116 | New data model fields, needs design |
| Fuzzy/name lookup | O-117 | Cross-cutting, touches many commands |
| Full doc retrieval | O-120 | Core brain feature, not PM-specific |
| `pm show` command | O-109 | Overlaps with briefing/status |
| Task body depth | O-127 | Prompt engineering in synthesis agent |
| Context path resolution | O-118 | Core brain command, not PM-specific |
| Doc coverage tracking | O-131 | Core brain feature, not PM-specific |
