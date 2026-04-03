# Planning Workflow

The planning workflow runs a multi-agent pipeline: research, interview, design, critic review, spec tests, task decomposition, implementation, and code review.

## Usage

Start via MCP:

```typescript
brain_workflow_start({
  workflowId: 'planning',
  project: 'VNM',
  workstream: '49',
  context: {
    complexity: 'high',
    planId: 'my-feature',
    researchFocus: 'What to investigate',
    // ... additional params below
  }
})
```

Or via CLI:

```bash
brain workflow start planning --project VNM --workstream 49 \
  --context '{"complexity":"high","planId":"my-feature"}'
```

## Parameters

### Core Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `complexity` | `low \| medium \| high` | `high` | Controls which phases run (see below) |
| `planId` | `string` | first 8 chars of run ID | Identifies the plan directory at `.plans/<planId>/` |
| `researchFocus` | `string` | — | Guides the research agent's investigation areas |

### Context Seeding Parameters

These inject pre-existing knowledge into the workflow, avoiding redundant research.

| Parameter | Type | Description |
|-----------|------|-------------|
| `brainNotes` | `string` (comma-separated) | Brain note references to include. Supports full paths (`research/my-note`), slugs (`my-note`), or filenames (`my-note.md`). Resolved from `.brain/notes/`. |
| `files` | `string` (comma-separated) | Source file paths relative to project root. Contents are included verbatim. |
| `priorContext` | `string` | Free-text summary of prior research, decisions, or context. |
| `interviewAnswers` | `string` | Pre-filled interview responses. When provided, the interactive interview step is skipped and these answers are passed directly to the design agent. |

### How Seeding Works

When any seeding parameter is provided, a deterministic `seed` step runs before research:

1. Reads brain notes from `.brain/notes/` (searches subdirectories if a flat slug is given)
2. Reads source files from the project directory
3. Combines all context into `.plans/<planId>/pre-existing-context.md`
4. Assesses coverage across three dimensions:
   - **Codebase review**: references to `src/` paths, test files, existing code analysis
   - **External research**: URLs, paper references, competitive analysis
   - **Requirements**: explicit requirements, acceptance criteria, user needs
5. If all three dimensions are covered, sets `skipResearch=true`

The research agent reads `pre-existing-context.md` and focuses on gaps rather than re-researching covered areas. The design agent treats it as foundational context alongside the research brief.

## Complexity Levels

| Level | Research | Interview | Design/Critic | Spec Tests | Decompose | Implement | Review |
|-------|----------|-----------|---------------|------------|-----------|-----------|--------|
| `low` | skip | skip | yes | yes | yes | yes | yes |
| `medium` | yes | skip | yes | yes | yes | yes | yes |
| `high` | yes | yes (assisted) | yes | yes | yes | yes | yes |

When `skipResearch=true` (from seed coverage), research is skipped regardless of complexity.
When `interviewAnswers` is provided, interview is skipped regardless of complexity.

## Pipeline Steps

### seed (deterministic, no agent)
Gathers pre-existing context and writes `pre-existing-context.md`. Only runs if seeding params are provided.

### research (agent: planning-research)
Explores the codebase, reads documentation, searches brain KB, conducts external research. Produces `.plans/<planId>/research-brief.md`. When pre-existing context is available, validates and fills gaps rather than starting from scratch.

### interview (assisted step, coordinator-driven)
Interactive Q&A with the user to gather requirements, constraints, and scope. Questions are informed by the research brief. Only runs at `high` complexity when `interviewAnswers` is not provided.

### design (agent: planning-design)
Produces three artifacts: `spec.md`, `design.md`, `acceptance-criteria.md`. Reads both the research brief and pre-existing context.

### critic (agent: planning-critic)
Adversarial review from three perspectives (correctness, error handling, API design). Produces `critic-report.md` with a verdict of READY or NEEDS REVISION.

### design/critic loop
If the critic returns `needs_revision`, design and critic repeat (max 3 iterations). If the critic returns `has_open_questions`, a targeted re-research pass runs before the next design iteration.

### spec-tests (agent: planning-spectests)
Generates test specifications from acceptance criteria.

### decompose (agent: planning-decompose)
Breaks the design into implementation tasks with file ownership and wave ordering.

### implement (agent: implementation-compact)
Executes the implementation.

### review (agent: review-agent)
Code review of the implementation.

## Artifacts

All artifacts are written to `.plans/<planId>/`:

| File | Producer | Description |
|------|----------|-------------|
| `pre-existing-context.md` | seed | Gathered brain notes, files, prior context |
| `research-brief.md` | research | Codebase analysis, external findings, knowledge gaps |
| `spec.md` | design | Problem specification and requirements |
| `design.md` | design | Technical approach, file plan, API shapes |
| `acceptance-criteria.md` | design | Testable Given/When/Then conditions |
| `critic-report.md` | critic | Adversarial review with FIX/ACCEPTED findings |
| `step-outputs/<step>.md` | runtime | Raw output from each agent step |

## Example: Planning with Pre-Existing Research

When you've already done research in a conversation and want to hand it off:

```typescript
brain_workflow_start({
  workflowId: 'planning',
  project: 'VNM',
  workstream: '36',
  context: {
    complexity: 'medium',
    planId: 'post-execution-analysis',
    researchFocus: 'Quality scoring calibration, LLM choice for analyzer, dual-path normalization',
    brainNotes: [
      'research/competitive-analysis-openspace-hkuds',
      'research/external-landscape-agent-session-analysis-self-improvement-2026',
      'research/session-intelligence-vision-for-brain-integration',
    ].join(','),
    files: [
      'src/modules/sessions/engine/accumulator.ts',
      'src/modules/agents/agent-done-handler.ts',
      'docs/plans/post-execution-analysis/research-brief.md',
    ].join(','),
    priorContext: 'Architecture decided: three-stage pipeline (Capture → Analyze → Learn). See research-brief.md for full details.',
    interviewAnswers: 'See docs/plans/post-execution-analysis/requirements.md for the four pillars: summarization & scoring, live visibility, session bootstrapping, self-improvement.',
  }
})
```
