# Project Sanity Check Skill — Design

**Date:** 2026-02-27
**Status:** Approved
**Scope:** On-demand Claude Code skill + supporting CLI commands for project consistency checking

---

## Context

After ingesting dozens of planning docs, meeting notes, and PR summaries into a PM project, inconsistencies accumulate: contradicting decisions, stale prompts, orphaned references, superseded documents that haven't been annotated. These issues are invisible until they cause agent confusion or wasted work.

The sanity check skill lets a user invoke `/sanity-check` to get a structured consistency report with findings and recommended actions. The CLI does all deterministic checking and data assembly; Claude reasons over the structured output for semantic analysis.

## Design Principle

**Push everything deterministic to the CLI.** The skill should receive pre-computed, LLM-optimized data — not raw queries. The CLI commands:
1. Run all structural checks that don't need reasoning (broken deps, orphans, stale timestamps)
2. Format results with full context inline (not IDs that require follow-up lookups)
3. Pre-compute comparison pairs for semantic analysis (e.g., decisions with overlapping impact targets)
4. Output structured JSON designed for LLM consumption (concise, no noise, relevant context co-located)

Claude's job is limited to: reading structured data, spotting semantic contradictions, assessing staleness, and writing the report.

---

## Architecture

```
/sanity-check skill invoked
        │
        ▼
  brain pm check --project PREFIX --json
        │
        ├── Structural checks (deterministic, fast)
        │   Returns: issues[] with full context inline
        │
        └── Semantic analysis input (data assembly)
            Returns: decision pairs, task-decision alignment,
                     source doc clusters — all pre-formatted
        │
        ▼
  Claude reasons over structured JSON
        │
        ├── Contradictions (decisions that disagree)
        ├── Misalignments (decision says X, task does Y)
        ├── Supersession gaps (implicit contradictions not formally superseded)
        └── Source doc freshness (which docs are stale)
        │
        ▼
  Report written to docs/pm-module/reports/sanity-check-YYYY-MM-DD.md
  Optionally: PM tasks created for actionable findings
```

---

## New CLI Command: `brain pm check`

### `brain pm check --project PREFIX --json`

Runs all consistency checks and returns a single JSON document optimized for LLM consumption.

### Output Schema

```typescript
interface ConsistencyReport {
  project: string;
  timestamp: string;
  summary: {
    totalTasks: number;
    totalDecisions: number;
    totalPrompts: number;
    sourceDocuments: number;
    issuesFound: number;
  };

  // Phase 1: Structural issues (deterministic)
  structural: {
    orphanedDecisions: OrphanedDecision[];     // decisions with empty impacts[]
    stalePrompts: StalePrompt[];                // prompts older than impacting decisions
    brokenDependencies: BrokenDep[];            // deps referencing nonexistent tasks
    blockedWithoutCause: BlockedTask[];         // status=blocked but no blocking dep
    cancelledDependencies: CancelledDep[];      // active tasks depending on cancelled tasks
    unreachableTasks: UnreachableTask[];         // tasks whose deps form a satisfied chain but are not eligible (state machine issue)
  };

  // Phase 2: Semantic analysis input (pre-computed pairs)
  semantic: {
    decisionPairs: DecisionPair[];              // decisions with overlapping impacts, for contradiction check
    taskDecisionAlignment: TaskDecisionPair[];  // tasks + their impacting decisions, for misalignment check
    supersessionGaps: SupersessionGap[];        // decisions that contradict earlier decisions but lack formal supersession
  };

  // Phase 3: Source document freshness
  sourceDocuments: SourceDocCluster[];           // groups of docs covering same topic, sorted by date
}
```

### Structural Check Details

Each structural issue includes **full context inline** — no follow-up queries needed:

```typescript
interface OrphanedDecision {
  id: string;           // display ID
  title: string;        // decision title
  status: string;       // accepted/proposed
  sourceTask: string;   // which task created it
  content: string;      // first 200 chars of body
  reason: string;       // "No tasks listed in impacts[]"
}

interface StalePrompt {
  id: string;
  task: string;          // task display ID
  taskTitle: string;
  promptIndexedAt: string;
  newerDecisions: {      // which decisions are newer
    id: string;
    title: string;
    indexedAt: string;
  }[];
  reason: string;
}

interface BrokenDep {
  task: string;          // task with the broken dep
  taskTitle: string;
  dependsOn: string;     // the nonexistent target
  reason: string;        // "Target task does not exist"
}

interface BlockedTask {
  id: string;
  title: string;
  status: string;        // "blocked"
  dependencies: string[]; // all deps
  allDepsStatus: string;  // "all deps are done" or similar
  reason: string;
}

interface CancelledDep {
  task: string;
  taskTitle: string;
  dependsOn: string;
  dependsOnStatus: string; // "cancelled"
  reason: string;
}
```

