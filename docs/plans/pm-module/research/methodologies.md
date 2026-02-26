# Project Execution Methodologies: Research for AI-Assisted Orchestration

*Date: 2026-02-25*

This document synthesizes seven productivity and knowledge management methodologies through the lens of building an AI-assisted project orchestration system. Each methodology is analyzed for core principles, adoptable patterns, anti-patterns to avoid, and direct mappings to our system components: **brain** (notes/knowledge), **pm module** (project/task management), and **orchestrator** (AI agent coordination).

---

## 1. GTD — Getting Things Done (David Allen)

### What It Is

GTD is a five-step capture-clarify-organize-reflect-engage loop built on a single thesis: your mind is for having ideas, not holding them. Everything that has your attention must leave your head and enter a trusted external system. From there, decisions about actionability, context, and timing are made explicitly rather than implicitly.

**The five steps:**
1. **Capture** — collect everything into inboxes (email, physical, digital)
2. **Clarify** — process each item: is it actionable? If yes, what's the *next action*? If not, trash, reference, or someday/maybe
3. **Organize** — route clarified items to the right lists (next actions by context, projects, waiting-for, calendar, reference)
4. **Reflect** — weekly review of all lists to maintain currency and completeness
5. **Engage** — choose what to do based on context, time available, energy level, and priority

**Key structural concepts:**

- **Next action**: the very next physical action required to move something forward. Not "plan the API" but "open editor and write endpoint stub for /projects." Specificity collapses activation energy.
- **Contexts**: grouping next actions by the resource or location required — `@computer`, `@phone`, `@waiting`, `@errands`. A context list gives you a pre-filtered set of options for your current situation.
- **Projects list**: anything requiring more than one action step. The project itself is never "done" — only its next action is. The projects list exists solely to trigger the question: "What's the next action on this?"
- **Weekly review**: the critical maintenance ceremony. Go through every inbox, every project, every list. The goal is not to do work but to ensure the system is complete and current. Without this, the system rots.
- **Someday/Maybe**: a parking lot for ideas and intentions that are not yet active projects. Important for preventing inbox bloat while not discarding potentially useful work.

### Core Principles Applicable to AI-Assisted Execution

1. **Explicit actionability gate.** Every item must be classified as actionable or non-actionable before it enters the system. Vague intentions clog a pipeline. AI agents can enforce this: they should only receive inputs that have a clear next physical step.

2. **Next-action granularity.** Projects decompose until a single next action is atomic enough to execute without further clarification. For AI agents, this maps directly to a unit of work that can be dispatched without follow-up questions.

3. **Context-aware task selection.** Not all tasks are available at all times. Context constraints (available tools, environment, dependencies) filter the candidate set. An orchestrator should model this: before selecting a task for an agent, confirm the required context is satisfied.

4. **The weekly review as a system integrity check.** Without periodic review, projects go stale, waiting-fors go untracked, and the someday/maybe list becomes a graveyard. Automated staleness detection is the equivalent for a software system.

5. **Trusted system means zero mental overhead.** If the system is trustworthy, you stop keeping anything in your head. For AI orchestration, this means the system must be authoritative: when you add something, you don't need to also remember it mentally.

### Patterns to Adopt

- **Capture-first inbox.** Everything enters through a single inbox — no immediate organization. The pm module should have a `capture` command that accepts raw natural language and queues it for clarification.
- **Two-minute rule.** If an action takes less than two minutes, do it immediately rather than adding it to a list. For an orchestrator, this suggests a threshold below which tasks should be dispatched inline rather than queued.
- **Next-action extraction on project creation.** Creating a project without a next action is a dead end. The pm module should require a next action before a project is considered "active."
- **Context tagging on tasks.** Tasks should carry context metadata (`@requires:internet`, `@requires:local-env`, `@blocked-by:#123`) so the orchestrator can filter by available context.
- **Weekly review as scheduled maintenance.** Automate staleness prompts: projects not touched in N days surface for review. Waiting-for items past their expected date trigger a nudge.

### Anti-Patterns to Avoid

- **Project as task confusion.** Listing "Refactor auth module" as a task is a trap — it's a project. The system must distinguish items requiring one action from items requiring many. Collapsing this distinction produces undoable tasks.
- **Skipping the weekly review.** Without review, the system becomes untrustworthy, which causes regression to mental load. Even a 10-minute automated scan beats nothing.
- **Over-contextualizing.** Creating 30 context categories defeats filtering. Keep contexts coarse (5–8) and based on real constraints, not aspirational organization.
- **Someday/maybe as a dumping ground.** If nothing ever leaves someday/maybe, it's just a guilt list. It needs periodic review with a genuine question: "Is this relevant to my life now?"
- **Capturing without clarifying.** An inbox full of unprocessed items is not a GTD system. Capture without clarification produces anxiety, not clarity.

### System Mapping

| GTD Concept | System Component |
|---|---|
| Inbox capture | `pm capture <text>` — raw queue, no metadata required |
| Clarify step | AI-assisted processing: is it actionable? What project? What context? |
| Next action | Atomic task unit in pm module with status `next` |
| Projects list | Projects in pm module — each must have an associated next action |
| Context tags | Task metadata: `@context`, `@requires`, `@env` |
| Waiting-for list | Tasks with status `blocked-by` and a responsible party or dependency |
| Weekly review | Scheduled orchestrator job: surface stale projects, pending blockers, unclarified items |
| Someday/maybe | `pm defer <task>` — separate list, surfaces in weekly review |
| Reference | Brain notes — not tasks, not projects, pure information |

