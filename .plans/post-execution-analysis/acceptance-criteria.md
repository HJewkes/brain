# Acceptance Criteria: Post-Execution Analysis Pipeline

## Criteria

### AC-01: taskRefs populated for hook-captured sessions
**Given:** An agent session is running with `BRAIN_PM_TASK=VNM-34.86` in the environment
**When:** The session-start-handler fires once at session start
**Then:** A `task_ref` event is stored in `session_events` with `event_type: 'task_ref'` and `data.taskId: 'VNM-34.86'`; `aggregateSessionEvents()` returns `taskRefs: ['VNM-34.86']`

### AC-02: prLinks populated from stored pr_created events
**Given:** A session has a `pr_created` event in `session_events` with `data.pr_url: 'https://github.com/foo/bar/pull/42'`
**When:** `aggregateSessionEvents()` is called for that session
**Then:** The returned `SessionAnalytics` has `prLinks: [{ number: 42, repo: 'foo/bar', url: 'https://github.com/foo/bar/pull/42' }]`

### AC-03: filesWritten populated from Write tool events
**Given:** A session has a `tool_call` event with `data.toolName: 'Write'` and `data.filePath: 'src/foo.ts'`
**When:** `aggregateSessionEvents()` is called for that session
**Then:** The returned `SessionAnalytics` has `filesWritten: ['src/foo.ts']` and `filesTouched.get('src/foo.ts')` contains `'Write'`

### AC-04: skillUsage populated from Skill tool events
**Given:** A session has two `skill_use` events with `data.skillName: 'commit'` and `data.count: 1` each (one per invocation)
**When:** `aggregateSessionEvents()` is called for that session
**Then:** The returned `SessionAnalytics` has `skillUsage.get('commit') === 2` (aggregated from per-invocation events)

### AC-05: planPresent set when TodoWrite detected
**Given:** A session has a `plan_present` event captured when the agent used TodoWrite
**When:** `aggregateSessionEvents()` is called for that session
**Then:** The returned `SessionAnalytics` has `planPresent: true`

### AC-06: Action GPA score computed without LLM
**Given:** A `SessionAnalytics` with `errorRate: 0.1` and `frictionSignals.length: 2` and `toolCalls.length: 20`
**When:** `computeActionScore(analytics)` is called
**Then:** The returned score is a number in [0, 10]; a session with `errorRate: 0.0` and no friction scores higher than a session with `errorRate: 0.5`

### AC-07: GPA score returns null Goal/Plan when Ollama unavailable
**Given:** Ollama is not reachable (health check fails)
**When:** `scoreGpa(analytics, taskDescription)` is called
**Then:** Returns `AgentGpaScore` with `dimensions.goal: null`, `dimensions.plan: null`, `dimensions.action: <number>`, and `gpa: dimensions.action` (fallback to Action-only mean)

### AC-08: GPA score returns valid scores when Ollama available
**Given:** Ollama is running with the configured model (mocked in unit tests via `vi.mock('../../../../services/ollama.js')` with fixture LLM response)
**And:** A `GpaScoringInput` with non-empty `taskRefs`, `assistantTexts`, and `frictionSignals`
**When:** `scoreGpa(input, sessionId, 'Implement feature X')` is called
**Then:** Returns `AgentGpaScore` with `dimensions.goal` in [0, 10], `dimensions.plan` in [0, 10], `dimensions.action` in [0, 10], and `gpa` in [0, 10]

### AC-09: Analysis note written to brain after hook
**Given:** A session completes with `exit_code: 0` and `BRAIN_PM_SESSION` set
**When:** The `sessions:analysis` hook fires at priority 25
**Then:** A brain note exists with `module: sessions`, `type: analysis`, frontmatter containing `session_id`, `gpa`, and `outcome`; the note is FTS-indexed and returned by `brain search "session analysis"`

