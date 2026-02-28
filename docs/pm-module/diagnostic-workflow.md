# Diagnostic Workflow for Agent-Facing Systems

A repeatable process for evaluating how well a CLI tool, skill, or agent-facing system serves its users (both human and AI). Developed during the brain PM module onboarding evaluation (2026-02-27).

## When to Use This

- After building a new CLI tool, skill, or module that agents will interact with
- After a major refactor that changes command output or data structures
- When onboarding a real project for the first time
- When you suspect agent workflows are inefficient but don't know where the bottleneck is
- Periodically as a health check after shipping fixes

## Overview

```
    ┌─────────────────────────────────────────────┐
    │                                             │
    ▼                                             │
Phase 1: Live User Testing (observations)         │
    ↓  ← write findings, compact context          │
Phase 2: Session Tailing (error/pattern discovery) │
    ↓  ← write findings, compact context          │
Phase 3: Data Audit (verify what was actually      │
         created)                                  │
    ↓  ← write findings, compact context          │
Phase 4: Gap Analysis (what was available vs       │
         ingested)                                 │
    ↓  ← write findings, compact context          │
Phase 5: Test Bench (automated agent prompts       │
         with metrics)                             │
    ↓  ← write findings, compact context          │
Phase 6: Prioritize & Fix                          │
    ↓  ← code review, update observations, commit │
    │                                             │
    └─── restart prompt ──────────────────────────┘
```

The diagnostic workflow is a **loop**. Phase 6 ends by committing fixes and outputting a restart prompt that kicks off a fresh cycle from Phase 1. Each cycle re-onboards (if needed), re-tests, and re-measures — the test bench results accumulate as `test-bench-results-v1.md`, `v2.md`, `v3.md`, etc. The cycle continues until quality targets are met or remaining observations are deferred by design.

## Context Management

Each phase generates significant data. Without discipline, the context window fills before the phase completes and findings are lost to compaction.

**Rule: End every phase by writing to disk, then compacting.**

At the end of each phase:
1. **Write all findings to the tracking files** — observations, punch list updates, metrics, analysis. Nothing should exist only in the conversation.
2. **Give the user a pickup prompt** — a 2-3 sentence message they can paste to resume the next phase in a fresh or compacted context. Include: which phase to start, which files to read, and any state that carries forward.
3. **User triggers compaction** (manual `/compact` or new session).

**Pickup prompt template:**
> "We're running the diagnostic workflow (docs/pm-module/diagnostic-workflow.md). Phases 1-N are complete — findings are in docs/pm-module/onboarding-observations.md. Start Phase N+1: [phase name]. Read [specific files] for context."

**Within long phases (especially Phase 5):** Write results to disk after each wave of test prompts, not just at the end. If the phase has 30 prompts in 8 waves, write after each wave. This ensures no work is lost if context compacts mid-phase.

---

## Phase 1: Live User Testing

**Goal:** Observe real friction as it happens.

**Setup:**
- Two sessions running simultaneously:
  - **Session A** (clean): A fresh Claude Code instance where the user follows docs as a real user would. This is the session under test.
  - **Session B** (observer): A separate session for discussion, observation logging, and code fixes. This session watches Session A.
- A tracking document (e.g., `docs/pm-module/onboarding-observations.md`) initialized with:
  - Date, tool version, test project, setup notes
  - Observation template (ID, severity, location, what happened, expected, fix)
  - Punch list table for status tracking

**Process:**
1. User works through the intended workflow in Session A
2. After each interaction, discuss in Session B: what went well, what felt wrong, what broke
3. Log observations immediately with severity levels:
   - **blocker**: Can't proceed without a fix
   - **friction**: Works but feels wrong or takes too many steps
   - **suggestion**: Idea for improvement, not blocking
   - **docs**: Documentation gap or inaccuracy
4. For blockers: stop, fix in Session B, rebuild, restart onboarding from clean state
5. For everything else: log and continue — don't change the system mid-test (moving target problem)