---

## 2. Shape Up (Basecamp / Ryan Singer)

### What It Is

Shape Up is Basecamp's internal methodology for shipping software, published openly in 2019. It was built in reaction to the pathologies of Scrum: endless backlogs, no-end-in-sight sprints, and the confusion of estimation. The core insight is that scope is variable, not time. You commit a fixed amount of time (the *appetite*) and then design a solution that fits within it — rather than designing a solution and then estimating how long it will take.

**The three-phase cycle:**

1. **Shape** (done by senior staff, not the build team): Rough out what to build to a level of specificity that leaves room for the team to solve problems but rules out rabbit holes. The output is a *pitch* — a document describing the problem, the appetite, the rough solution, and what's explicitly out of scope.
2. **Bet** (the betting table): Leadership reviews pitches and makes explicit bets on which ones get a cycle. Work that doesn't get bet on doesn't go into a backlog — it's lost unless someone re-pitches it. This is intentional. A backlog is a tax on the future.
3. **Build** (the 6-week cycle): A small team builds the pitched work autonomously. No daily standups, no reassignment from the outside. The team uses hill charts to communicate status.

**Key concepts:**

- **Appetite**: "How much time is this idea worth to us?" not "How long will this take?" An appetite of 2 weeks means you'll design something shippable in 2 weeks, or you'll descend scope until it fits.
- **Fixed time / variable scope**: The cycle ends on schedule. If scope is too large, cut features — don't extend the timeline.
- **Hill chart**: A U-shaped curve representing the lifecycle of a work scope. Left side of the hill = figuring out what to do (unknowns, exploration). Right side = executing what you know. A team reports progress by placing their scopes on the hill, not by percentage completion.
- **Scopes**: Instead of a flat task list, work is organized into scopes — named clusters of related tasks that can be tracked independently. Scopes make it possible to see which parts of the work are on the hill, not just how many tasks remain.
- **Downhill == done**: When all scopes are on the right side (downhill), the unknowns are resolved. You know what you're building and how.
- **Cool-down**: Two weeks between cycles. No planned work. Time for bug fixes, exploration, paying down technical debt, and shaping the next cycle.
- **No backlog**: Killing the backlog is a feature. If a pitch doesn't get bet on during a cycle, it's shelved. If it's truly important, it comes back. This prevents accumulation of stale ideas maintained out of guilt.

### Core Principles Applicable to AI-Assisted Execution

1. **Appetite-first scoping.** Before any work begins, decide how much time it's worth. This applies directly to AI agent sessions: before spinning up an orchestration, decide the time budget. The solution adapts to fit, not the other way around.

2. **Unresolved unknowns are left-side hill.** The hill chart is a forcing function for honesty about phase. "I know what I need to build but haven't built it yet" (right side) is fundamentally different from "I'm still figuring out the problem" (left side). An orchestrator should track this distinction per work unit.

3. **Scopes over task counts.** Tracking 47/60 tasks complete is meaningless if the remaining 13 are the entire hard part. Scopes give semantic structure to progress. An orchestrator should think in scopes (named clusters of intent) rather than raw task queues.

4. **Cool-down is architectural breathing room.** Sustained sprint-to-sprint execution produces fragile systems. Periods of unstructured time allow reflection, refactoring, and genuine exploration. In an AI-assisted workflow, cool-down maps to sessions without a deliverable target — pure exploration or cleanup.

5. **Shaping separates thinking from building.** Pitches are written by people not building them. This creates a forcing function: the shaper must understand the problem well enough to rule out rabbit holes without prescribing implementation. For AI orchestration, this suggests a planning artifact (a shaped spec) should exist before task generation.

### Patterns to Adopt

- **Appetite declaration on project start.** Every project in the pm module should carry an appetite: "This is worth 2 days of effort. Design a solution that fits." This prevents scope creep by design rather than by enforcement.
- **Hill chart state per scope.** When a scope has unknowns unresolved, its state is `exploring`. When the solution is known and execution is underway, its state is `executing`. When complete, `done`. These three states are more informative than task counts.
- **Fixed-time sessions with descoping protocol.** When a session approaches its appetite limit, the orchestrator descopes — drops lower-priority work rather than extending. The output is always shippable.
- **Pitch format for complex features.** A lightweight planning artifact before any multi-day work: problem statement, appetite, proposed rough solution, out-of-scope items. Stored in brain notes, linked from pm project.
- **No backlog graveyard.** Unstarted work that hasn't been touched in a threshold period is archived, not left to rot in a queue. If it matters, it gets re-evaluated.

### Anti-Patterns to Avoid

- **Estimation theater.** Asking "how long will this take?" for complex work is a guess dressed as a plan. Estimation produces false precision. Appetite produces a real constraint.
- **Backlog as commitment.** A backlog item is not a promise. Treating it as one creates debt — psychological and organizational. Items should earn their place each cycle.
- **Progress by task count.** "47 of 60 tasks complete" tells you nothing about what you're walking into. Progress must be measured by resolution of unknowns.
- **Interruption during the cycle.** Shape Up explicitly forbids pulling the team off a cycle for other work. For AI agents, this maps to: don't interrupt an agent mid-task with context switches unless the work is genuinely urgent.
- **Skipping the shaping phase.** Jumping straight from "idea" to "build" without shaping produces rabbit holes, scope creep, and work that doesn't ship. The shaped pitch is not optional overhead — it's the mechanism that makes the cycle reliable.

