Now I have enough to write the full analysis:

---

## Setup Agent Session Audit: VW Onboarding

### Summary

The session ran the `pm-onboard` skill against `~/Documents/projects/voltras-workspace`, a multi-repo fitness device workspace. **28 total tool calls** were made. The first productive brain PM command — `brain pm onboard` succeeding — came at **call #15**, after 14 calls spent on exploration and error recovery.

**Final output**: 5 workstreams, 47 tasks, all pending.

---

### Tool Call Distribution

| Category | Count | Percentage |
|---|---|---|
| Non-brain Bash (ls, cat, find) | 10 | 36% |
| Agent spawns (subagents) | 5 | 18% |
| TodoWrite | 5 | 18% |
| Brain CLI | 5 calls / 7 commands | 18% |
| Skill invocation | 1 | 4% |
| Other | 2 | 7% |

---

### Brain CLI Command Frequency

| Command | Invocations | Succeeded | Notes |
|---|---|---|---|
| `brain pm onboard` | 3 | 1 | 2 failures before success |
| `brain pm onboard --help` | 1 | 1 | Triggered by first failure |
| `brain pm briefing` | 2 | 1 | `--full` flag rejected on first try |
| `brain pm workstream list` | 1 | 1 | Verification call |
| `brain index` | 1 | 1 | Run as a side-effect before briefing |

**Brain CLI success rate: 57%** (4 of 7 command invocations succeeded on first try).

---

### Error Log

| # | Call | Command | Error | Recovery |
|---|---|---|---|---|
| 1 | #12 | `brain pm onboard ... --path ~/...` | `unknown option '--path'` (Did you mean `--db-path`?) | Ran `--help` to discover valid options |
| 2 | #14 | `brain pm onboard --prefix V` | `prefix must be 2-5 uppercase alphanumeric chars` (single char rejected) | Switched to `--prefix VW` |
| 3 | #25 | `brain pm briefing --full` | `unknown option '--full'` | Reran without the flag |
| 4 | #10 | `ls workout-analytics/docs/` | Directory does not exist (exit 2) | Continued anyway, no recovery needed |

All errors were self-corrected within 1–2 follow-up calls. The `--help` lookup was effective for option discovery.

---

### Discovery Patterns

The agent followed a **broad workspace scan → CLI invocation → help fallback** pattern:

1. **Calls 1–10**: Pure workspace exploration — `ls` and `cat` across all 5 sub-repos and docs. No brain CLI calls yet.
2. **Call 12**: First brain CLI attempt, immediately hit `--path` (nonexistent option). Suggests the agent inferred the flag from reading `brain-service.ts` or similar source — it guessed wrong.
3. **Call 13**: `--help` call to discover valid options. Effective, but indicates the agent lacked prior knowledge of the CLI surface.
4. **Calls 14–15**: Two more `onboard` attempts to get the prefix right. Single-char prefix not obvious from help text.
5. **Calls 16–23**: Agent-based component analysis + synthesis — the heavy work.
6. **Calls 25–27**: Verification pass. `--full` on briefing was a speculative flag that didn't exist.

**Calls before first productive brain PM command: 14**
**Brain CLI help calls: 1** (but help was a recovery move, not proactive exploration)

---

### Data Quality

**What was created:**
- 5 workstreams covering: BLE Protocol, Testing Infrastructure, VBT Autoregulation, SDK Release Pipeline, Developer Experience & Docs
- 47 tasks total, all `pending`, all `ELIGIBLE`

**Priority distribution:** 3 critical / 12 high / 20 medium / 12 low — a reasonable spread, not artificially uniform.

**Mode distribution:** 39 auto / 8 interactive — appropriate; hardware-dependent BLE tasks are correctly marked interactive.

**Descriptions:** Not verified from the transcript, but task titles are specific and actionable (e.g. "Fix broken test imports in checksum.test.ts", "Map 0x3a extended telemetry notification structure"). No generic filler titles observed.

**Dependencies:** No evidence dependencies were created — all tasks show `+READY`, meaning no blocking relationships were set up. For a 47-task project this is a gap; some tasks (e.g. fixing test imports before adding CI) have natural ordering.

**Categories:** Not visible from task list output — unclear if the category field was populated.

---

### Efficiency Observations

1. **10 exploration calls before any brain CLI**: The agent read workspace files directly rather than relying on `brain pm onboard` to ingest and surface that context. The onboard flow is supposed to handle doc ingestion, but the agent didn't trust it to do so without first understanding the workspace itself. This is rational but adds overhead.

2. **3 `brain pm onboard` calls to get 1 success**: Two preventable failures:
   - `--path` doesn't exist but `--db-path` does — the error message suggests the option name, which is close enough that a confusable name is risky
   - Single-char prefix rejection could be surfaced earlier (e.g., in the `--help` output or with a better error: "prefix 'V' is too short, use 2–5 chars like 'VW'")

3. **`brain pm briefing --full` attempted**: The agent speculated a `--full` flag. This is a natural expectation (many CLIs have `--full` or `--verbose` modes on summary commands). If the command has no such flag, the help output should note what _is_ available.

4. **TodoWrite called 5 times** for 4 todo items with minor state changes between each. This is internal overhead in the agent's tracking, not a CLI issue.

5. **No dependency creation**: The synthesis agent produced 47 tasks but wired no dependencies. Either the CLI makes dependency creation hard during bulk import, or the synthesis prompt didn't instruct for it.

---

### Recommendations

**1. Improve `onboard` option naming — rename or alias `--db-path`**
The error message `Did you mean --db-path?` when the agent typed `--path` reveals a confusing option name. Either rename to `--path` (more intuitive), add it as an alias, or make the error message show the correct option name prominently in the error output.

**2. Validate prefix length upfront with a better error**
Change `prefix must be 2-5 uppercase alphanumeric chars` to include an example in the error: `"Prefix 'V' is too short — use 2–5 uppercase chars (e.g. 'VW' or 'VLT')"`. This eliminates the trial-and-error prefix loop.

**3. Add `--full` / `--verbose` to `brain pm briefing`** (or document the absence)
The agent expected this flag. Either add it (show task summaries inline with briefing) or note in `--help` that briefing is always the full view and `brain pm task list` is the detail command.

**4. Surface a bulk dependency creation path in `onboard` / synthesis**
The synthesis agent created 47 tasks with no dependency edges. Add a prompt or post-processing step that asks the synthesis agent to identify obvious orderings and wire them. Even 5–8 dependency pairs would make `brain pm next` and wave planning significantly more useful.

**5. Provide a `--dry-run` or summarize-before-commit option for `onboard`**
The agent ran 10 exploration commands before trusting `onboard` to work. A `brain pm onboard --dry-run` that prints what it would ingest/create without committing would let agents (and users) verify intent first, reducing redundant workspace exploration.
