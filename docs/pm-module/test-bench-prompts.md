# PM Module Test Bench — Agent Prompts

**Purpose:** Zero-context agent prompts to vet skill quality, tool ergonomics, and CLI output usefulness. Each prompt is given to a fresh sub-agent with only skills documentation available — no prior conversation context.

**How to use:**
1. Spawn a fresh agent with the prompt (read-only, no edits)
2. Review session log after completion
3. Record: Did it use the brain skill? What CLI commands did it run? Did it get a useful answer? What extra research was needed?

**After fixes:** Re-run the same prompts to measure improvement. Input/output pairs become regression tests for the onboarding experience.

---

## Category 1: Project Discovery

These test whether an agent can find and understand the PM project from scratch.

### P-01: "What projects am I tracking?"
- **Tests:** Basic PM awareness, skill discovery, `brain pm list` or `brain pm status`
- **Expected ideal:** Agent uses brain skill, runs project list command, returns project name + prefix + status + workstream count
- **Known gaps hit:** O-10 (agent may try `brain list`), O-05 (output shows prefix twice, no name), O-17 (if it lists tasks, no names shown)

### P-02: "Give me an overview of the Voltras project — what's being tracked, how is it organized, and what's the current state?"
- **Tests:** Full project comprehension from CLI output alone
- **Expected ideal:** Agent assembles: project metadata, workstream list with descriptions, task counts per workstream, priority distribution, wave status
- **Known gaps hit:** O-17 (task list has no names), O-18 (briefing dumps all IDs), O-19 (no built-in summary command), O-16 (waves are meaningless with 0 deps)

### P-03: "I just joined this project. What's the most important context I need to get started?"
- **Tests:** Whether brain surfaces architecture notes + PM context together
- **Expected ideal:** Agent finds architecture notes via `brain search`, finds PM project via `brain pm`, synthesizes both into an onboarding brief
- **Known gaps hit:** O-25 (architecture notes not linked to PM project — agent must independently discover both), O-07 (lots of tool calls to assemble context)

---

## Category 2: Task Navigation

These test whether an agent can find, filter, and understand tasks.

### P-04: "What are the critical priority tasks across all workstreams?"
- **Tests:** Priority filtering, cross-workstream view
- **Expected ideal:** Agent filters tasks by priority=critical, groups by workstream, shows task titles
- **Known gaps hit:** O-17 (task list may not show titles), O-23 (all tasks are implementation — no variety to distinguish)