### System Mapping

| Shape Up Concept | System Component |
|---|---|
| Appetite | Project/session metadata field: `appetite: "3d"` |
| Pitch | Brain note: problem + appetite + rough solution + out-of-scope |
| Betting table | Session planning: which pitches become active work this session |
| Cycle | A bounded work session or sprint with a defined appetite |
| Scopes | Named work clusters within a project, each with hill-chart state |
| Hill chart state | Task/scope metadata: `phase: exploring | executing | done` |
| Cool-down | Scheduled unstructured sessions: exploration, cleanup, reflection |
| No backlog | Archive projects/tasks not touched in N days; require re-pitch to reactivate |

---

## 3. PARA Method (Tiago Forte)

### What It Is

PARA (Projects, Areas, Resources, Archives) is an organizational framework for all digital information, designed by Tiago Forte as part of his "Building a Second Brain" system. The core insight is to organize information by *actionability* rather than by *topic or type*. Traditional folders organize by subject (photos, work, personal). PARA organizes by how you currently relate to information: is it tied to an active goal? An ongoing responsibility? Background material? Or historical?

**The four categories:**

- **Projects**: Work with a defined goal and a deadline. Examples: "Launch v1.0 of CLI tool", "Write methodology research doc." A project is active and has a next action.
- **Areas**: Ongoing responsibilities with no end date. Examples: "Health", "Finances", "Code quality." Areas never complete — they require sustained maintenance. Success is maintaining a standard, not achieving an outcome.
- **Resources**: Reference material relevant to current or future interests. Examples: "Go language notes", "Productivity research", "API design patterns." Resources support projects and areas but aren't tied to any specific one.
- **Archives**: Everything from the other three categories that is no longer active. Completed projects, deprecated areas, outdated resources. Archived rather than deleted — historical context has value.

**Key behaviors:**

- Notes and files flow between categories as their relationship to your current work changes. A resource becomes a project component when you start actively working with it. A project moves to archives when complete.
- The categories are ordered by actionability. Projects are the most action-oriented; archives are the least.
- Every piece of information lives in exactly one place. The organizing question is: "What is this in relation to my current work and goals?"

### Core Principles Applicable to AI-Assisted Execution

1. **Organize by actionability, not topic.** The same piece of information serves different functions in different contexts. A note on database indexing is a resource when you're learning; it becomes project material when you're building. The system should reflect this dynamic relationship.

2. **Projects are always active.** If it's in Projects, there's active work and a next action. If you're not actively working on it, it belongs in Someday/Maybe (GTD), the backlog (Shape Up), or Areas. Keeping inactive work in Projects creates noise.

3. **Areas surface accountability.** Areas represent standing obligations. Having an explicit list of areas makes it easy to notice when you're neglecting a responsibility — health, technical debt, documentation quality. The question "what areas am I responsible for?" should be answerable in seconds.

4. **Archives preserve context without cluttering.** Deleting completed work destroys institutional memory. Archiving it keeps history accessible without polluting current work lists. Decision context, prior approaches, and outcomes all live in archives.

5. **The boundary between resources and projects is the actionability gate.** Pure reference material that doesn't relate to active work is a resource. When it becomes input to something you're building now, it belongs in the project folder or linked from it.

### Patterns to Adopt

- **PARA as the organizing schema for brain notes.** The note system should have four root categories: Projects (active work notes), Areas (ongoing concern notes), Resources (reference material), Archives (completed work history).
- **Project notes as working surfaces.** Each active project in the pm module has a corresponding brain note that is the working surface: scratch space, research, decisions, linked tasks. When the project completes, the note moves to Archives with its context intact.
- **Areas as a maintenance checklist.** The Areas list is reviewed on a cadence (weekly or monthly) to surface neglected responsibilities before they become problems.
- **Resource notes linked to projects.** When a resource note becomes relevant to an active project, a link is created — not a copy. The note stays in Resources; the project references it. This prevents duplication and maintains a single source of truth.
- **Archive as searchable history.** Completed projects in archives should be findable by outcome, date, and technology. This is the institutional memory of a solo developer or small team.

### Anti-Patterns to Avoid

- **Using PARA as a filing system.** PARA is not about perfect categorization — it's about frictionless retrieval in service of current work. Don't spend time perfecting folder structure; spend time capturing and acting.
- **Blurring projects and areas.** "Fitness" is an area (ongoing responsibility). "Run a 5K in under 25 minutes by March" is a project (specific goal, deadline). Conflating them produces lists that neither complete nor improve.
- **Resources as a hoard.** Collecting resources without connecting them to active work is a form of procrastination. Resources are valuable only if they're actually accessed and used.
- **Never archiving.** Keeping everything in active categories creates noise. Completed projects should move to archives promptly. A Projects list with 40 entries, half of which are done, undermines trust in the system.
- **Per-tool PARA implementations.** PARA is most useful when consistent across tools — notes, tasks, files, email. Implementing it only in one app while maintaining separate organizational logic elsewhere creates cognitive overhead.

### System Mapping

| PARA Concept | System Component |
|---|---|
| Projects | Active projects in pm module + corresponding brain note |
| Areas | Standing concerns tracked in brain (not tasks, not projects) — surfaced in weekly review |
| Resources | Brain notes tagged `type:reference` — no associated task, linked from projects when relevant |
| Archives | Completed projects moved to brain archives with full context, linked decision records |
| Actionability gate | pm module status distinguishes `active`, `someday`, `archived` |
| Working surface | Per-project brain note: scratch space, decisions, research, linked tasks |