### Semantic Analysis Input

The CLI pre-computes comparison pairs so Claude doesn't need to do O(n²) lookups:

```typescript
interface DecisionPair {
  // Two decisions that share at least one impact target
  decision1: { id: string; title: string; content: string; status: string; impacts: string[] };
  decision2: { id: string; title: string; content: string; status: string; impacts: string[] };
  sharedImpacts: string[];  // task IDs both decisions affect
  reason: string;           // "Both affect tasks X, Y — check for contradictions"
}

interface TaskDecisionPair {
  task: { id: string; title: string; category: string; status: string };
  decisions: {
    id: string;
    title: string;
    content: string;     // full decision body
    status: string;
  }[];
  prompt?: string;        // current prompt content (if any)
  reason: string;         // "Task has N impacting decisions — check alignment"
}

interface SupersessionGap {
  // Decisions on the same topic/task that may implicitly contradict
  // without a formal supersession relation
  older: { id: string; title: string; content: string; createdAt: string };
  newer: { id: string; title: string; content: string; createdAt: string };
  sharedContext: string;   // what they have in common (same source task, same impacts)
  reason: string;          // "Both created for task X, 2 weeks apart, no supersession"
}
```

### Source Document Clusters

Groups ingested documents by topic for freshness analysis:

```typescript
interface SourceDocCluster {
  topic: string;             // derived from title similarity or shared tags
  documents: {
    noteId: string;
    title: string;
    source?: string;         // original source identifier (file path, URL)
    sourceUrl?: string;      // external URL if available
    indexedAt: string;
    excerpt: string;         // first 300 chars
  }[];
  // Sorted newest-first within cluster
  reason: string;            // "3 docs on same topic spanning 6 weeks — check for supersession"
}
```

### `--deep` Flag

`brain pm check --deep` adds the semantic analysis and source document sections. Without `--deep`, only `structural` is populated (fast path for quick checks).

---

## New Engine: `consistency.ts`

### File: `src/modules/pm/engine/consistency.ts`

All deterministic check logic lives here. The command file just calls these functions and formats output.

```typescript
// Structural checks
export function findOrphanedDecisions(db: BrainDB, prefix: string): OrphanedDecision[];
export function findStalePrompts(db: BrainDB, prefix: string): StalePrompt[];
export function findBrokenDependencies(db: BrainDB, prefix: string): BrokenDep[];
export function findBlockedWithoutCause(db: BrainDB, prefix: string): BlockedTask[];
export function findCancelledDependencies(db: BrainDB, prefix: string): CancelledDep[];

// Semantic analysis input (pair computation)
export function computeDecisionPairs(db: BrainDB, prefix: string): DecisionPair[];
export function computeTaskDecisionAlignment(db: BrainDB, prefix: string): TaskDecisionPair[];
export function computeSupersessionGaps(db: BrainDB, prefix: string): SupersessionGap[];

// Source document clustering
export function clusterSourceDocuments(db: BrainDB, prefix: string): SourceDocCluster[];

// Top-level aggregator
export function runConsistencyCheck(db: BrainDB, prefix: string, deep: boolean): ConsistencyReport;
```

### Implementation Notes

**Orphaned decisions:** Query all decisions for project, filter where `impacts` is empty or undefined.

**Stale prompts:** Reuse existing `detectStalePrompts()` from `prompt-ops.ts`, but enrich with decision details inline.

**Broken dependencies:** For each task, resolve each `depends_on` entry. If `resolveDisplayId` returns NOT_FOUND, it's broken.

**Blocked without cause:** Tasks with `status: blocked` where all dependencies are `done`. This suggests the task was manually blocked but the reason may no longer apply.

**Cancelled dependencies:** Tasks depending on tasks with `status: cancelled`. The dependent task is effectively stuck.

**Decision pairs:** For all accepted/proposed decisions, compute the intersection of their `impacts[]` arrays. Any pair with non-empty intersection is a candidate for contradiction analysis.

