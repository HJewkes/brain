# Spec: Post-Execution Analysis Pipeline

## Problem

Brain captures session events via live hooks and JSONL import but performs no post-execution analysis. Five known capture gaps cause hook-captured sessions to have empty `taskRefs`, `prLinks`, `filesTouched`, `filesWritten`, and `skillUsage` fields. Without a structured analysis pipeline, there is no quality scoring (Goal/Plan/Action rubric), no skill/template effectiveness data, no searchable session notes for bootstrapping future agents, and no feedback loop for template evolution.

## Requirements

1. **CB-01 — Capture: taskRefs from live events.** The `session-capture-handler` must extract task references from `BRAIN_PM_TASK` env and `brain pm task claim` events. `aggregate.ts` must populate `taskRefs` for hook-captured sessions.

2. **CB-02 — Capture: prLinks from session events.** `aggregate.ts` must read `pr:created` events (already stored by `session-post-tool-handler`) and populate `prLinks` in `SessionAnalytics`.

3. **CB-03 — Capture: filesTouched and filesWritten from live events.** `session-post-tool-handler` must capture `Write`/`Edit` tool calls with their file paths. `aggregate.ts` must populate `filesTouched` and `filesWritten`.

4. **CB-04 — Capture: skillUsage from live events.** `session-post-tool-handler` must capture `Skill` invocations. `aggregate.ts` must populate `skillUsage`.

5. **CB-05 — Capture: planPresent from live events.** `session-capture-handler` must emit a `plan_present` event when `TodoWrite` is detected. `aggregate.ts` must populate `planPresent`.

6. **AN-01 — Analyze: Agent GPA scoring.** Given a completed session's `SessionAnalytics`, compute three dimension scores (Goal, Plan, Action) and a total GPA (0–10). Goal and Plan are LLM-scored; Action is algorithmic.

7. **AN-02 — Analyze: Skill/template effectiveness.** For each skill name in `skillUsage`, record whether the session succeeded. Compute a per-skill success rate across sessions.

8. **AN-03 — Analyze: Session analysis note.** After scoring, write a brain note of type `analysis` containing: session ID, GPA scores, outcome, top friction signals, and key task refs. This note must be FTS-indexed and searchable.

9. **LN-01 — Learn: Skill counters.** Maintain persistent counters (`uses`, `successes`, `failures`) per skill name. Update after each analysis run.

10. **LN-02 — Learn: Template evolution suggestions.** When Action < 6 and frictionSignals.length > 3, generate a one-paragraph LLM suggestion for the matched skill template. Store as a brain note of type `suggestion`.

11. **LN-03 — Learn: Utility scoring.** Compute a utility score per skill = `successRate × avgGpa`. Expose via CLI `brain session skill-stats`.

12. **PI-01 — Pipeline integration.** The pipeline runs automatically after `agent-done` hook completes (priority 25, after sessions:commit at 20). It also runs via `brain session analyze <session-id>` for manual/historical re-analysis.

13. **PI-02 — Historical JSONL support.** `brain session analyze --all` re-analyzes all sessions with a JSONL path, regardless of capture method.

## Constraints

- LLM calls use existing Ollama integration (`ollama.ts`). If Ollama is unavailable, Goal and Plan default to `null`; Action is always computed algorithmically.
- No new database tables. Skill counters and analysis notes use existing brain notes with `module: 'sessions'` and appropriate frontmatter.
- The pipeline must not throw or block the hook chain. All analysis errors are swallowed with `console.warn`.
- Analysis notes use `visibility: 'private'` so they don't pollute the user's knowledge base.
- The `aggregate.ts` capture fixes must not break existing tests. All changes are additive to the returned `SessionAnalytics` shape.

## Out of Scope

- Real-time GPA display in the dashboard during a live session.
- Multi-session GPA aggregation or trend charts (future wave).
- Cross-session skill leaderboard UI in the dashboard (future wave).
- Automatic template file modification based on suggestions.

## Dependencies

- Existing Ollama integration (`src/services/ollama.ts`)
- Existing brain note system (`src/services/brain-service.ts`, `brain add`)
- Existing session analytics accumulator (`src/modules/sessions/engine/accumulator.ts`)
- Existing hook infrastructure (`src/hooks/registry.ts`)
- PM task reference format (`BRAIN_PM_TASK` env var, `VNM-WS.TT` pattern)