---

## 4. Kanban + WIP Limits

### What It Is

Kanban originated in Toyota's manufacturing system and was adapted for software development by David J. Anderson in the 2000s. It visualizes work as it flows through stages and imposes Work-In-Progress (WIP) limits — caps on how many items can occupy any given stage simultaneously.

**Core mechanics:**

- **Board**: Columns represent stages of a workflow (e.g., Todo → In Progress → Review → Done). Work items are cards that move left to right.
- **WIP limits**: A maximum number of items allowed in each column. When a column is at its limit, no new work can enter that stage until something exits. This forces finishing over starting.
- **Pull system**: Work is pulled into a stage when capacity exists, rather than pushed by whoever is upstream. You don't add work to "In Progress" because you have ideas — you pull from Todo when "In Progress" has room.
- **Flow metrics**: Kanban optimizes for *throughput* (items completed per unit time) and *cycle time* (time from start to done for a single item). WIP limits directly impact both.

**Theory of Constraints connection:**

WIP limits operationalize Goldratt's Theory of Constraints. Every system has a bottleneck — the stage that limits overall throughput. WIP limits make bottlenecks visible (a column that consistently piles up is the bottleneck) and force work to accumulate upstream rather than pile up invisibly as multi-tasking.

**Why WIP limits work:**

- **Context switching is expensive.** Each active item in progress consumes working memory. WIP limits enforce cognitive limits.
- **Finishing beats starting.** A system with 10 items 90% complete has delivered zero value. A system with 5 items 100% complete has delivered 5.
- **Bottlenecks surface.** When the Review column is perpetually at its WIP limit, you know that's where work is dying. Without WIP limits, the bottleneck is invisible behind busyness.

### Core Principles Applicable to AI-Assisted Execution

1. **WIP limits prevent context-switching tax.** An AI orchestrator managing multiple parallel agents must budget attention. Each active agent thread is a context that must be monitored, error-handled, and synthesized. WIP limits on active orchestrations prevent cognitive and resource overload.

2. **Make work visible.** Before you can limit WIP, you must see it. All in-progress work — including AI agent tasks, blocked items, and background processes — should be visible in a single view. Hidden work is uncapped WIP.

3. **Pull don't push.** New tasks should be dispatched to agents when agents are available, not when tasks are created. A queue that fills faster than it drains produces overload. The orchestrator should have a pull-based dispatch model.

4. **Cycle time over task count.** The useful metric is not "how many tasks have been started" but "how quickly do tasks move from start to done." Long cycle times indicate blocked work or too-large task granularity.

5. **Bottleneck detection.** When a particular type of task (e.g., tasks requiring external API calls) consistently accumulates, that's a bottleneck. The orchestrator should surface these accumulation patterns.

### Patterns to Adopt

- **Per-stage WIP limits in the pm module.** Tasks in states `in-progress` and `review` should have soft caps. When the limit is reached, the system warns before allowing new work to start.
- **Explicit blocked state.** Blocked items (waiting for dependencies, external input, or information) should be in a separate visible state, not silently sitting in "in-progress." This prevents WIP limit inflation from stalled items.
- **Pull-based agent dispatch.** The orchestrator dispatches the next task only when an agent reports completion (or failure). It does not pre-load agents with queues.
- **Cycle time tracking.** Log start time and end time for each task. Surface tasks with abnormally long cycle times as indicators of hidden complexity or blockers.
- **Swimlanes for task types.** Different types of work (feature work, bugs, research) can have separate WIP limits. This prevents one category from monopolizing all capacity.

### Anti-Patterns to Avoid

- **WIP limits as punishment.** WIP limits work only if the team (or orchestrator) accepts them as a systemic tool, not as a constraint on individual behavior. An orchestrator that bypasses WIP limits "just this once" has no WIP limits.
- **Setting limits without data.** WIP limits should emerge from measurement, not from guessing. Start permissive, measure cycle times, tighten until cycle time improves.
- **Counting blocked items in WIP.** An item that can't progress is not the same as an item in progress. Mixing them hides real WIP and produces false readings of capacity.
- **Ignoring the blocked pile.** Blocked items left unchecked are where work goes to die. The system must regularly surface blockers for resolution.
- **Board theater.** A Kanban board with no WIP limits and no flow metrics is just a to-do list with columns. The mechanism is the limit, not the visualization.

### System Mapping

| Kanban Concept | System Component |
|---|---|
| Board columns | Task states in pm module: `todo`, `in-progress`, `blocked`, `review`, `done` |
| WIP limits | Configurable caps on `in-progress` and `review` counts per project |
| Pull dispatch | Orchestrator dispatches next task only on agent completion event |
| Blocked state | Explicit `blocked-by` field in task; surfaced separately from active WIP |
| Cycle time | Task metadata: `started_at`, `completed_at`; anomaly detection on long-running items |
| Bottleneck detection | Orchestrator analytics: which states/task types accumulate? |
| Swimlanes | Task type tags with per-type WIP limits (`feature`, `bug`, `research`) |

---

## 5. Agile / Scrum Ceremonies Adapted for Solo Dev + AI Agents

### What It Is

Scrum structures work into time-boxed iterations (sprints, typically 2 weeks) with four recurring ceremonies: sprint planning, daily standup, sprint review, and sprint retrospective. These ceremonies address coordination and adaptation in teams. For a solo developer working with AI agents, the rationale for most ceremonies changes substantially — but the underlying needs do not.

