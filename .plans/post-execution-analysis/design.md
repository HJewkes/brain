# Design: Post-Execution Analysis Pipeline

## Approach

The pipeline is a three-stage processor: **Capture → Analyze → Learn**. Capture fixes five gaps in `aggregate.ts`, `session-start-handler.ts`, and `session-post-tool-handler.ts` so that hook-captured sessions have parity with JSONL sessions on the five fields most important to quality scoring (`taskRefs`, `prLinks`, `filesTouched`, `filesWritten`, `skillUsage`, `planPresent`). Analyze introduces a new module (`post-execution-analyzer.ts`) that computes an Agent GPA score using a hybrid approach: Action is algorithmic (error rate, friction density), while Goal and Plan are LLM-scored against the session transcript and task description. Learn writes durable brain notes for each analyzed session and maintains skill counter notes that aggregate across runs.

The pipeline integrates as a hook handler at priority 25 (after sessions:commit at 20). This ordering guarantees that `commitSession` has already written full JSONL-derived analytics to the session note before analysis begins. The analyzer reads the final session note metadata rather than raw events, so it works identically for live and JSONL sessions.

For the LLM scoring, the analyzer builds a compact context string (~2000 tokens): task description (from BRAIN_PM_TASK env), top 10 tool calls, friction signals, plan presence, and outcome. It submits a structured prompt asking the LLM to score Goal (0–10) and Plan (0–10) with one-sentence rationale each. LLM calls are wrapped with `AbortSignal.timeout(30_000)`. On timeout, Goal and Plan default to null; emit `console.warn` with session ID and elapsed time. Action is computed algorithmically: `frictionDensity = frictionSignals.length / Math.max(toolCalls.length, 1)`, then `actionRaw = 1 - clamp(errorRate * 2 + frictionDensity, 0, 1)`, mapped to 0–10. Special case: if `toolCalls.length === 0`, Action returns 5.0 (neutral score, not 0 or 10).

## Files to Create/Modify

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/modules/sessions/engine/aggregate.ts` | Fix CB-01–CB-05: populate taskRefs, prLinks, filesTouched, filesWritten, skillUsage, planPresent from live events |
| Modify | `src/modules/sessions/hooks/session-post-tool-handler.ts` | Emit file-write and skill-invocation events alongside existing PR detection |
| Modify | `src/modules/sessions/hooks/session-start-handler.ts` | Emit `task_ref` event once at session start (reads BRAIN_PM_TASK env) |
| Create | `src/modules/sessions/analytics/post-execution-analyzer.ts` | Three-stage pipeline: compute GPA, write analysis note, update skill counters |
| Create | `src/modules/sessions/analytics/gpa-scorer.ts` | GPA computation: algorithmic Action + LLM Goal/Plan scoring |
| Create | `src/modules/sessions/analytics/skill-counters.ts` | Read/write skill counter brain notes (uses, successes, failures, utility) |
| Create | `src/modules/sessions/hooks/session-analysis-handler.ts` | Hook handler at priority 25; calls postExecutionAnalyzer |
| Modify | `src/modules/sessions/index.ts` | Register session-analysis-handler in hook registry |
| Modify | `src/modules/sessions/commands/index.ts` | Add `analyze` and `skill-stats` subcommands |
| Create | `src/modules/sessions/commands/analyze.ts` | CLI: `brain session analyze [--all] [session-id]` |
| Create | `src/modules/sessions/commands/skill-stats.ts` | CLI: `brain session skill-stats [--json]` |
| Create | `__tests__/modules/sessions/analytics/post-execution-analyzer.test.ts` | Unit tests for pipeline stages |
| Create | `__tests__/modules/sessions/analytics/gpa-scorer.test.ts` | Unit tests for algorithmic Action scoring |

## API Shapes / Type Signatures

```typescript
// src/modules/sessions/analytics/gpa-scorer.ts

export interface GpaDimensions {
  goal: number | null;    // 0–10, null if LLM unavailable
  plan: number | null;    // 0–10, null if LLM unavailable
  action: number;         // 0–10, always computed
}

export interface AgentGpaScore {
  sessionId: string;
  gpa: number | null;     // arithmetic mean of non-null dimensions, null if all LLM dims null
  dimensions: GpaDimensions;
  rationale: {
    goal?: string;        // one-sentence LLM rationale
    plan?: string;        // one-sentence LLM rationale
    action: string;       // computed summary: "errorRate=X, frictionCount=Y"
  };
  scoredAt: string;
}