**Key principle:** The user should behave naturally, not accommodate the tool. If they have to ask "should I be in the project directory?" — that's an observation, not a user error.

**Outputs:** Observation document with numbered entries (O-01, O-02, ...), severity ratings, and a punch list.

**Phase exit:** Write all observations and punch list to tracking doc. Give pickup prompt for Phase 2.

---

## Phase 2: Session Tailing

**Goal:** See what the agent in Session A actually did — tool calls, errors, retries, workarounds.

**Setup:**
- Session logs live at `~/.claude/projects/<project-hash>/<session-id>.jsonl`
- Each line is a JSON object with role, content, and tool call details

**Process:**
1. From Session B, read the JSONL session log of Session A
2. Extract and review:
   - **Bash commands run**: What CLI commands did the agent try? In what order?
   - **Errors encountered**: What failed? Did the agent retry? How did it recover?
   - **Tool call patterns**: How many calls to discover vs execute? What was the exploration overhead?
   - **Workarounds**: Did the agent read files directly instead of using CLI? Write shell scripts? Query the database?
3. Log new observations from patterns you spot in the session log that the user didn't notice during live testing

**What to look for:**
- Commands the agent tried that don't exist (reveals mental model mismatches)
- Commands that succeeded but returned unhelpful output (reveals formatting gaps)
- Sequences where the agent retried the same thing with different flags (reveals bad error messages)
- Points where the agent switched from CLI to direct file access (reveals CLI insufficiency)
- Total tool call count for simple questions (reveals efficiency problems)

**Outputs:** Additional observations added to the tracking doc, particularly around error recovery and agent workarounds.

**Phase exit:** Write all new observations and update punch list. Give pickup prompt for Phase 3.

---

## Phase 3: Data Audit

**Goal:** Verify what was actually created in the system — not what the agent claimed, but what's in the database and on disk.

**Process:**
1. Query the database directly (e.g., sqlite3 for brain):
   - Count records by type (notes, tasks, relations, activities, chunks)
   - Check field completeness (are names populated? are categories varied?)
   - Verify relationships (are notes linked to projects? do dependencies exist?)
   - Check for orphaned data (notes with no relations, tasks with no body content)
2. Inspect files on disk:
   - Read a sample of generated files — are they well-formed?
   - Check frontmatter field values — are they using the full taxonomy?
   - Look for empty or template-only content
3. Compare against expectations:
   - If 67 tasks were created, how many have bodies? How many have dependencies?
   - If architecture notes exist, are they linked to the project?
   - Are all categories represented, or is everything "implementation"?

**What to look for:**
- Monoculture: all tasks same category, same mode, same priority distribution
- Orphaned data: notes not linked to anything, zero relations, zero activities
- Field mismatches: `title` populated but `name` empty (or vice versa)
- Missing data: zero dependencies means the wave engine is useless
- Quality distribution: are some notes rich and others empty shells?

**Outputs:** Audit findings added as observations. Often reveals systemic issues (e.g., "all 67 tasks are category=implementation") that aren't visible from individual interactions.

**Phase exit:** Write audit findings and aggregate stats to tracking doc. Update punch list. Give pickup prompt for Phase 4.

---

## Phase 4: Gap Analysis

**Goal:** Compare what data was available to the agent vs what they actually ingested.

**Process:**
1. Explore the source project comprehensively:
   - What repos/directories exist?
   - What documentation files exist? (`**/*.md`, `**/docs/**`, `**/.github/**`, `**/CLAUDE.md`)
   - What config files reveal architecture? (`package.json`, `tsconfig.json`, `app.json`)
   - What planning docs exist? (roadmaps, specs, design docs, changelogs)
2. Inventory what was actually ingested:
   - List all created notes/tasks with their sources
   - Map each to the original file(s) the agent read
3. Cross-reference:
   - What docs exist but weren't read?
   - What docs were read but not ingested as notes?
   - What was ingested that duplicates existing docs?
   - What categories of information are completely missing? (features vs tech debt, research vs implementation)