**The four ceremonies and their purpose:**

1. **Sprint planning**: What will we commit to this sprint? What's the plan for achieving it?
2. **Daily standup**: What did I do yesterday? What am I doing today? What's blocking me?
3. **Sprint review**: What did we actually ship? Demo to stakeholders.
4. **Sprint retrospective**: What went well? What should we improve? What will we do differently?

**What changes for solo dev + AI:**

- Standups with yourself provide minimal value. The benefit of the standup — shared awareness across humans — doesn't apply when you are the entire team and your AI agents don't benefit from the ritual.
- Sprint reviews (demos to stakeholders) may still have value if you're shipping to users, but the format changes.
- **Sprint planning becomes session planning** — a lightweight agreement between you and the orchestrator about what gets done in the session.
- **Retrospectives become decision capture** — the most durable value is not "what should we do differently" but "what did we learn, what decisions did we make, and why."

### Core Principles Applicable to AI-Assisted Execution

1. **Time-boxing forces scope decisions.** The value of a sprint is not the sprint length — it's that a deadline forces prioritization. Without a time box, work expands to fill available time. Session planning should declare scope in advance.

2. **Retrospectives generate institutional memory.** The primary output of a retrospective is not a list of process changes — it's a record of what happened and why. For a solo developer, this record is the decision log (see ADRs, section 7).

3. **Planning is a conversation, not a ritual.** The ceremony format is designed for groups that need to reach shared understanding. For one human + AI, planning is a structured prompt: "Given these goals and this context, here is my proposed plan for the session. Challenge my assumptions."

4. **Velocity is a planning tool, not a performance metric.** Historical throughput informs future planning. An orchestrator that tracks task completion rates can use this to calibrate session scope.

5. **Definition of Done prevents false progress.** Scrum's "Definition of Done" (DoD) is a checklist: what conditions must be true before a task is considered complete? For AI-generated work, this is critical — an agent completing a task is not the same as the task being done to the team's standard.

### Patterns to Adopt

- **Session brief before each work session.** A short structured artifact: goals, constraints, appetite, prior context (what happened last session), open questions. The orchestrator reads this before dispatching any tasks.
- **Definition of Done per task type.** Each category of task has explicit completion criteria. Code tasks: tests pass, linter clean, review complete. Research tasks: written summary produced, key findings linked in brain. This prevents "done" drift.
- **End-of-session capture.** After each session, record: what was completed, what was left out, key decisions made, questions that arose. This is the lightweight retrospective. 5 minutes; stored in brain under the project note.
- **Velocity tracking for session planning.** Log how many task-points complete per session. Use this history when planning the next session's scope. If you consistently overshoot, descope by default.
- **Skip the standup.** There is no value in a solo developer reporting status to themselves. Replace it with a brief review of the pm board state at session start — this is faster and more actionable.

### Anti-Patterns to Avoid

- **Running Scrum ceremonies solo.** Standups with yourself, sprint reviews without stakeholders, and retrospectives that produce no lasting artifact are ritual without function. Adopt the underlying purpose; discard the team-optimized format.
- **Two-week sprint length by default.** Sprint length is a design decision based on how often you need to re-plan. For solo dev with AI agents, the natural cadence may be daily sessions, not weekly sprints. Match the cycle to your actual rhythm.
- **Velocity as pressure.** Tracking velocity to optimize throughput produces a system that sacrifices quality and sustainability for task count. Velocity is a planning calibration tool, nothing more.
- **Definition of Done drift.** Starting a new project by accepting "it works" as done, then slowly adding quality criteria over time, produces inconsistent quality. Define DoD at project start and enforce it.
- **Skipping session planning because it feels like overhead.** Unplanned sessions produce random work. Even a 3-bullet planning note takes 2 minutes and reduces scope scatter significantly.

### System Mapping

| Scrum Concept | Adapted Form | System Component |
|---|---|---|
| Sprint planning | Session brief — goals, appetite, open questions | Brain note per session; read by orchestrator at start |
| Daily standup | PM board review — current state of in-progress work | `pm status` command at session start |
| Sprint review | Completion summary — what shipped, what was cut | End-of-session capture in project brain note |
| Sprint retrospective | Decision capture — what we learned, what changed, why | ADR or brain note; see section 7 |
| Definition of Done | Per-task-type completion checklist | pm module task types carry DoD metadata |
| Velocity | Historical task completion rate | pm analytics: tasks completed per session |

---

## 6. Zettelkasten + Task Integration

### What It Is

The Zettelkasten ("slip box") method was developed by German sociologist Niklas Luhmann, who used it to write over 70 books and 400+ articles. His physical system consisted of approximately 90,000 index cards linked by a branching numbering system. The method was rediscovered by the note-taking community in the 2010s and adapted to digital tools.

**Core principles of Zettelkasten:**

- **Atomicity**: Each note captures one idea. A note on "event sourcing" is separate from a note on "CQRS." They may link to each other, but they don't merge. Atomic notes are portable and reusable across contexts.
- **In your own words**: Notes are processed, not copied. Paraphrasing forces understanding. A note is a synthesis, not a quote collection.
- **Hypertext links**: The value is in the connections between notes, not the notes themselves. A network of 1,000 linked notes is exponentially more useful than 1,000 isolated notes.
- **Emergent structure**: Luhmann never imposed a top-down hierarchy. Structure emerged bottom-up from link patterns. Categories arose after the fact, not before.
- **The slip box as a thinking partner**: The system accumulates context that its author no longer holds in memory. Querying it surfaces connections that wouldn't otherwise occur. Luhmann described it as a "communication partner."