**Supersession gaps:** For decisions sharing the same `source_task`, sorted by creation date, check if the older one has `status: superseded`. If not, flag as a potential gap.

**Source document clusters:** Group notes by title similarity (simple substring/keyword matching) or by shared `source` prefix. Sort by `indexedAt` within each cluster.

---

## Sanity Check Skill

### File: `~/.claude/skills/sanity-check/SKILL.md`

Installed by `brain pm install-hooks` (extend the existing installation).

### Skill Instructions

```markdown
# Sanity Check Skill

Invoke with: /sanity-check

## When to Use
- After bulk ingesting planning docs into a PM project
- Periodically during active project execution
- When you suspect contradicting information in the project

## Workflow

### Step 1: Get structural report
Run: brain pm check --project <PREFIX> --json
Review the structural section. Report any issues found.

### Step 2: Get deep analysis (if project has decisions/docs)
Run: brain pm check --deep --project <PREFIX> --json
Review the semantic section:
- For each decision pair: read both decision contents, determine if they contradict
- For each task-decision pair: verify the task's work aligns with its impacting decisions
- For each supersession gap: determine if the older decision is effectively superseded

### Step 3: Review source document clusters
For each cluster with multiple docs:
- Identify which is most recent / authoritative
- Flag older docs that contain contradicted information
- Recommend: annotate source doc, archive brain note, or produce consolidated doc

### Step 4: Write report
Save to: docs/pm-module/reports/sanity-check-YYYY-MM-DD.md
Format: [report template]

### Step 5: Offer actions
Ask user if they want to:
- Create PM tasks for actionable findings
- Archive superseded notes
- Produce a consolidated document for any topic with contradicting sources
```

---

## Report Format

```markdown
# Sanity Check Report: [PREFIX]
**Date:** YYYY-MM-DD
**Scope:** [N] tasks, [M] decisions, [P] source documents

## Summary
- Structural issues: [count]
- Potential contradictions: [count]
- Stale content: [count]
- Source docs needing attention: [count]

## Critical Issues
[Anything that blocks progress or indicates data integrity problems]

## Contradictions
[Decision pairs that disagree — with quoted excerpts and recommendation]

## Supersession Gaps
[Decisions that implicitly contradict but aren't formally superseded]

## Stale Content
[Prompts, decisions, or docs that are outdated]

## Source Document Freshness
[Clusters of docs on the same topic, with staleness assessment]
For each stale source:
- **Source:** [URL or file path]
- **Stale sections:** [specific sections if identifiable, or "entire document"]
- **Superseded by:** [newer decision/doc reference]
- **Recommendation:** Annotate source / Archive / Produce consolidated doc

## Structural Issues
[Orphaned decisions, broken deps, blocked without cause, etc.]

## Recommended Actions
[Numbered list with severity and effort]
```

---

## Integration with Existing Commands

### `brain pm install-hooks` Extension

Add the sanity-check skill to the installation:
- Write `~/.claude/skills/sanity-check/SKILL.md` alongside the existing orchestrator skill
- No new hooks needed (on-demand only)

### `brain pm briefing` Enhancement

Add a one-line summary to the briefing output:
```
Consistency: 3 structural issues found. Run /sanity-check for details.
```

This uses the fast structural checks only (no `--deep`).

---

## New Files

| File | Purpose |
|------|---------|
| `src/modules/pm/engine/consistency.ts` | All check logic |
| `src/modules/pm/commands/check.ts` | CLI command |
| `__tests__/modules/pm/consistency.test.ts` | Unit tests for checks |
| `__tests__/integration/pm/wave-11-check.test.ts` | Integration tests |
| Skill file (installed by install-hooks) | Claude Code skill |

## Dependencies

- Requires existing PM module (decisions, tasks, prompts, queries)
- No new npm dependencies
- No new LLM integration (Claude Code IS the LLM)

## Success Criteria

- [ ] `brain pm check --project PREFIX --json` returns structural issues
- [ ] `brain pm check --deep --project PREFIX --json` returns semantic analysis input
- [ ] All structural checks are deterministic and tested
- [ ] Semantic analysis input is pre-computed (no O(n²) in the skill)
- [ ] Report format is clear and actionable
- [ ] Skill installed by `brain pm install-hooks`
- [ ] Briefing shows consistency summary line