### P-05: "What should I work on next in the Mobile App workstream?"
- **Tests:** `brain pm next`, wave computation, task selection
- **Expected ideal:** Agent scopes to VOLT-01, uses `next` or `waves` to find eligible tasks, recommends based on priority
- **Known gaps hit:** O-16 (all tasks in wave 0 — everything is "next"), O-09 (may need `--project` even after `pm use`), O-26 (task notes have no body — agent can't assess what "next" means beyond title)

### P-06: "Show me all the testing-related tasks across the project"
- **Tests:** Category/content-based filtering
- **Expected ideal:** Agent filters by category or searches task titles for "test"
- **Known gaps hit:** O-23 (all tasks are category=implementation, even test tasks — filtering by category returns everything or nothing useful)

### P-07: "What tasks are blocked and what's blocking them?"
- **Tests:** Dependency awareness, `brain pm waves` or dep queries
- **Expected ideal:** Agent checks dependencies, identifies blocked tasks, traces blocking chains
- **Known gaps hit:** O-16 (zero dependencies — answer is "nothing is blocked" which is technically correct but useless)

---

## Category 3: Context Assembly

These test whether an agent can build rich context for a specific task or area.

### P-08: "Brief me on task VOLT-01.01 — what needs to happen, what's the context, and what files are involved?"
- **Tests:** `brain pm task show`, `brain pm context`, related note discovery
- **Expected ideal:** Agent gets task details, finds related architecture notes, assembles a briefing with files/approach
- **Known gaps hit:** O-26 (task body is empty — just a title), O-25 (no relations to architecture notes), O-24 (mode=auto gives no routing hints)

### P-09: "What do we know about the BLE SDK architecture? How does it relate to the mobile app?"
- **Tests:** `brain search` for architecture notes, cross-note synthesis
- **Expected ideal:** Agent finds SDK architecture note + mobile app architecture note, identifies the dependency relationship
- **Known gaps hit:** O-25 (notes aren't linked to each other or to PM project), O-33 (cross-repo coordination context wasn't captured)

### P-10: "What's the dependency chain between the repos in this project?"
- **Tests:** Whether brain captured inter-repo relationships
- **Expected ideal:** Agent traces: voltra-private → node-sdk → mobile, workout-analytics → mobile, titan-design → mobile
- **Known gaps hit:** O-33 (workspace CLAUDE.md with this info wasn't ingested), O-16 (no task-level dependencies to infer from), O-25 (no relations between architecture notes)

---

## Category 4: Planning & Prioritization

These test higher-order reasoning about project state.

### P-11: "We want to ship an Android MVP to internal testers. What tasks are relevant and in what order should we do them?"
- **Tests:** Goal-directed task filtering, sequencing, cross-workstream coordination
- **Expected ideal:** Agent identifies EAS build task (VOLT-01.01), SDK tasks that mobile depends on, design system publish, and proposes an execution order
- **Known gaps hit:** O-16 (no deps to derive order), O-31 (no feature tasks — only tech debt), O-26 (no task body to assess relevance to "Android MVP")

### P-12: "What's the testing coverage situation across all repos?"
- **Tests:** Thematic cross-workstream query
- **Expected ideal:** Agent finds test-related tasks across workstreams, references architecture notes for current coverage stats
- **Known gaps hit:** O-23 (can't filter by category=testing), O-25 (architecture notes with coverage data aren't linked to tasks)

### P-13: "Are there any documentation tasks or areas where docs are out of date?"
- **Tests:** Doc health awareness
- **Expected ideal:** Agent finds documentation tasks, checks for stale notes
- **Known gaps hit:** O-23 (no category=documentation tasks exist), O-34 (no drift detection was performed), O-28 (docs weren't even ingested to check staleness against)

---

## Category 5: System Capabilities

These test whether the agent understands what brain PM can do.

### P-14: "How do I add a new task to the Mobile App workstream?"
- **Tests:** Skill/help discovery for write operations
- **Expected ideal:** Agent explains the `brain pm task add` command with correct syntax
- **Known gaps hit:** O-09 (if it says `--project` is optional after `pm use`, that's wrong), O-20 (agent may surface CLI commands rather than explaining it would do it for the user)

### P-15: "Can you show me the project waves and explain what they mean?"
- **Tests:** `brain pm waves`, understanding of wave computation
- **Expected ideal:** Agent runs waves command, explains wave = dependency-based execution tier
- **Known gaps hit:** O-16 (single wave with all 67 tasks — explanation will be "everything is in wave 0 because there are no dependencies")

### P-16: "What would a typical workflow look like for picking up and completing a task?"
- **Tests:** End-to-end workflow comprehension from skills/docs
- **Expected ideal:** Agent describes: `pm next` → claim → read context → implement → verify → `pm complete`
- **Known gaps hit:** O-06 (no Claude-assisted workflow exists), O-20 (may describe CLI-first rather than Claude-first workflow)

---

## Category 6: Known Gap Exercisers

These are designed to directly hit documented issues to measure their impact.

### P-17: "List all tasks in the project with their names and priorities"
- **Tests:** Directly exercises O-17 (task list output)
- **Expected ideal:** A readable table of task IDs, names, priorities, and statuses
- **Known gaps hit:** O-17 (no names in list output — agent will need `task show` per task or find a workaround)

### P-18: "What workstreams does the VOLT project have?"
- **Tests:** Directly exercises O-09 (pm use + project flag). Does the agent discover `pm use` and try it, or always pass `--project` explicitly?
- **Expected ideal:** Agent sets active project with `pm use`, then runs `workstream list` without `--project`
- **Known gaps hit:** O-09 (command will fail without `--project` flag despite `pm use`)

### P-19: "Show me how the architecture notes relate to the PM tasks"
- **Tests:** Directly exercises O-25 (orphaned notes)
- **Expected ideal:** Agent traces relations between architecture notes and relevant tasks
- **Known gaps hit:** O-25 (zero relations exist — agent will find no connections)

### P-20: "What feature work is planned for the next quarter?"
- **Tests:** Directly exercises O-31 (no feature tasks)
- **Expected ideal:** Agent finds roadmap-derived feature tasks
- **Known gaps hit:** O-31 (zero feature tasks — only tech debt), O-28 (roadmap wasn't ingested)

---

## Category 7: Write Operations & Lifecycle

These test whether an agent can perform mutations — claiming, updating, and completing tasks.

### P-21: "Claim task VLT-01.01 and start working on it"
- **Tests:** `brain pm task claim` or `task update --status`, state machine transitions
- **Expected ideal:** Agent claims the task, transitions to `in_progress`, confirms the state change
- **Known gaps hit:** O-52 (verify may crash post-claim), O-50 (context won't help with implementation briefing)

### P-22: "Add a new high-priority task to the SDK workstream for fixing the BLE reconnection timeout"
- **Tests:** `brain pm task add` with all flags, workstream scoping
- **Expected ideal:** Agent runs `task add` with `--priority critical --category bug`, confirms creation with title and ID
- **Known gaps hit:** O-44 (can't add dependencies after creation), O-43 (agent may invent a category)

### P-23: "Mark VLT-02.03 as complete and tell me what I should pick up next"
- **Tests:** Task completion + `brain pm next` workflow
- **Expected ideal:** Agent transitions task to `completed`, runs `next` on the same workstream, recommends next task with context
- **Known gaps hit:** O-16 (all tasks in wave 0 — `next` returns everything), O-54 (next output lacks task descriptions)

---

## Category 8: Agent-Facing Commands

These test the commands designed for agent consumption — context, dispatch, verify.

### P-24: "Use brain pm context to get all relevant information about task VLT-01.05"
- **Tests:** Directly exercises O-50 (`pm context` quality)
- **Expected ideal:** Returns task metadata + body text + related search results + linked decisions + dependency info
- **Known gaps hit:** O-50 (returns hash, not actionable content), O-54 (show also sparse)

### P-25: "Generate an agent dispatch prompt for implementing task VLT-03.02"
- **Tests:** Directly exercises O-51 (`pm dispatch` quality)
- **Expected ideal:** Self-contained agent prompt with: objective, architecture context, files to modify, validation steps
- **Known gaps hit:** O-51 (minimal output), O-50 (context it depends on is also broken)

---

## Category 9: Cross-System Queries

These test whether PM data and knowledge base data work together.

### P-26: "Find all architecture notes that are relevant to the Mobile App workstream tasks"
- **Tests:** PM-to-search bridge — using task titles to search knowledge notes
- **Expected ideal:** Agent gets task list for workstream, uses task titles/descriptions as search queries, maps results to tasks
- **Known gaps hit:** O-49 (PM notes unsearchable), O-25 (no relations), O-56 (graph shows no edges)

### P-27: "What knowledge base notes don't have any corresponding PM tasks yet?"
- **Tests:** Coverage gap detection — comparing knowledge base to PM backlog
- **Expected ideal:** Agent lists notes, lists tasks, identifies notes that represent work areas with no PM tracking
- **Known gaps hit:** O-25 (no relations to check), O-49 (can't search PM from knowledge side)

---

## Category 10: Filtering & Retrieval Depth

These test whether agents can efficiently filter and get detailed data.

### P-28: "Show me all critical tasks that are still pending, grouped by workstream"
- **Tests:** Multi-dimension filtering (priority + status) with grouping
- **Expected ideal:** Agent filters by priority=critical AND status=pending, groups output by workstream
- **Known gaps hit:** O-55 (no native filter flags — must pipe through python), O-54 (no descriptions in output)

### P-29: "Give me the full details of the 3 highest priority tasks including any related notes"
- **Tests:** Depth retrieval — `show` + search for related content
- **Expected ideal:** Agent gets top 3 by priority, runs `task show` with full details, searches for related architecture notes
- **Known gaps hit:** O-54 (show is one line), O-53 (search loops to compensate), O-50 (context doesn't help)

### P-30: "Search for everything related to 'analytics' across both notes and tasks"
- **Tests:** Unified search across PM and knowledge base
- **Expected ideal:** Agent runs `brain search "analytics"` and `brain pm task list --json` filtered for analytics, merges results
- **Known gaps hit:** O-49 (PM notes not indexed — search only finds knowledge notes), O-55 (no text search flag on task list)

---

## Execution Log Template

For each prompt, record:

```markdown
### P-XX Result
- **Skill used:** yes/no — which skill?
- **Commands run:** list of brain CLI commands attempted
- **Commands failed:** any errors, with error text
- **Extra research needed:** tool calls beyond brain CLI (file reads, searches, etc.)
- **Answer quality:** 1-5 (1=useless, 5=comprehensive and accurate)
- **Known gaps confirmed:** which O-XX observations were hit?
- **New observations:** anything unexpected?
- **Time/tokens:** rough cost of getting the answer
```

## Expected Outcomes

After running all 30 prompts, we should have:
1. **Skill coverage map** — which prompts triggered the brain skill vs required manual CLI exploration
2. **CLI ergonomics report** — which commands worked well, which gave unhelpful output
3. **Gap severity ranking** — which observations cause the most real-world pain
4. **Baseline metrics** — answer quality scores to compare against after fixes
5. **Missing capabilities list** — queries that brain fundamentally can't answer today