**Intersection with tasks:**

Modern implementations (Obsidian, Logseq, Roam Research) blur the boundary between notes and tasks. Logseq treats every block as potentially taskable — you can tag any line with `TODO`/`DONE`. Obsidian's Tasks and Dataview plugins allow querying tasks across all notes, turning the knowledge graph into a distributed task surface. Key integration patterns:

- Tasks embedded in context notes (a meeting note containing action items)
- Queries that aggregate tasks across the graph by tag, date, or project
- Daily notes as a working surface that links to both tasks and reference notes
- Project notes that are both PARA project artifacts and Zettelkasten nodes

### Core Principles Applicable to AI-Assisted Execution

1. **Knowledge is a graph, not a hierarchy.** A flat tag or a rigid folder hierarchy cannot represent the relational nature of knowledge. An AI system that can traverse note links can surface contextually relevant information that wouldn't appear in a keyword search.

2. **Atomic notes are reusable context.** When an AI agent needs context for a task, it shouldn't receive a dump of everything — it should receive the atomic notes most relevant to the task. Atomic granularity enables precise context injection.

3. **Emergent structure over imposed taxonomy.** Defining 40 tags before you have notes produces a system that fights the natural shape of your knowledge. Structure should emerge from usage. The pm module and brain should allow ad-hoc linking before formal categorization.

4. **Notes adjacent to tasks preserve decision context.** Embedding the "why" of a task in a linked note (rather than a task description field) gives future agents and future-you the context needed to understand not just what was done but why.

5. **The knowledge base as a long-term memory for the orchestrator.** AI agents have context windows. The brain note system is persistent memory — a store the orchestrator can query for relevant prior work, decisions, patterns, and failures.

### Patterns to Adopt

- **Atomic notes in brain, not monolithic docs.** Research notes should be broken into linkable atomic units. A note on "exponential backoff" is better than a monolithic "API design" document — the former can be linked from any relevant task or project.
- **Tasks embedded in context notes.** When a task emerges from a research note or a meeting note, embed it there as a `- [ ] task` item. The pm module ingests these via periodic sync, preserving the originating context as a back-link.
- **Daily notes as a working surface.** A daily note is the entry point for each session — links to active projects, tasks encountered during the day, observations. This is the GTD inbox implemented as a Zettelkasten daily log.
- **Link density as a relevance signal.** Notes with many incoming links are high-value reference material. The orchestrator can use link density as a signal when deciding what context to inject into an agent's prompt.
- **Brain as the context store for the orchestrator.** When the orchestrator generates a task plan, it queries the brain for relevant prior notes. This gives AI agents access to accumulated project knowledge without requiring the human to manually curate context.

### Anti-Patterns to Avoid

- **Collecting without connecting.** A brain with 500 notes and no links is a library no one can navigate. The value is in connections, not volume.
- **Hierarchical folders defeating the graph.** Organizing brain notes into deep folder hierarchies recreates the filing cabinet problem. Prefer flat structure with tags and links.
- **Tasks as notes.** Tasks and notes serve different functions. Tasks have states (open/done), dates, and dependencies. Notes have ideas, links, and permanence. Mixing them in the same structure produces neither a good task system nor a good knowledge system. Keep them distinct but linked.
- **Perfect notes over timely notes.** Zettelkasten works through accumulation. An imperfect note written now is better than a perfect note written never. The system should encourage capture; refinement comes later.
- **Using note tools as task managers.** Obsidian and Logseq can technically manage tasks, but they lack the state management, dependency tracking, and dispatch capability of a proper pm module. Use each tool for its strength.

### System Mapping

| Zettelkasten Concept | System Component |
|---|---|
| Atomic note | Brain note: single idea, unique ID, markdown, bidirectional links |
| Slip box | Brain: the full note graph with link traversal capability |
| Daily note | Session note: entry point for each work session, links to active projects and tasks |
| Links between notes | Brain: explicit `[[note-id]]` links, tracked as edges in the graph |
| Emergent structure | Tags added post-hoc; no mandatory folder hierarchy |
| Tasks in notes | Embedded `- [ ]` items in context notes, synced to pm module with back-link |
| Context injection | Orchestrator queries brain for notes linked to current project before task dispatch |
| Link density | Brain analytics: highly-linked notes are high-priority context for agents |

---

## 7. Decision Journals / Architecture Decision Records (ADRs)

### What It Is

**Decision journals** are a technique from behavioral economics and cognitive psychology. The premise: we are poor judges of our own past reasoning because hindsight bias corrupts memory. Writing decisions down — including the reasoning, alternatives considered, uncertainty level, and expected outcome — before we know the result creates a record that can be reviewed honestly later.

The Farnam Street framework captures: context, alternatives considered, expected outcome, actual outcome (filled in later), and lessons learned. The critical rule: capture reasoning *before* you know the result. Post-hoc journals are not journals — they are justifications.

**Architecture Decision Records (ADRs)** are the software engineering formalization of decision journals for technical choices. Introduced by Michael Nygard and popularized in the DevOps and software architecture communities, ADRs capture:

- **Context**: What situation prompted the decision?
- **Decision**: What did we decide?
- **Status**: Proposed / Accepted / Deprecated / Superseded
- **Consequences**: What are the implications — positive, negative, and neutral?
- **Alternatives considered**: What else was on the table?
- **Related decisions**: What ADRs does this link to?