**What to look for:**
- **Doc-blind agents**: Read source code but skipped README, CHANGELOG, ROADMAP
- **Reinvented docs**: Wrote architecture notes from code when official docs existed
- **Missing categories**: All tasks are tech debt, zero feature work (because roadmap wasn't read)
- **Cross-repo blindness**: Workspace-level coordination docs not ingested
- **Stale doc risk**: Ingested docs that may contradict current code

**Outputs:** Gap analysis observations with specific files missed and their impact. Informs the doc-first vs code-first discovery strategy.

**Phase exit:** Write coverage tables and gap findings to tracking doc. Update punch list. Give pickup prompt for Phase 5.

---

## Phase 5: Test Bench

**Goal:** Quantitative baseline of agent performance against the system.

### Designing Prompts

Create 20-30 prompts across these categories:

| Category | Purpose | Example |
|----------|---------|---------|
| **Discovery** | Can an agent find and understand the project? | "What projects am I tracking?" |
| **Navigation** | Can it filter, sort, and select tasks? | "What are the critical priority tasks?" |
| **Context Assembly** | Can it build rich context for a task? | "Brief me on task X" |
| **Planning** | Can it reason about ordering and priorities? | "What should we ship first?" |
| **System Capabilities** | Does it understand what the tool can do? | "How do I add a task?" |
| **Known Gap Exercisers** | Do documented issues cause real pain? | "List all tasks with names" |
| **Write Operations** | Can it claim, create, update, complete tasks? | "Claim task X and start working" |
| **Agent-Facing Commands** | Do dispatch/context/verify commands work? | "Generate a dispatch prompt for task X" |
| **Cross-System Queries** | Can it bridge PM data and knowledge base? | "What notes relate to this workstream?" |
| **Filtering & Retrieval** | Can it efficiently filter and get detailed data? | "Show critical pending tasks by workstream" |

For each prompt, document:
- What it tests
- Expected ideal answer
- Which known observations (O-XX) it should hit

**Expanding the suite:** After each test bench run, review results for capability gaps not covered by existing prompts. Add new categories and prompts that target: (1) areas where V(N) fixes should produce measurable improvement, (2) capabilities that previous prompts didn't exercise (e.g., write operations, cross-domain queries), and (3) newly discovered failure modes. Document new prompts in the same file as the originals.

### Running Prompts

- Spawn each as a fresh sub-agent with **zero context** — only the system prompt and skills
- Use sonnet for cost efficiency (not opus)
- Run in waves of 4 concurrent agents max
- Read-only for read prompts; write prompts may modify system state (run these last or reset between runs)
- Prompt template: "You are testing a tool called 'brain' installed globally. The user wants to know: [question]. Use whatever tools you can discover. Do NOT modify any files. Return findings plus a log of commands run and their output."

**Important: Write results to disk after each wave.** Don't accumulate 30 prompt results in context before writing. After each wave of 4 completes:
1. Record the per-prompt metrics and analysis in the results file
2. Note any new observations in the tracking doc
3. This protects against context compaction losing unwritten results

### Measuring Results

For each prompt, record:

| Metric | What it measures |
|--------|-----------------|
| **Answer quality** (1-5) | Did the agent answer the actual question correctly? |
| **Total tool calls** | Overall cost of getting the answer |
| **Brain CLI calls** | How many tool calls used the system's CLI |
| **Non-brain calls** | How many bypassed the CLI (file reads, shell scripts, sqlite3) |
| **Read calls** | Direct .md file reads (indicates CLI output insufficiency) |
| **Skill triggered** | Did the agent find and use a relevant skill? |
| **Time** | Wall clock time to complete |
| **Tokens** | Approximate token cost |
| **Gaps confirmed** | Which O-XX observations were hit? |
| **New observations** | Anything unexpected? |
| **Commands run** | Full command log with output summaries — needed for identifying specific improvement opportunities |

### Per-Prompt Analysis

Raw metrics alone aren't sufficient. For each prompt, also write a short narrative covering:
- What commands the agent tried and in what order
- Where it hit friction (errors, workarounds, unnecessary exploration)
- What specific CLI improvements would reduce tool calls (e.g., "these 9 searches could be 1 search with `--full`")
- Whether the non-brain calls were avoidable (e.g., Python filtering that a `--priority` flag would eliminate)

This narrative is what drives actionable V(N+1) improvements. Without it, you have scores but no diagnosis.

### Key Ratios

- **Brain CLI %** = brain calls / total calls. Target: >85%. Below 60% means the CLI is insufficient.
- **Bypass %** = (non-brain + reads) / total calls. Target: <15%. High bypass means agents are working around the tool.
- **Skill adoption** = skill calls / total agents. Target: >50%. Zero means skills aren't discoverable.

### Interpreting Results

- If quality is high but efficiency is low → the data exists, CLI just doesn't surface it well
- If quality is low and efficiency is low → the data doesn't exist (gap analysis issue)
- If quality is high and efficiency is high → working well, no fix needed
- If one category scores much worse → that's your priority area

**Outputs:** Results file (`test-bench-results-vN.md`) with per-prompt breakdown, full scorecard table, aggregate metrics, cross-cutting findings, and V(N+1) comparison targets. New observations added to the tracking doc with punch list updates.

**Phase exit:** Ensure all per-prompt results, new observations, and punch list updates are written to disk. Review results against previous runs to identify new observations. Propose additions to the test suite if new capability gaps were discovered. Give pickup prompt for Phase 6.

**Cross-referencing with prior runs:** After completing all prompts, explicitly compare V(N) results against V(N-1) results prompt-by-prompt. Look for:
- Quality regressions (V(N) worse than V(N-1) on the same prompt)
- Efficiency regressions (more calls for the same answer)
- New patterns not captured in existing observations
- Observations that are now resolved and should be marked as fixed

**Comparison table format:**

| Metric | V(N-1) | V(N) | Delta |
|--------|--------|------|-------|
| Avg tool calls | ? | ? | ? |
| Brain CLI % | ? | ? | ? |
| Skill triggered | ? | ? | ? |
| Avg quality | ? | ? | ? |

---

## Phase 6: Prioritize & Fix

**Goal:** Convert observations into a prioritized fix plan, implement it, and hand off to the next diagnostic cycle.

### 6A: Design

1. Review all observations across phases 1-5
2. Identify root causes — many observations trace to a few core issues:
   - Example: O-17 (no names in output) caused by O-36 (title/name field mismatch) — fixing one resolves both
3. Prioritize into tiers:
   - **P0**: Fixes that unblock the most test bench prompts (highest frequency gaps)
   - **P1**: High-impact efficiency improvements (reduce tool calls per prompt)
   - **P2**: Structural improvements (relations, skills, dependency wiring)
   - **P3**: Workflow redesign (requires P0-P2 as foundation)
4. Write a design doc (`docs/plans/YYYY-MM-DD-<module>-fix-pass-design.md`)
5. Create an implementation plan (`.claude/plans/YYYY-MM-DD-<feature-name>/`)

**What makes a good P0:**
- Hit by >50% of test bench prompts
- Has a clear root cause with a bounded fix
- Unblocks other improvements downstream

### 6B: Implement

1. Execute the implementation plan (subagent dispatch or parallel sessions)
2. Verify all tests pass and typecheck is clean after each wave

### 6C: Close

1. **Code review** — Review all commits as a batch. Check for dead code, consistent patterns, no regressions. Fix anything found.
2. **Update observations doc** — Mark fixed observations in the punch list with commit refs. Add any new observations discovered during implementation.
3. **Commit** — Observations doc update + any review fixes.
4. **Output restart prompt** — A self-contained prompt for a fresh session to start the next diagnostic cycle from Phase 1. The prompt should reference all relevant docs and note whether re-onboarding is needed before Phase 1.

**Outputs:** Updated punch list with fixed/deferred statuses. Design doc and implementation plan in `.claude/plans/`. Commits on a feature branch. Restart prompt for the next cycle.

**Restart prompt template:**
> "We're running the diagnostic workflow (docs/pm-module/diagnostic-workflow.md) for the brain PM module. The previous cycle (VN) completed Phases 1-6. Findings are in docs/pm-module/onboarding-observations.md. Test bench results: docs/pm-module/test-bench-results-vN.md. Fix pass design: docs/plans/YYYY-MM-DD-<name>-design.md.
>
> [Re-onboard first: the fixes changed CLI output/behavior, so re-run onboarding to rebuild indexes with current code. / No re-onboarding needed: fixes are query-side only.]
>
> Start a fresh diagnostic cycle (V(N+1)) from Phase 1. The test bench prompts are in docs/pm-module/test-bench-prompts.md."

---

**Phase exit:** Commit all fixes and observations updates. Output the restart prompt. The next session picks up from Phase 1 of a fresh cycle.

## File Structure

After multiple diagnostic cycles, you'll have:

```
docs/<module>/
  onboarding-observations.md    # All observations (O-01 through O-XX), punch list, fix log
  diagnostic-workflow.md         # This document
  test-bench-prompts.md          # Prompt definitions (grows each cycle)
  test-bench-results-v1.md       # Cycle 1 test bench metrics
  test-bench-results-v2.md       # Cycle 2 test bench metrics
  test-bench-results-vN.md       # Each cycle adds a new results file
docs/plans/
  YYYY-MM-DD-<module>-fix-pass-design.md    # Design doc for each fix pass
.claude/plans/
  YYYY-MM-DD-<feature-name>/               # Implementation plan directories
```

---

## Tips

- **Don't fix during testing** (Phase 1). Log observations and keep going. Fixing mid-test creates a moving target and invalidates subsequent observations. Exception: true blockers that prevent any further progress.
- **Two-session pattern is essential.** The observer session provides perspective the user session can't — the user is focused on the task, the observer is focused on the system.
- **Session logs are gold.** The user only notices visible friction. Session logs reveal invisible friction: retries, workarounds, unnecessary exploration, error recovery. Always tail the session log.
- **Data audits catch systemic issues.** Individual observations catch point failures. Auditing the database catches patterns: "all tasks are the same category" is invisible from a single interaction but obvious in aggregate.
- **Gap analysis catches omissions.** You can't observe what didn't happen. The agent won't tell you it missed the roadmap — you have to compare what existed vs what was ingested.
- **Test bench makes it measurable.** Observations are qualitative ("this feels slow"). Test bench metrics are quantitative ("this takes 30 tool calls on average"). Both matter, but metrics drive prioritization.
- **Brain CLI % is the key health metric.** If agents bypass the CLI more than 15% of the time, the CLI isn't serving them. This single ratio summarizes whether the tool is working for its primary consumers.
- **Fresh agents are honest testers.** Agents with conversation context will work around known issues. Zero-context agents hit every sharp edge, which is exactly what you want for testing.
- **Run the full cycle, not just parts.** Each phase catches things the others miss. Live testing catches UX friction. Session tailing catches error handling. Audits catch data quality. Gap analysis catches omissions. Test bench catches efficiency. Skip a phase and you'll miss a class of issues.
- **Write to disk aggressively.** The diagnostic workflow generates a lot of data — 30 prompt results, dozens of observations, audit stats, gap tables. If any of this exists only in the conversation context, it will be lost to compaction. Write findings to the tracking files after every wave, not just at phase boundaries.
- **Document full command logs, not just scores.** Per-prompt metrics (calls, brain%, quality) show *what* happened. Command logs show *why*. "9 search calls" is a score; "the agent ran 9 searches because `task show` doesn't include the note body" is a diagnosis that leads to a fix. Always record the narrative alongside the numbers.
- **Compact between phases.** Each phase is self-contained once its outputs are written to disk. Don't try to hold 7 phases in one context window. End each phase with a pickup prompt, compact, then start the next phase by reading the tracking files.
