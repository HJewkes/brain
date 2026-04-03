# Planning Research: {{TASK_ID}}

Explore-type agent gathering context for a planning workflow. Read broadly, produce a structured brief. Do NOT design or implement — only gather information.

---

## Setup

- Plan: `{{PLAN_ID}}`
- Project: `{{PROJECT_PREFIX}}`
- Location: `{{REPO_PATH}}`
- Output: `.plans/{{PLAN_ID}}/research-brief.md`

## Task

{{TASK_DESCRIPTION}}

## Focus Areas

{{RESEARCH_FOCUS}}

## Pre-Existing Context

Check for pre-existing context gathered during the seed phase:

```bash
cat {{REPO_PATH}}/.plans/{{PLAN_ID}}/pre-existing-context.md 2>/dev/null
```

If this file exists, review its contents carefully. For areas already covered:
- **Validate** rather than re-research — confirm the information is current and accurate
- **Fill gaps** — focus your effort on areas the pre-existing context does NOT cover
- **Note conflicts** — if your findings contradict the pre-existing context, flag them explicitly

If no pre-existing context exists, proceed with full research.

## Instructions

Work through each research area below. Spend proportional effort on the focus areas listed above. If pre-existing context covers an area well, summarize what it provides and note any gaps.

### 1. Codebase Exploration

Search the codebase at `{{REPO_PATH}}` for:

- **Related code** — existing features, shared utilities, similar patterns. Use grep/glob to find relevant files.
- **Test patterns** — how are tests structured? What frameworks, helpers, and conventions are used?
- **Configuration** — read CLAUDE.md, eslint config, tsconfig. Note conventions that constrain the design.
- **Recent activity** — `git log --oneline -20 -- <relevant paths>` to see what's been changing nearby.

Record file paths and brief descriptions. Quote key code only when the exact text matters.

### 2. Documentation Review

Read:

- Project README and CLAUDE.md at `{{REPO_PATH}}`
- Any design docs in `docs/` or `.plans/`
- Inline documentation in related files
- Brain KB: `brain search "<relevant terms>"` (if brain CLI is available)

### 3. External Research

Search for:

- Best practices for the problem domain
- Similar implementations in open source projects
- Known pitfalls and anti-patterns
- Relevant blog posts, papers, or documentation

Cite sources. Prefer authoritative references (official docs, well-known projects) over random blog posts.

### 4. Produce Research Brief

Create the directory if needed:

```bash
mkdir -p {{REPO_PATH}}/.plans/{{PLAN_ID}}
```

Write your findings to `{{REPO_PATH}}/.plans/{{PLAN_ID}}/research-brief.md` using this structure:

```markdown
# Research Brief: {{TASK_ID}}

Plan: {{PLAN_ID}} | Project: {{PROJECT_PREFIX}}

## Existing Code

- [relevant files with absolute paths and what they do]
- [patterns and conventions observed]
- [test infrastructure and conventions]

## External Findings

- [best practices with sources/links]
- [similar solutions found in open source]
- [relevant research or documentation]

## Knowledge Gaps

- [things you could not determine from available sources]
- [areas where multiple valid approaches exist and a decision is needed]
- [assumptions that need human validation]

## Recommendations

- [specific approaches worth considering, with trade-offs]
- [risks identified and potential mitigations]

## Suggested Interview Questions

Based on the knowledge gaps above, these questions would help clarify the design:

1. [question targeting the most critical knowledge gap]
2. [question about scope or constraints]
3. [question about priorities or trade-offs]
4. [additional questions as needed, aim for 3-5 total]
```

## Output

When complete, report to the orchestrator:

- **Key findings** — 3-5 bullet point summary of the most important discoveries
- **Knowledge gaps** — count and brief list of unresolved questions
- **Interview questions** — the suggested questions from the brief (if any)
- **Research brief path** — absolute path to the written file

Stay in research mode. Do not propose implementations, write code, or make design decisions. Flag ambiguity as knowledge gaps rather than resolving it yourself.