// Narrow input interface — avoids coupling to full SessionAnalytics
export interface GpaScoringInput {
  errorRate: number;
  frictionSignals: Array<{ type: string }>;
  toolCalls: Array<{ tool: string }>;
  taskRefs: string[];
  planPresent: boolean;
  outcome: string | null;
  assistantTexts: string[];   // top N assistant turns for LLM context
}

export function computeActionScore(input: {
  errorRate: number;
  frictionSignals: Array<unknown>;
  toolCalls: Array<unknown>;
}): number;
// Returns 5.0 for empty toolCalls (neutral). Otherwise:
// frictionDensity = frictionSignals.length / Math.max(toolCalls.length, 1)
// score = (1 - clamp(errorRate * 2 + frictionDensity, 0, 1)) * 10

export async function scoreGpa(
  input: GpaScoringInput,
  sessionId: string,
  taskDescription: string | null
): Promise<AgentGpaScore>;
// Caller maps SessionAnalytics → GpaScoringInput in post-execution-analyzer.ts

// src/modules/sessions/analytics/skill-counters.ts

export interface SkillCounter {
  skillName: string;
  uses: number;
  successes: number;
  failures: number;
  gpaSum: number;           // running sum of GPA scores for averaging
  gpaCount: number;         // count of GPA scores included in sum
  utilityScore: number;     // (successes / uses) × (gpaSum / gpaCount) — recomputed on each update
  version: number;          // frontmatter version for NF-03 optimistic locking
  lastUpdated: string;
}
// avgGpa = gpaSum / gpaCount (computed on read, not stored)
// Optimistic locking: read version from note frontmatter before update;
// before writing, verify in-memory version matches on-disk version;
// retry up to 3 times on mismatch; on 3rd failure, log warning and skip

export async function getSkillCounter(
  brain: BrainService,
  skillName: string
): Promise<SkillCounter>;

export async function updateSkillCounter(
  brain: BrainService,
  skillName: string,
  outcome: 'success' | 'failure',
  gpa: number | null
): Promise<void>;

export async function listSkillCounters(brain: BrainService): Promise<SkillCounter[]>;

// src/modules/sessions/analytics/post-execution-analyzer.ts

export interface AnalysisResult {
  sessionId: string;
  gpa: AgentGpaScore;
  analysisNoteSlug: string | null;   // null if note write failed
  skillCountersUpdated: string[];     // skill names updated
  evolutionSuggestionSlug: string | null;
}

// For JSONL re-analysis (EC-04): convert session note metadata to GpaScoringInput
export function sessionNoteMetaToScoringInput(noteMeta: Record<string, unknown>): GpaScoringInput;
// Maps: error_rate → errorRate, tool_calls count → toolCalls array (length only),
// friction_count → frictionSignals, etc. Returns partial input sufficient for scoring.

// Parse PR URLs from raw strings (AC-02)
export function parsePrUrl(url: string): { number: number; repo: string; url: string } | null;
// Handles: https://github.com/<owner>/<repo>/pull/<number>
// Returns null for any other shape.

export async function runPostExecutionAnalysis(
  brain: BrainService,
  sessionId: string,
  taskDescription: string | null
): Promise<AnalysisResult>;
```

## Data Flow

```
agent-done hook fires
  → agents:agent-done (priority 10)  — marks agent completed, releases worktree
  → sessions:end (priority 15)       — interim outcome classification
  → sessions:commit (priority 20)    — full JSONL analysis, writes session note
  → sessions:analysis (priority 25)  — new: reads session note, runs GPA, writes analysis note

sessions:analysis handler:
  1. Read session metadata from brain DB (via session-ops.ts)
  2. Load SessionAnalytics via aggregateSessionEvents() or commitSession() result
  3. Call runPostExecutionAnalysis(brain, sessionId, taskDescription)
     a. gpa-scorer: computeActionScore (algorithmic) + scoreGpa (LLM if available)
     b. Write analysis brain note (type: analysis, module: sessions, visibility: private)
     c. skill-counters: update per skill in skillUsage map
     d. If Action < 6 && frictionSignals.length > 3: generate evolution suggestion note
  4. Return AnalysisResult, log summary to stderr

brain session analyze <id>:
  → Load session, call runPostExecutionAnalysis, print result table

brain session analyze --all:
  → List all sessions with jsonl_path, run analysis on each, print summary table

brain session skill-stats:
  → Call listSkillCounters, print table: skill | uses | successRate | avgGpa | utility
