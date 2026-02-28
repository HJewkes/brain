---
name: pm-onboard
description: Set up a PM project from a codebase with structured component analysis and documentation ingestion
triggers:
  - onboard this project
  - set up PM
  - create a project from this repo
  - brain pm onboard
---

# PM Onboard

Set up a PM project from a codebase with structured component analysis and documentation ingestion.

## When to Use

- User says "onboard this project", "set up PM", "create a project from this repo"
- User invokes `brain pm onboard`
- Diagnostic script runs the setup phase

## Flow

### Phase 1: CLI Setup (deterministic)

Run the onboard command:

```bash
brain pm onboard <project-name> [--prefix <PREFIX>] [--max-docs 20]
```

This creates the project, discovers components, and ingests documentation. Read the JSON output to get the manifest.

If the project already exists and needs fresh setup:
```bash
brain pm onboard <project-name> --reset [--prefix <PREFIX>]
```

### Phase 2: Component Analysis (parallel agents)

For each component in the manifest, spawn an analysis agent. Max 4 concurrent agents.

**IMPORTANT:** When spawning agents via `claude -p`, unset the CLAUDECODE environment variable:
```bash
env -u CLAUDECODE claude -p --model sonnet --permission-mode bypassPermissions ...
```

Each agent receives:
- Component name, path, type, entry points from the manifest
- List of ingested doc slugs for that component
- The component analysis prompt (see `docs/pm-module/diagnostic/prompts/component-analysis.md`)

Agents use `brain search` to read ingested docs and up to 5 source files for architecture understanding.

### Phase 3: Workstream Synthesis (single agent)

After all component analyses complete, spawn a synthesis agent that:
- Reads all component analysis outputs
- Identifies cross-cutting work themes (NOT 1:1 with components)
- Creates workstreams via `brain pm workstream add`
- Creates tasks with `brain pm task add --description` for each
- Sets priorities, categories, and dependencies
- Ensures variety: at least 3 categories, 3 priority levels, dependency chains where logical

### Phase 4: Final Output

```bash
brain index
brain pm briefing --full
```

Present summary to user: component count, workstream count, task count, doc coverage.

## Notes

- Components are structural (frontend, backend, services)
- Workstreams are cross-cutting work themes (auth migration, performance, testing)
- The synthesis agent should NOT create one workstream per component