ADRs are stored as numbered markdown files in the repository (`docs/adr/0001-use-postgres-for-primary-store.md`). They are immutable records — when a decision is reversed, a new ADR is created that supersedes the old one, rather than editing the original. This preserves the history of decision evolution.

**Dependency tracking through ADRs:**

The "related decisions" field creates an explicit dependency graph between architectural choices. If ADR-0003 (use event sourcing) supersedes ADR-0001 (use simple CRUD) and is referenced by ADR-0007 (message queue choice), you have a traceable decision ancestry. When a decision is revisited, you can traverse the graph to understand downstream implications.

### Core Principles Applicable to AI-Assisted Execution

1. **Decisions are first-class artifacts.** A decision made but not recorded is a hidden dependency. When an AI agent makes a non-trivial technical choice, that choice should be recorded — not as a log line, but as a structured decision artifact with context and rationale.

2. **Pre-decision capture defeats hindsight bias.** When reasoning is recorded before the outcome is known, the record is honest. When recorded after, it is rationalization. For AI-assisted work, this means capturing the orchestrator's plan and reasoning before execution begins.

3. **Status lifecycle enables honest history.** A decision has a status: proposed, accepted, deprecated, superseded. This lifecycle allows you to see not just what was decided but how the architecture evolved over time and why choices were abandoned.

4. **Related decisions create a dependency graph.** ADRs that reference each other form a graph. This graph is navigable: given a current technical problem, you can trace the decision history that produced the current state. An orchestrator can traverse this graph to understand the context of current choices.

5. **Consequences are as important as decisions.** An ADR without consequences is incomplete. The consequences section is where the "weight" of the decision lives — what trade-offs are accepted, what doors close, what future work is implied.

### Patterns to Adopt

- **ADR for every non-obvious technical choice.** The bar for writing an ADR is not "is this a huge decision" but "would future-me need to know why this choice was made." Choosing a test framework, a data schema pattern, a retry strategy — these all qualify.
- **Lightweight ADR format.** Full architectural governance ADRs are overkill for solo work. Use a stripped-down format: Context (2–3 sentences), Decision (1 sentence), Consequences (bullet list), Status (one word). Write in 5 minutes; the value is in the record, not the prose.
- **ADRs linked from project brain notes.** When a project note references a technical approach, link to the relevant ADR. This connects the "what we're doing" layer (project note) to the "why we're doing it this way" layer (ADR).
- **Orchestrator-generated ADR drafts.** When the orchestrator makes a significant technical decision during task execution, it should generate a draft ADR for human review. This captures AI-made decisions that would otherwise be invisible.
- **Superseded ADRs preserved, not deleted.** When you change direction, create a new ADR with `supersedes: ADR-0003`. Leave the old ADR intact. The evolution of thinking is itself data.
- **Decision journal for session-level choices.** Before each work session, record: what are we trying to accomplish, what's the plan, what alternatives were considered, what is uncertain. After the session: what actually happened, what changed. This is a session-level decision log, not a technical ADR.

### Anti-Patterns to Avoid

- **Post-hoc rationalization.** Writing "here's why we made this choice" after you know the outcome is not a decision record — it's a story. Capture reasoning before execution.
- **ADR graveyard.** Writing ADRs that are never consulted produces documentation theater. ADRs are only valuable if the orchestrator and team actually read them before making related decisions.
- **Conflating ADRs with task tickets.** An ADR records a decision and its rationale. It is not a task description, a bug report, or a feature request. Keep the artifact types distinct.
- **Treating "accepted" as permanent.** Architectures evolve. An ADR accepted two years ago may be a liability today. The status field and the supersedes relationship exist to handle this — use them.
- **Overloading ADRs with implementation detail.** An ADR captures the "why" of a decision, not the "how" of its implementation. Implementation belongs in code comments, inline docs, or task descriptions.

### System Mapping

| Decision Record Concept | System Component |
|---|---|
| ADR | `docs/adr/NNNN-<slug>.md` — immutable, numbered, markdown |
| ADR status | Metadata field: `status: proposed | accepted | deprecated | superseded` |
| Supersedes | ADR metadata link to prior ADR being replaced |
| Related decisions | ADR `related:` field — links to ADRs this decision depends on or affects |
| Decision graph | Brain: ADRs are nodes; `supersedes` and `related` fields are edges |
| Context field | 2–3 sentences explaining the situation that prompted the decision |
| Consequences | Bullet list of positive/negative/neutral implications |
| Session decision log | Brain session note: plan + alternatives considered + post-session outcome |
| Orchestrator ADR draft | When agent makes a non-trivial choice, it generates a draft ADR for human review |

---

## Cross-Methodology Synthesis

### What the Methodologies Agree On

All seven methodologies converge on a set of principles that appear robust across contexts:

1. **Externalize everything.** Memory is unreliable. Trust a system, not your head. (GTD, Zettelkasten, Decision Journals)
2. **Scope explicitly before executing.** Whether it's a next action, a shaped pitch, a session brief, or an ADR context — define what you're doing and why before doing it. (GTD, Shape Up, Scrum, ADRs)
3. **Limit concurrent work.** Parallel execution has real costs. WIP limits, appetites, and sprint commitments all enforce this. (Kanban, Shape Up, GTD's single-focus engagement)
4. **Periodic review is non-negotiable.** Weekly reviews, retrospectives, and area reviews all serve the same function: catching system rot before it compounds. (GTD, Scrum, PARA)
5. **Preserve decision context.** Completed work is only valuable if future work can learn from it. Archives, ADRs, and retrospectives are mechanisms for this. (PARA, ADRs, Scrum retrospectives)
6. **Structure should emerge from use.** Over-engineering organizational systems before you have content to organize produces friction, not clarity. (Zettelkasten, PARA, Shape Up)

### Priority Patterns for Our System

Based on the synthesis, the following patterns should be implemented first — they appear in multiple methodologies and have the highest leverage:

**Tier 1 — Foundation:**
- Capture inbox with clarification step (GTD)
- Task states with WIP limits (Kanban)
- Appetite declaration on project creation (Shape Up)
- PARA schema for brain notes (PARA)
- ADR format for non-obvious decisions (ADRs)

**Tier 2 — Orchestration:**
- Context-tagged tasks with availability filtering (GTD contexts)
- Hill chart phase tracking per scope (Shape Up)
- Pull-based agent dispatch (Kanban)
- Session brief + end-of-session capture (Scrum adapted)
- Atomic notes as context injection for agents (Zettelkasten)

**Tier 3 — Maintenance:**
- Weekly review automation — surface stale projects, unresolved blockers, pending ADR drafts (GTD + Scrum)
- Link density analytics for brain (Zettelkasten)
- Archive sweep for dormant work (PARA + Shape Up)
- Velocity tracking for session calibration (Scrum)
- Decision graph traversal for related-ADR lookup (ADRs)

### Anti-Patterns That Appear Across Methodologies

These failure modes appear repeatedly and should be treated as system-level risks:

- **Capturing without processing.** GTD calls this "inbox rot." PARA calls it "collecting without organizing." Zettelkasten calls it "collecting without connecting." The pattern: work enters the system and stops moving. Solution: mandatory clarification step on capture; staleness detection.
- **Estimation over appetite.** Shape Up explicitly rejects estimation. GTD's next-action doctrine implicitly does the same (if you can't state the next action, you're not done clarifying). Asking "how long will this take?" before you understand the problem is noise.
- **Process theater over substance.** Standups with yourself, ADRs no one reads, Kanban boards with no WIP limits, PARA folders never opened. Every methodology warns against the form without the function.
- **Ignoring the maintenance ceremonies.** Weekly review (GTD), cool-down (Shape Up), area review (PARA), retrospective (Scrum). All of these exist because systems accumulate debt. Skipping them is deferred cost.
- **Infinite backlog.** Shape Up's "no backlog" is the strongest statement of a principle all methodologies imply: work that will never be done should not occupy the system. Archive aggressively.

---

## Sources

- [Getting Things Done — Wikipedia](https://en.wikipedia.org/wiki/Getting_Things_Done)
- [GTD Methodology — David Allen](https://gettingthingsdone.com/)
- [Master GTD in 5 Steps — Asana](https://asana.com/resources/getting-things-done-gtd)
- [GTD in the Age of AI — Capable/DearFlow](https://www.dearflow.ai/blog/getting-things-done-gtd-in-the-age-of-ai)
- [Shape Up — Basecamp (full book)](https://basecamp.com/shapeup)
- [Shape Up Introduction — Chapter 1](https://basecamp.com/shapeup/0.3-chapter-01)
- [Shape Up: Set Boundaries](https://basecamp.com/shapeup/1.2-chapter-03)
- [3 Compelling Concepts from Shape Up — Sachin Rekhi](https://www.sachinrekhi.com/basecamp-shape-up)
- [The PARA Method — Forte Labs](https://fortelabs.com/blog/para/)
- [PARA Method — Todoist](https://www.todoist.com/productivity-methods/para-method)
- [PARA Method — Building a Second Brain](https://www.buildingasecondbrain.com/para)
- [WIP Limits — Atlassian](https://www.atlassian.com/agile/kanban/wip-limits)
- [WIP Limits Explained — Miro](https://miro.com/kanban/wip-limits-kanban/)
- [Kanban WIP Limits — BusinessMap](https://businessmap.io/kanban-resources/getting-started/what-is-wip)
- [Agile Ceremonies Guide — Atlassian](https://www.atlassian.com/agile/scrum/ceremonies)
- [What is a Sprint Retrospective — Scrum.org](https://www.scrum.org/resources/what-is-a-sprint-retrospective)
- [Introduction to the Zettelkasten Method](https://zettelkasten.de/introduction/)
- [Zettelkasten — Wikipedia](https://en.wikipedia.org/wiki/Zettelkasten)
- [Applying Zettelkasten in Obsidian — DEV Community](https://dev.to/airabbit/how-to-apply-zettelkasten-with-obsidian-2pk0)
- [ADR Examples — Joel Parker Henderson, GitHub](https://github.com/joelparkerhenderson/architecture-decision-record)
- [Architectural Decision Records — adr.github.io](https://adr.github.io/)
- [ADR Process — AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html)
- [ADR — Microsoft Azure Well-Architected Framework](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record)
- [How a Decision Journal Changed My Decisions — Farnam Street](https://fs.blog/decision-journal/)
- [Decision Journal — Atlassian Work Life](https://www.atlassian.com/blog/productivity/decision-journal)
- [AI Agent Orchestration Patterns — Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns)
- [Agentic AI Workflow Patterns 2025 — Skywork](https://skywork.ai/blog/agentic-ai-examples-workflow-patterns-2025/)
- [GTD MCP Server — GitHub](https://github.com/peerjakobsen/mcp-gtd)
