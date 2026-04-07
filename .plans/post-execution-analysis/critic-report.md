# Critic Report: VNM-34.90

## Summary

The design identifies the right components and makes sound architectural choices (priority 25 hook, fire-and-forget async, notes instead of DB tables). However, it ships with ten concrete defects: two are type bugs that make implementation impossible without guessing, three are event naming/placement inconsistencies that will cause test failures, and two are spec conflicts where acceptance criteria contradict the proposed formula. The design is not ready to implement without revisions.

## Verdict: NEEDS REVISION

---

## Findings

### Correctness

- **[FIX] CB-01 emitted in wrong handler.** `session-start-handler.ts` already exists as a separate file. `BRAIN_PM_TASK` is an environment variable set once at session start, not per tool call. Placing emission in `session-capture-handler.ts` (a `pre-tool-use` handler that fires per tool call) means the event either fires on every tool call (producing duplicates consumed by AC-02's dedup requirement EC-02) or requires one-time guard logic that turns a 3-line fix into a stateful handler. Move CB-01 emission to `session-start-handler.ts`. `session-capture-handler.ts` should not be in the modified-files table for CB-01.

- **[FIX] EC-01 contradicts the Action formula.** The design formula is `1 - clamp(errorRate * 2 + frictionDensity, 0, 1)` × 10. With `toolCalls: []`, `errorRate = 0` and `frictionDensity = 0`, so the formula yields **10.0**. EC-01 requires **5.0** ("neutral score, not 0"). There is no formula that satisfies both without special-casing. Add an explicit branch: `if (toolCalls.length === 0) return 5.0` before applying the formula, and document this sentinel in the design.

- **[FIX] `frictionDensity` is undefined.** The Action formula references `frictionDensity` but the term appears nowhere in the spec, design, or type signatures. From context it is probably `frictionSignals.length / Math.max(toolCalls.length, 1)`, but this must be stated explicitly. The `computeActionScore` signature exposes `frictionSignals` and `toolCalls` (not `frictionDensity`), confirming it is a derived intermediate. Add a definition to `design.md`: `frictionDensity = frictionSignals.length / Math.max(toolCalls.length, 1)`.

- **[FIX] `SkillCounter` is missing `avgGpa` — utility score is uncomputable.** The formula `utilityScore = successRate × avgGpa` requires `avgGpa`. The `SkillCounter` type stores `uses`, `successes`, `failures`, and `utilityScore` but no `avgGpa` or the components needed for a running average. Storing only `utilityScore` makes it impossible to update correctly when a new session completes — you need the old average and count. Add `gpaSum: number` + `gpaCount: number` to `SkillCounter`, compute `avgGpa = gpaSum / gpaCount` on read, and compute `utilityScore = (successes / uses) * (gpaSum / gpaCount)` on update.

- **[FIX] JSONL re-analysis has a type mismatch.** `runPostExecutionAnalysis` takes `SessionAnalytics` as its input. EC-04 says for JSONL sessions with no live events, analysis "reads metadata from the session note directly" using fields like `error_rate`, `tool_calls`, `friction_count`. Brain note metadata is not `SessionAnalytics` — they are structurally different. There must be a conversion function `sessionNoteMetaToAnalytics(noteMeta): Partial<SessionAnalytics>` in the design. Without it, the `--all` path cannot type-check and EC-04 has no implementation path.

- **[FIX] AC-02 PR URL parsing is unspecified.** The design correctly scopes CB-02 to `aggregate.ts` only. But AC-02 expects `{ number: 42, repo: 'foo/bar', url: '...' }` from a raw `data.pr_url` string. The parsing logic is not in the design. Add a `parsePrUrl(url: string): PrLink | null` helper and specify its format: handles `https://github.com/<owner>/<repo>/pull/<number>` only; returns null for any other shape.

- **[FIX] "Matched skill template" for LN-02 is undefined.** LN-02 requires a suggestion for the "matched skill template" when Action < 6. The design never specifies how skill name → template file matching works. The research brief identified this as knowledge gap #2; the design does not resolve it. Two viable options: (a) attach the suggestion to the session analysis note as a sub-section rather than a separate note (avoids the matching problem entirely), or (b) define the convention: skill name maps to `src/modules/workflow/templates/<skill-name>.md` by filename stem. Choose one explicitly.

- **[ACCEPTED] Three-stage pipeline ordering (Capture → Analyze → Learn).** The dependency chain is correct: capture data must exist before GPA can be computed, and GPA must be computed before skill counters can be updated. The wave decomposition respects this ordering.

- **[ACCEPTED] Priority 25 placement after sessions:commit.** `agents:agent-done (10) → sessions:end (15) → sessions:commit (20) → sessions:analysis (25)` ensures GPA scoring sees fully committed session data. Correct.

- **[ACCEPTED] PR link events already stored.** Research confirms `pr:created` events are already written by the post-tool handler. CB-02 is correctly scoped to `aggregate.ts` only — no capture handler change needed.

- **[ACCEPTED] `planPresent` from `TodoWrite` detection.** `TodoWrite` is the only structured planning action Claude Code exposes, making it a reliable proxy for planning behavior. Emitting `plan_present` on `TodoWrite` detection is correct.

---

### Error Handling

- **[FIX] NF-03 concurrent write mechanism has no implementation basis.** The spec says "read-modify-write with optimistic retry (max 3 attempts) if the note was modified since last read." Brain notes are markdown files. Markdown files have no ETag, version field, or atomic compare-and-swap built in. "Modified since last read" cannot be evaluated without versioning. The design must specify the mechanism. Recommended approach: add a `version: integer` field to skill counter note frontmatter; increment on each write; before writing, verify the in-memory version matches the on-disk version; retry up to 3 times on mismatch. If 3 retries fail, log a warning and skip the update (do not throw).

- **[FIX] Ollama timeout not specified in the design.** The research brief recommends 30s; this does not appear in `design.md`. Without an explicit timeout, a hung Ollama will block the async analysis indefinitely — consuming memory and process slots after the hook chain completed. Add to the design: "LLM calls are wrapped with `AbortSignal.timeout(30_000)`. On timeout, Goal and Plan default to null; emit `console.warn` with session ID and elapsed time."

- **[ACCEPTED] Fire-and-forget async for hook handler (NF-01).** The analysis handler returns `hookAllow()` immediately and dispatches analysis via `setImmediate`/detached async. This is correct for the < 50ms hook return requirement.

- **[ACCEPTED] Null LLM dims do not block note write.** If Goal/Plan are null, `gpa` falls back to `dimensions.action` alone. Analysis note is still written with partial scores. Correct degraded-mode behavior.

- **[ACCEPTED] Analysis errors swallowed with `console.warn`.** Silent failure is acceptable here because the session record (written at priority 20) is already committed before analysis runs. The hook chain must not be disrupted by analysis failures.

---

### API Design

- **[FIX] Event naming convention is inconsistent across artifacts.** The design and spec use colon-separated (`pr:created`) and underscore-separated (`task_ref`, `plan_present`, `skill_use`) event type names in the same documents. The existing codebase uses underscores exclusively (`tool_call`, `user_turn`, `hook_prevention`, `hook`). All new event types must use underscores: `task_ref`, `pr_created`, `file_touch`, `skill_use`, `plan_present`. Update all references to `pr:created` (colon form) in the aggregate switch statement spec to `pr_created`.

- **[FIX] AC-04 `skill_use` event `count` semantics are ambiguous.** AC-04 says the event has `data.count: 2`, implying per-session aggregation in the handler. But if `session-post-tool-handler` emits one event per `Skill` invocation (the natural approach matching all other event types), `count` would always be 1 per event. AC-10 documents this ambiguity explicitly: "incremented by 3 (or 1 per invocation, per implementation)." Resolve: **emit one event per invocation with `count: 1`** and aggregate in `aggregate.ts`. This is simpler, more consistent with other event types, and easier to test.

- **[FIX] `scoreGpa` is over-coupled to `SessionAnalytics`.** The function takes the full `SessionAnalytics` type but uses only ~6 fields. This creates brittle coupling: any rename in `SessionAnalytics` breaks `gpa-scorer.ts`. Define a narrow input interface `GpaScoringInput` with only the required fields (`errorRate`, `frictionSignals`, `toolCalls`, `taskRefs`, `planPresent`, `outcome`, `assistantTexts`). `scoreGpa` accepts `GpaScoringInput`; the caller in `post-execution-analyzer.ts` maps `SessionAnalytics → GpaScoringInput`. This also makes EC-04's conversion path easier.

- **[ACCEPTED] `analysisNoteSlug | null` return shape.** Returning null on failure rather than throwing is correct. Callers (especially the hook handler) can proceed without the note slug.

- **[ACCEPTED] `--force` flag for re-analysis.** EC-03 specifies "without --force, skip; with --force, overwrite." Correct UX for idempotent re-analysis.

- **[ACCEPTED] `listSkillCounters` sorted by utility descending.** AC-13 implicitly requires this ordering. The API shape supports it.

---

### Chain of Verification

| Question | Independent Answer | Design Says | Match? |
|----------|-------------------|-------------|--------|
| Q1: Where should BRAIN_PM_TASK be read — start handler or capture handler? | `session-start-handler.ts` fires once per session; capture fires per tool call. Env vars set at startup. Start handler is correct. | Modify `session-capture-handler.ts` | **No** — `session-start-handler.ts` exists and is the right location |
| Q2: What is `frictionDensity`? | Derived ratio: `frictionSignals.length / max(toolCalls.length, 1)` | Not defined anywhere in spec or design | **No** — term used without definition |
| Q3: How does concurrent write protection for skill counter notes work? | Brain notes are markdown files; no atomic CAS. Need a `version` field in frontmatter. | "optimistic retry" named but mechanism unspecified | **No** — mechanism not specified |
| Q4: For JSONL re-analysis, how does `runPostExecutionAnalysis` get `SessionAnalytics`? | Session note metadata ≠ `SessionAnalytics`. Need conversion function or alternate code path. | "reads the final session note metadata" but function signature takes `SessionAnalytics` | **No** — type mismatch; conversion function missing |
| Q5: Where does `avgGpa` come from for utility score? | Must track `gpaSum + gpaCount` to support incremental updates. | `utilityScore = successRate × avgGpa` but no `avgGpa` in `SkillCounter` | **No** — type missing required fields |
| Q6: What does `computeActionScore` return for empty toolCalls? | The formula yields 10.0; EC-01 requires 5.0. Conflict — special case needed. | Formula gives 10.0; EC-01 says 5.0 | **No** — these contradict each other |
| Q7: Should `scoreGpa` take full `SessionAnalytics` or a narrower type? | Narrow input per single-responsibility. Easier to test, less coupling. | Takes full `SessionAnalytics` | **No** — over-coupled; `GpaScoringInput` needed |

---

### Cross-Cutting

- **[FIX] AC-08 requires a live Ollama instance — will fail in CI.** AC-08 is listed in `gpa-scorer.test.ts` (a unit test file) but requires Ollama to be running. Either: (a) mock the Ollama `generate()` call with `vi.mock('../../../../services/ollama.js')` and cover AC-08 as a unit test with a fixture LLM response, or (b) tag it `@integration` and exclude from `npm test`. The design must specify which. Recommend (a): mock Ollama in unit tests, add an integration test suite for live Ollama separately.

- **[FIX] EC-04 (JSONL session with no live events) has no listed test.** This is a distinct code path (session note metadata → analysis) with no test coverage in the listed test files. Add a test case in `post-execution-analyzer.test.ts`: fixture with zero `session_events`, session note with `error_rate` and `tool_calls` fields, assert analysis note is written and GPA is computed from note fields.

- **[ACCEPTED] Wave 1 is independently testable.** Capture fixes are additive changes to existing functions. Existing tests pass; new event type tests can be written in isolation. Wave 2 dependencies are satisfied by Wave 1 output alone.

- **[ACCEPTED] No file ownership conflicts across waves.** Wave 1 modifies 3 existing files. Wave 2 and 3 create new files or modify `index.ts` files. No concurrent-modification risks.

- **[ACCEPTED] Option B PR split.** Capture fixes are low-risk and immediately valuable. LLM integration requires separate review. Three PRs reduce risk and allow incremental validation.

---

## Open Questions

1. **`BRAIN_PM_TASK` absent in non-PM sessions**: Should `scoreGpa` with `taskDescription: null` compute Goal as null (no LLM call) or attempt scoring from session summary alone? EC-07 covers Ollama unavailability but not missing task description. Needs spec clarification.

2. **Skill counter update granularity**: If a session used `commit` skill 3 times and succeeded, does `successes` increment by 1 (session-level) or 3 (invocation-level)? AC-10 is ambiguous ("by 3 (or 1 per invocation, per implementation)"). Recommend session-level (1 increment per skill per session) for accuracy of the success rate metric as a session quality signal.

3. **Evolution suggestion attachment**: Until LN-02 "matched skill template" matching is resolved (FIX #7), should suggestions be a sub-section in the session analysis note rather than a separate `type: suggestion` note? This eliminates the undefined matching problem while preserving the content.

---

## FIX Summary

**Total: 10 FIX items**

1. `session-start-handler.ts` — CB-01 must emit `task_ref` here, not in `session-capture-handler.ts`
2. `gpa-scorer.ts` — Add `if (toolCalls.length === 0) return 5.0` special case (EC-01 vs formula conflict)
3. `design.md` / `gpa-scorer.ts` — Define `frictionDensity = frictionSignals.length / max(toolCalls.length, 1)`
4. `skill-counters.ts` — Add `gpaSum: number` + `gpaCount: number` to `SkillCounter` type
5. `post-execution-analyzer.ts` — Add `sessionNoteMetaToAnalytics()` conversion for JSONL re-analysis (EC-04)
6. `aggregate.ts` — Add `parsePrUrl()` helper spec for AC-02 PR link parsing
7. `design.md` / `spec.md` — Resolve LN-02 "matched skill template" matching mechanism
8. `skill-counters.ts` / `design.md` — Specify `version` field frontmatter for NF-03 optimistic locking
9. `design.md` — Add 30s `AbortSignal.timeout` to analysis handler specification
10. All new files + `aggregate.ts` — Standardize all new event type names to underscores; replace `pr:created` with `pr_created`