```

## Key Decisions

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| LLM scoring placement | Goal + Plan only; Action algorithmic | All three LLM-scored | Action is fully derivable from structured data (errorRate, frictionSignals); LLM adds no accuracy |
| Skill counter storage | Brain notes with frontmatter (`module: sessions`, `type: skill-counter`) | New DB table | Notes system already supports arbitrary structured data; avoids schema migration |
| Analysis pipeline trigger | Hook at priority 25 | Inline in commitSession | Keeps sessions:commit focused on data persistence; analysis can fail without breaking session record |
| Task description source | `BRAIN_PM_TASK` → PM CLI lookup | Stored in session note | PM CLI lookup is one shell call; avoids denormalizing task data into session storage |
| Evolution suggestions | Brain note per session | Append to template files | Suggestions need human review before modifying templates; notes are safe, auditable |
| GPA scale | 0–10 | 0–1 (like existing scorer) | More intuitive for a "grade" rubric; distinct from efficiency scorer to avoid confusion |

## Risks and Mitigations

- **LLM latency in hook chain:** The analysis handler runs async but the hook chain is synchronous. Risk: analysis blocks the agent-done hook. Mitigation: run analysis via `setImmediate` / detached async; the hook handler returns `hookAllow()` immediately and analysis is fire-and-forget.
- **Ollama unavailability:** Goal/Plan score null. Mitigation: action score is always computable; null LLM dims are flagged in the analysis note but don't prevent it from being written.
- **Session note not yet written at priority 25:** If commitSession (priority 20) fails, the session note may be incomplete. Mitigation: analysis handler checks for session metadata existence before proceeding; skips gracefully.
- **Duplicate analysis runs:** Manual `brain session analyze` might re-run on an already-analyzed session. Mitigation: check for existing analysis note with matching session ID before writing; overwrite or skip based on `--force` flag.

## Scaffolding vs. Implementation

**Wave 1 (blocking — fixes capture gaps):**
- `aggregate.ts`: fix CB-02–CB-05 (prLinks via `parsePrUrl()`, filesTouched, filesWritten, skillUsage with `count: 1` per invocation, planPresent). Standardize all event type names to underscores: `pr_created` (not `pr:created`), `task_ref`, `plan_present`, `skill_use`, `file_touch`.
- `session-post-tool-handler.ts`: emit `file_touch` and `skill_use` events (one per invocation, `count: 1`; aggregation in `aggregate.ts`)
- `session-start-handler.ts`: emit `task_ref` event once at session start (reads `BRAIN_PM_TASK` env); NOT in `session-capture-handler.ts`

**Wave 2 (parallelizable on top of capture fixes):**
- `gpa-scorer.ts`: Action scoring with `GpaScoringInput` interface (no dependencies). Mock Ollama in unit tests; AC-08 covered via `vi.mock('../../../../services/ollama.js')` with fixture LLM response.
- `gpa-scorer.ts`: LLM Goal/Plan scoring with 30s `AbortSignal.timeout`. When `taskDescription` is null (non-PM sessions), Goal scores null (no LLM call).
- `skill-counters.ts`: counter read/write with `version` frontmatter for optimistic locking, `gpaSum`/`gpaCount` for incremental avgGpa. Session-level granularity: 1 increment per skill per session.
- `post-execution-analyzer.ts`: includes `sessionNoteMetaToScoringInput()` for JSONL re-analysis (EC-04) and `parsePrUrl()` for AC-02.
- `session-analysis-handler.ts` + hook registration (depends on gpa-scorer, skill-counters). Analysis errors caught with outer `catch` guard against unhandled rejections.
- Evolution suggestions: appended as a sub-section in the session analysis note (avoids undefined skill→template matching for LN-02).

**Wave 3 (parallelizable on top of pipeline):**
- `analyze.ts` CLI command (with `--force` flag for re-analysis, EC-03)
- `skill-stats.ts` CLI command
- Tests for all new modules, including EC-04 test case: fixture with zero `session_events`, session note metadata only, assert analysis note written with GPA from note fields

## PR Boundaries

- **Option A:** Single PR with all changes (capture fixes + analysis pipeline + CLI + tests)
- **Option B:** PR 1 — capture bug fixes only; PR 2 — analysis pipeline; PR 3 — CLI + tests

**Recommendation: Option B.** The capture fixes are low-risk, self-contained, and immediately useful (existing tests cover them). The analysis pipeline depends on Ollama and needs careful review. Splitting ensures capture fixes ship without waiting for LLM integration review.