### AC-10: Skill counters incremented after success
**Given:** A session with `skillUsage.get('commit') === 3` completes with outcome `success` and GPA 7.5
**When:** `runPostExecutionAnalysis()` completes
**Then:** The `commit` skill counter note has `uses` incremented by 1 (session-level, not per-invocation), `successes` incremented by 1, `gpaSum` incremented by 7.5, `gpaCount` incremented by 1, `version` incremented by 1, and `utilityScore` recomputed as `(successes/uses) * (gpaSum/gpaCount)`

### AC-11: Evolution suggestion generated for low Action sessions
**Given:** A session with `Action < 6` and `frictionSignals.length > 3`
**And:** Ollama is available
**When:** `runPostExecutionAnalysis()` completes
**Then:** The session analysis note includes an "Evolution Suggestions" sub-section containing a one-paragraph improvement suggestion for the friction pattern observed (appended to the analysis note, not a separate note)

### AC-12: Manual analyze command re-analyzes a session
**Given:** A completed session with ID `abc123` (either live or JSONL-imported)
**When:** `brain session analyze abc123` is run
**Then:** The command exits 0 and prints a summary table including GPA score, dimensions, and analysis note path; an analysis note is created or updated for that session

### AC-13: skill-stats command lists all skill counters
**Given:** Skill counter notes exist for `commit` and `vitest`
**When:** `brain session skill-stats` is run
**Then:** Output table includes one row per skill with columns: skill, uses, successRate (%), avgGpa, utility; rows sorted by utility descending

### AC-14: analyze --all processes all JSONL sessions
**Given:** 5 sessions exist with a `jsonl_path` set
**When:** `brain session analyze --all` is run
**Then:** All 5 sessions have analysis notes written; command prints "Analyzed N sessions" summary

### AC-15: Analysis handler does not block agent-done hook
**Given:** Ollama is slow (simulated 3s response)
**When:** The agent-done hook fires
**Then:** The hook chain completes in < 500ms; analysis runs in the background and its result is not awaited by the hook return

## Edge Cases

### EC-01: Session with zero tool calls
**Given:** A session where only user messages were exchanged, `toolCalls: []`
**When:** `computeActionScore(analytics)` is called
**Then:** Returns 5.0 (neutral score, not 0); `scoreGpa` returns `gpa: null` if LLM dims also null

### EC-02: Duplicate task refs in events
**Given:** A session with two `task_ref` events both with `taskId: 'VNM-34.86'`
**When:** `aggregateSessionEvents()` is called
**Then:** `taskRefs` contains `'VNM-34.86'` exactly once (deduplicated)

### EC-03: Analysis run on already-analyzed session without --force
**Given:** An analysis note already exists for session `abc123`
**When:** `brain session analyze abc123` is run (without `--force`)
**Then:** Command exits 0, prints "Already analyzed — use --force to re-run", and makes no changes

### EC-04: JSONL session with no live events
**Given:** A historical session imported from JSONL with no `session_events` rows
**When:** `runPostExecutionAnalysis()` is called via `--all`
**Then:** Analysis reads metadata from the session note directly; GPA is computed from note fields (`error_rate`, `tool_calls`, `friction_count`); analysis note is written successfully

### EC-05: Ollama LLM returns non-numeric score
**Given:** The LLM response for Goal scoring is malformed (e.g., `"seven out of ten"`)
**When:** `scoreGpa` processes the response
**Then:** `dimensions.goal` falls back to `null`; an error is logged via `console.warn`; Action score is still returned; the overall analysis continues

## Non-Functional

### NF-01: Hook handler latency
The `sessions:analysis` hook handler must return `hookAllow()` in < 50ms regardless of Ollama availability. Analysis work is dispatched asynchronously and must not delay the hook chain.

### NF-02: Analysis note size
Each analysis note must be < 5 KB. Content is capped: top 5 friction signals, top 3 tool names, single-paragraph rationale per dimension.

### NF-03: Skill counter write safety
Concurrent analysis runs for different sessions must not corrupt a shared skill counter note. `updateSkillCounter` must use a read-modify-write with optimistic locking: read `version` from note frontmatter, increment locally, verify on-disk `version` matches before writing. Retry up to 3 times on version mismatch. On 3rd failure, log warning and skip the update (do not throw).
