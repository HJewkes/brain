# AI Agent Orchestration & Workflow Execution Patterns

*Research compiled: 2026-02-25*

This document synthesizes findings on multi-agent orchestration, workflow execution, context management, and human-in-the-loop patterns, with particular focus on Claude Code's built-in tooling and where an external orchestration layer adds value.

---

## Table of Contents

1. [Claude Code's Task/Team System](#1-claude-codes-taskteam-system)
2. [Agentic Workflow Patterns](#2-agentic-workflow-patterns)
3. [Context Management for Agents](#3-context-management-for-agents)
4. [State Machines for Project Execution](#4-state-machines-for-project-execution)
5. [Human-in-the-Loop Patterns](#5-human-in-the-loop-patterns)
6. [Decision Propagation](#6-decision-propagation)
7. [Design Heuristics & Anti-Patterns](#7-design-heuristics--anti-patterns)
8. [Implications for an External Orchestration Layer](#8-implications-for-an-external-orchestration-layer)

---

## 1. Claude Code's Task/Team System

### 1.1 Two Distinct Mechanisms

Claude Code provides two distinct agent-delegation primitives that are often conflated:

**Subagents (Task tool)**
- Spawned within a single Claude Code session
- Each runs in its own context window
- Communication is one-way: they work and report back to the spawning agent only
- They cannot message each other
- Lower token cost because results are summarized back
- Best for focused, delegatable work where only the result matters

**Agent Teams (experimental)**
- Multiple fully independent Claude Code sessions
- Enabled via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `settings.json`
- One session is designated team lead; others are teammates
- Teammates share a task list and can message each other directly (peer-to-peer)
- Each teammate loads `CLAUDE.md`, MCP servers, and skills from the project — but does **not** inherit the lead's conversation history
- Display modes: in-process (Shift+Down to cycle) or split panes (requires tmux or iTerm2)

### 1.2 Task Tool API

The Task tool accepts the following parameters:

| Parameter | Required | Description |
|---|---|---|
| `subagent_type` | Yes | Type of agent: general-purpose, explore, plan, bash, or specialized |
| `description` | Yes | 3–5 word label |
| `prompt` | Yes | Full instructions; must include all needed context explicitly |
| `run_in_background` | No | Boolean; use for tasks over ~1 minute |
| `model` | No | `sonnet`, `opus`, or `haiku` |
| `resume` | No | Agent ID for resuming interrupted tasks |

**Agent type capabilities:**

| Type | Tools Available | Best For |
|---|---|---|
| general-purpose | All tools | Complex research, multi-file operations |
| explore | Read-only (Glob, Grep, LS, Read, WebFetch) | Codebase analysis without risk of modification |
| plan | All except Task, Edit, Write | Architecture planning |
| bash | Bash only | Terminal operations, git workflows |

**Execution modes:**
- **Foreground**: blocks main session until done; use for sub-30-second tasks
- **Background**: async; main session continues; recommended for tasks over 1 minute

### 1.3 Agent Teams: Architecture Detail

Teams are stored locally:
- Team config: `~/.claude/teams/{team-name}/config.json`
- Task list: `~/.claude/tasks/{team-name}/`

**Coordination mechanisms:**
- **Shared task list**: tasks have states (pending, in-progress, completed) and dependency relationships; blocked tasks auto-unblock when their dependencies complete
- **Mailbox**: async message delivery; no polling needed; `message` sends to one teammate, `broadcast` sends to all (use sparingly — cost scales with team size)
- **Task claiming**: file-locking prevents race conditions when multiple teammates try to claim the same task
- **Plan approval gate**: teammates can be required to stay in read-only plan mode until the lead approves their plan; the lead can approve or reject with feedback

**Hooks for quality enforcement:**
- `TeammateIdle`: runs when a teammate goes idle; exit code 2 keeps them working with feedback
- `TaskCompleted`: runs when a task is being marked complete; exit code 2 prevents completion with feedback

### 1.4 Limitations of the Built-in System

| Limitation | Impact |
|---|---|
| No session resumption with in-process teammates | `/resume` and `/rewind` don't restore teammates; orphaned tasks require manual intervention |
| Task status can lag | Teammates sometimes fail to mark tasks complete; dependent tasks stay blocked |
| One team per session | Cannot nest teams or have teammates spawn sub-teams |
| Lead is fixed for team lifetime | Cannot transfer leadership |
| Permissions set at spawn, not per-teammate | All teammates inherit lead's permission mode |
| No nested teams | Only the lead can spawn teammates |
| Shutdown can be slow | Teammates finish current request before shutting down |
| Split panes require tmux/iTerm2 | Not supported in VS Code terminal, Windows Terminal, or Ghostty |

### 1.5 Where an External Orchestration Layer Adds Value

The built-in system lacks: durable persistence across restarts, structured task dependency graphs with rich metadata, decision/ADR tracking, retry logic with backoff, and any history of past project executions. An external layer can own these concerns and drive Claude Code sessions as execution targets rather than trying to do coordination inside a Claude session.

---

## 2. Agentic Workflow Patterns

### 2.1 Complexity Ladder — Start Here

Before choosing a multi-agent pattern, choose the minimum complexity level that meets requirements:

| Level | Description | When Appropriate |
|---|---|---|
| Direct model call | Single LLM call, no tools, no agent loop | Classification, translation, summarization |
| Single agent with tools | ReAct loop with tool access | Varied queries in one domain; default for most enterprise tasks |
| Multi-agent orchestration | Multiple specialized agents coordinating | Cross-domain work, tasks benefiting from parallel specialization, distinct security boundaries |

Adding agent coordination adds: latency, token cost, coordination overhead, and new failure modes. Justify it explicitly.

### 2.2 ReAct (Reason + Act) Loop

**Paper**: Yao et al., 2023 — *ReAct: Synergizing Reasoning and Acting in Language Models*

The foundational pattern for tool-using agents. The agent operates in a loop:

```
Thought → Action → Observation → Thought → Action → Observation → ... → Final Answer
```

**Why it works:**
- Grounding reasoning with tool observations reduces hallucination versus chain-of-thought alone
- Dynamic adaptation: the agent adjusts its plan based on intermediate results rather than committing to a fixed sequence
- Transparent: the thought-action-observation trace is auditable

**Limitations:**
- Can get stuck in loops without exit conditions
- Tool selection can become noisy if too many tools are available (tool overload degrades performance)
- Sequential by nature; parallel work requires layering a supervisor pattern on top

**Implementation note:** Most major frameworks (LangChain, LangGraph, Google ADK) provide `create_react_agent`-style utilities. The pattern is the default starting point for any tool-using agent.

### 2.3 Plan-and-Execute

Separates planning from execution into two phases:

1. **Plan phase**: a planning agent decomposes the goal into an ordered list of steps, possibly with a DAG of dependencies
2. **Execute phase**: worker agents execute individual steps; the plan can be revised if execution reveals new information

**Advantages over pure ReAct:**
- Prevents the agent from starting implementation before understanding scope
- Plan is auditable and can be human-reviewed before any side effects occur
- Enables parallelizing independent steps in the execute phase

**When to use:**
- Deterministic, step-by-step tasks where order matters (e.g., multi-file refactors, migrations)
- Expensive or irreversible operations where mistakes are costly
- When you need a human approval gate before work begins

**Pitfall:** Plans go stale. If execution reveals that the plan's assumptions are wrong, the system must detect this and re-plan rather than continuing with an invalidated plan.

### 2.4 Supervisor / Worker

A central orchestrator (supervisor) coordinates multiple specialized worker agents:

```
User → Supervisor → [Worker A, Worker B, Worker C] → Supervisor → Result
```

The supervisor:
- Decomposes the task
- Selects which workers to invoke
- Monitors progress and validates outputs
- Handles retries and escalation
- Synthesizes the final result

**When to use:**
- Auditability and clear ownership are required
- Write operations or regulated workflows (refunds, access changes, schema changes)
- You want predictable cost and latency
- You need to prevent emergent failure cascades

**Variants:**
- **Static routing**: supervisor always sends type X to worker A; deterministic
- **Dynamic routing**: supervisor decides which worker based on content; more flexible but less predictable
- **Hierarchical supervisor**: supervisors can themselves be supervised; useful for very large task graphs

### 2.5 Map-Reduce (Concurrent / Fan-Out / Fan-In)

Breaks a large task into independent subtasks that run in parallel, then aggregates results:

```
Input → [Map: spawn N parallel agents] → [Reduce: aggregate results] → Output
```

**Aggregation strategies (choose based on task type):**
- **Voting / majority-rule**: for classification or binary decisions
- **Weighted merging**: for scored recommendations
- **LLM-synthesized summary**: when results must be reconciled into a coherent narrative (e.g., three independent code reviews)
- **Concatenation**: when results are independent artifacts (e.g., N files each processed independently)

**Extended variant — MapReduceProduce:**
Adds a third phase: `Produce` triggers generative steps from the aggregated output (summaries, decisions, plans, code).

**When to use:**
- Tasks that naturally shard: multiple files, multiple URLs, multiple perspectives on the same input
- Time-sensitive: parallel work reduces wall-clock time
- Multiple independent viewpoints genuinely improve quality (ensemble reasoning)

**When to avoid:**
- Agents need to build on each other's output sequentially
- No clear conflict resolution strategy for contradictory outputs
- Tasks are small enough that coordination overhead dominates

### 2.6 Group Chat / Council

Multiple agents participate in a shared conversation thread, coordinated by a chat manager:

```
Chat Manager → [Agent A posts, Agent B responds, Agent C challenges, ...] → Consensus/Result
```

**Use cases:**
- Creative brainstorming where diverse perspectives compound
- Debugging with competing hypotheses (each agent advocates a theory and tries to disprove others)
- Structured quality gates: maker-checker loops where one agent builds and others review
- Decision-making requiring debate and consensus

**Key property:** agents are typically read-only (no side effects) during the discussion. Actions come after consensus.

**Human-in-the-loop fit:** this pattern integrates humans naturally — humans can join the thread as participants.

### 2.7 Deciding: Parallelize vs Serialize

Use a dependency graph (DAG) to make this decision explicitly:

**Serialize when:**
- Task B requires Task A's output as input (true data dependency)
- Tasks write to the same files or shared state (conflict risk)
- The workflow requires backtracking or dynamic re-planning
- Steps must be deterministic and reproducible in order
- Early failure should halt subsequent steps (fail-fast semantics)

**Parallelize when:**
- Tasks are "embarrassingly parallel": independent inputs, independent outputs, no shared state
- Different perspectives on the same input improve quality (concurrent review)
- Reducing wall-clock time is a priority
- Tasks are large enough that coordination overhead is small relative to work

**Practical heuristic:** if tasks touch different files and can be described to different agents without mentioning each other, they're parallel candidates. If one agent's output is the other's input, serialize.

**Cost warning:** in Claude Code's agent teams, token cost scales linearly with active teammates. 3–5 teammates is the recommended sweet spot; beyond that, coordination overhead and cost grow faster than throughput.

---

## 3. Context Management for Agents

### 3.1 The Core Problem: Context Rot

As a context window fills, LLM performance degrades even before hitting the technical token limit. This "context rot" is especially damaging in long-running multi-step work where irrelevant earlier turns crowd out the current relevant state.

**Implication:** context is not free. More is not better. The goal is the minimum set of high-signal tokens that maximizes the likelihood of the correct outcome.

### 3.2 Scoping Context for Sub-Agents

**Principle:** every agent call sees the minimum context required to do its job. Agents reach for more information via tools rather than being pre-loaded with everything.

**Concrete patterns:**

**Agents as Tools / "Clean Spawn"**
When invoking a sub-agent, pass only:
- The specific task instruction
- The artifact it needs (file path, schema, diff)
- Any relevant constraints or decisions already made
Do not pass: the parent's conversation history, unrelated artifacts, reasoning chains that led to this point.

**Context scoping in practice (Claude Code teams):**
- Spawn prompt = the only context the teammate starts with (plus CLAUDE.md / MCP)
- Lead's conversation history is explicitly not inherited
- Include task-specific details inline in the spawn prompt: file paths, expected outputs, known constraints

**Hierarchical context isolation:**
- Main agent maintains high-level plan and decisions
- Sub-agents perform deep technical work with their own full context windows
- Sub-agents return condensed summaries (1,000–2,000 tokens) — the main agent never sees the sub-agent's detailed trace

### 3.3 Context Bundling Patterns

**Just-in-Time Loading**
Rather than pre-processing all context upfront, agents maintain lightweight identifiers (file paths, stored query IDs, URLs) and fetch data at runtime via tools. This mirrors human cognition: retrieve what's needed, when it's needed.

**Structured Note-Taking / External Memory**
For long-horizon tasks that outlast a single context window, agents write structured notes to external storage. These notes are selectively pulled back into context at later steps. Notes should capture:
- Decisions made and their rationale
- Unresolved issues and blockers
- Current state of in-progress work
- Key constraints discovered during execution

This enables coherence across context resets — critical for tasks spanning hours or multiple sessions.

**Context Compaction**
When a context window approaches its limit:
1. Summarize the conversation/work so far, preserving: architectural decisions, unresolved bugs, implementation details, and next steps
2. Reinitiate the agent with the summary as the new context
3. Discard the raw conversation history

### 3.4 Avoiding Context Pollution Between Parallel Agents

**Isolation by design:** parallel agents should have independent context windows with no shared mutable state. They coordinate through the task list and mailbox (structured messages), not by reading each other's full context.

**Shared read-only artifacts:** it is safe for parallel agents to read the same files. Conflicts arise from writes, not reads.

**Message discipline:** when agents send summaries or findings to each other (or to the lead), they should send distilled results, not their full conversation trace. This prevents the recipient's context from being flooded.

**File ownership:** assign each parallel agent explicit ownership of the files it will modify. Two agents editing the same file leads to overwrites. This should be enforced in the task definition, not discovered at merge time.

### 3.5 Capturing and Propagating Decisions from Agent Outputs

Agents produce two categories of outputs:
1. **Artifacts**: code, files, reports — captured by the filesystem
2. **Decisions**: choices made during execution that affect downstream work — easily lost if not captured explicitly

Patterns for capturing decisions:
- **Structured output schemas**: require agents to return a structured object (not just prose) that separates artifacts from decisions and rationale
- **Decision log appending**: agents append to a shared decision log as they work; the orchestrator reads this log when spawning subsequent agents
- **ADR generation**: for significant decisions, the agent writes a lightweight ADR (see Section 6)

---

## 4. State Machines for Project Execution

### 4.1 Task Lifecycle States

A task in a project execution system should move through a well-defined set of states. The following is a practical model:

```
PENDING → READY → CLAIMED → IN_PROGRESS → COMPLETED
                                        ↘ FAILED → RETRY → READY (or FAILED_FINAL)
                                        ↘ BLOCKED (manual intervention needed)
                                        ↘ NEEDS_REVISION → READY
PENDING (waiting on dependency) → UNBLOCKED → READY
```

**State definitions:**

| State | Meaning |
|---|---|
| `PENDING` | Created but dependencies not yet resolved |
| `READY` | All dependencies satisfied; claimable by an agent |
| `CLAIMED` | An agent has claimed it (file-lock held); preventing duplicate work |
| `IN_PROGRESS` | Agent is actively executing |
| `COMPLETED` | Work done and verified |
| `FAILED` | Execution error; eligible for retry |
| `FAILED_FINAL` | Retry limit exhausted; requires human intervention |
| `BLOCKED` | Requires human decision or external input before proceeding |
| `NEEDS_REVISION` | Output was reviewed and rejected; agent should revise |

**Key design constraint:** only one process can transition a task from `READY` to `CLAIMED`. This must be enforced with a lock (file lock, database transaction, or optimistic concurrency check). Claude Code agent teams use file locking for this.

### 4.2 Blocking and Unblocking

**Dependency-based blocking:**
A task is `PENDING` until all tasks it depends on are `COMPLETED`. The system resolves this automatically by scanning the task graph when any task transitions to `COMPLETED` and promoting newly-unblocked tasks from `PENDING` to `READY`.

**Manual blocking:**
Some tasks require human input that the system cannot provide (a decision, a credential, an approval). These tasks should enter `BLOCKED` state with a structured description of what is needed. The system should surface blocked tasks prominently to the human operator.

**Detecting phantom blocks:**
In practice (and observed in Claude Code's agent teams), agents sometimes fail to mark tasks complete even after finishing work. The system needs a mechanism to detect this: either a timeout on `IN_PROGRESS` tasks, or a human "nudge" command that forces status reconciliation.

### 4.3 Error States, Retry Patterns, and Escalation

**Error categories:**
1. **Pre-execution errors**: dependency/state conflicts detected before the task starts; resolve by re-evaluating task readiness
2. **Execution errors**: exceptions thrown during agent work; eligible for retry
3. **State persistence errors**: failures to save task state after completion; re-run idempotently

**Retry pattern:**
```
attempt 1 → FAILED → wait(2s) → READY → attempt 2 → FAILED → wait(4s) → READY → attempt 3
→ FAILED_FINAL (after max attempts)
```

Use exponential backoff with jitter to avoid retry storms. The max attempt count should be configurable per task type (quick tasks might get 3 retries; slow expensive tasks might only get 1).

**Escalation:**
When a task reaches `FAILED_FINAL`, escalate to a human with:
- The task description and context
- The full error log from all attempts
- A suggested remediation if the error is recognizable
- The option to: retry manually, skip, or mark as won't-do

### 4.4 Representing "Partially Complete" and "Needs Revision"

**Partially complete:**
If a task has logical sub-steps, consider splitting it into multiple tasks at planning time rather than representing partial completion in a single task's state. If splitting is not feasible, the task can store `progress_notes` as structured metadata that agents can read when resuming.

**Needs revision:**
After a `TaskCompleted` hook (or a review agent) rejects the output, transition the task to `NEEDS_REVISION` with structured feedback. When re-claimed, the agent receives the original task prompt plus the revision feedback. This separates "do the work" from "do the work correctly" without requiring a new task to be created.

---

## 5. Human-in-the-Loop Patterns

### 5.1 When to Pause vs. Proceed Autonomously

**Always pause for:**
- Irreversible or high-impact actions (schema migrations, deleting data, publishing to production, billing operations)
- Actions that require credentials or access the agent does not have
- Decisions that depend on business context the agent cannot know (priority trade-offs, scope changes)
- The agent's confidence is low and the cost of being wrong is high
- The first occurrence of a new pattern (let the human set the precedent, then proceed autonomously on subsequent occurrences)

**Proceed autonomously for:**
- Reversible actions within a clearly defined scope
- Repetitive work on a pattern the human has already approved
- Read-only exploration and analysis
- Low-stakes decisions where the cost of being wrong is a minor correction

**Decision framework:** `pause_threshold = f(impact, reversibility, confidence, frequency)`. High impact + low reversibility + low confidence → pause. Low impact + high reversibility + high confidence + repeated pattern → proceed.

### 5.2 How to Present Choices Efficiently

**Principles:**
- Present structured choices, not open-ended questions
- Provide the minimum context needed to make the decision — not the agent's full reasoning trace
- Default answer should be the safe/conservative choice
- Make it clear what the agent will do if the human does not respond (either proceed with default or block)

**Effective checkpoint format:**
```
DECISION NEEDED: [brief description]

Context: [1-3 sentences of relevant context]
Options:
  A) [Option A] — [consequence]
  B) [Option B] — [consequence]
  C) Skip this task

Default: A (will proceed in 30 minutes if no response)
```

**Batching decisions:** if multiple tasks all hit human checkpoints around the same time, batch them into a single review session rather than interrupting repeatedly.

### 5.3 Checkpoint / Resume Patterns

**What a checkpoint must persist:**
- Complete execution state (all variables, context, progress)
- The interrupt reason and decision prompt
- The tasks completed so far and their outputs
- The tasks remaining and their dependency graph

**Resume mechanics (from LangGraph / Temporal patterns):**
1. Agent runs until interrupt condition is triggered (configured policy: "pause before any file write" or "pause when confidence < 0.7")
2. State is checkpointed to persistent storage
3. Human is notified with decision prompt
4. Human provides input (approve, edit, reject, skip)
5. Agent resumes from checkpoint with human decision injected
6. Execution continues as if the interrupt never happened

**Multiple pending decisions:** if several tool calls are intercepted simultaneously, each requires a separate decision in the same order as they appear in the interrupt request.

**Time-travel / rollback:** some systems (LangGraph, Temporal) support "rewinding" to a previous checkpoint — undoing completed steps and re-running from a specific point. This is useful when a late-stage failure reveals that an earlier decision was wrong.

### 5.4 Handing Through Complex Multi-Step Procedures

For long procedures where human guidance may be needed at multiple points:

1. **Show the full plan upfront**: human approves the overall structure before any work begins
2. **Gate at phase boundaries**: pause at natural breaks (e.g., after research, before implementation; after implementation, before deployment) rather than at individual micro-decisions
3. **Progressive disclosure**: report what's done and what's next at each gate, not a wall of detail
4. **Offer steering, not just approval**: at each gate, let the human redirect, not just approve/reject
5. **Persist all work**: if the human is unavailable, the system waits at the gate indefinitely without losing work

---

## 6. Decision Propagation

### 6.1 The Problem

Early decisions in a project (technology choices, data model conventions, API contract shapes) become implicit assumptions in all subsequent work. When these decisions change — or when an agent makes a decision the human did not know about — downstream tasks may be built on invalidated assumptions.

In multi-agent systems this is compounded: "an agent might close an issue that another agent just opened, or ship a change that fails a downstream check it didn't know existed" (GitHub Engineering Blog).

### 6.2 ADR-Style Decision Tracking

Architectural Decision Records provide a lightweight, structured format for capturing decisions. In an agentic system, agents should generate ADRs for decisions that have downstream implications:

**Minimal ADR schema for agent use:**
```
ID: ADR-{NNN}
Date: {timestamp}
Status: proposed | accepted | superseded | deprecated
Decision: [one sentence: what was decided]
Context: [why this decision needed to be made]
Consequences: [what downstream tasks or assumptions this affects]
Supersedes: [ADR-NNN if this replaces a previous decision]
```

**When an agent should generate an ADR:**
- Choosing a library, framework, or technology
- Defining a data schema or API contract
- Establishing a naming convention or code pattern
- Making any choice that other agents will need to follow

**Where ADRs live:** in a project-level `decisions/` directory. They are read-only-accessible to all agents and form part of the context bundle passed to new tasks.

### 6.3 How Decisions Flow Through the Task Graph

**Propagation at task creation time:** when new tasks are created, the orchestrator injects relevant ADRs into the task's context. Relevance is determined by tagging: ADRs are tagged with the domains they affect (e.g., `auth`, `database`, `api`); tasks are tagged with the domains they touch.

**Detecting invalidated assumptions:** this is the hard part. Options from most to least manual:

1. **Human review at plan gates**: the human sees the ADR list before approving each phase; they can flag conflicts
2. **Constraint checking agent**: a dedicated review agent reads all pending tasks and the ADR log, checking for tasks whose stated approach contradicts an ADR
3. **Typed schemas at agent boundaries**: if agents communicate through structured schemas, a schema mismatch is a detectable signal that something changed upstream
4. **Semantic versioning of ADRs**: when an ADR is superseded, the task graph marks all tasks that depended on the old ADR as `NEEDS_REVIEW`

**Practical recommendation:** implement option 1 (human gate) first. It catches the most important cases. Options 2–4 are automatable improvements to add later.

### 6.4 Decision Scope and Blast Radius

Not all decisions have the same reach. Before propagating, classify:

| Type | Example | Blast Radius |
|---|---|---|
| Global architecture | "Use PostgreSQL" | All tasks touching data storage |
| Module-level convention | "Auth uses JWT, not session cookies" | All tasks in the auth domain |
| Local implementation | "Use `camelCase` for this particular function" | Single file or function |

Only global and module-level decisions need ADRs and active propagation. Local decisions are self-contained.

### 6.5 Cascading Consequence Handling

The ADR pattern documents that "the consequences of one ADR are very likely to become the context for subsequent ADRs." In practice:

- Model the task graph as a DAG where ADRs are nodes with edges to dependent tasks
- When an ADR is superseded, traverse the graph to find all downstream tasks
- Transition affected `PENDING` and `READY` tasks to `NEEDS_REVIEW` with a reference to the superseding ADR
- Surface this list to the human before resuming execution

---

## 7. Design Heuristics & Anti-Patterns

### Heuristics

**Use the simplest mechanism that works.** Direct model call > single agent with tools > subagents > agent teams. Each level of complexity must be justified.

**Give agents exactly the context they need.** Not more, not less. Context pollution degrades performance as much as missing context.

**Validate at every boundary.** When agents pass results to each other, validate the structure. Fail fast at boundaries rather than letting bad state propagate.

**Assign file ownership before spawning parallel agents.** Never let two agents discover at merge time that they edited the same file.

**Plan before implementing.** Especially for irreversible or expensive operations. The plan can be human-approved as a gate.

**Persist everything.** State should survive process restarts, context resets, and network failures. Don't let in-memory state be the only record of what happened.

**5-6 tasks per teammate** is the empirically observed sweet spot for Claude Code agent teams. Keeps agents productive without excessive context switching.

**3–5 teammates per team** balances parallel throughput against coordination overhead.

### Anti-Patterns

**Prompt bloat**: giving one agent all tools, all context, and all responsibilities. Specialization beats prompt complexity every time.

**Silent assumption propagation**: downstream agents make assumptions about upstream outputs without explicitly checking. Typed schemas and explicit decision passing prevent this.

**Orphaned agents**: spawning background agents and not tracking their completion or failure. Every spawned agent needs an owner.

**Premature parallelization**: splitting into parallel tasks when the work is actually sequential or the coordination overhead exceeds the benefit.

**Status drift**: task status diverges from reality (agent finished but didn't update status). Systems need a reconciliation mechanism.

**Infinite loops without exits**: ReAct agents need explicit termination conditions. Always set iteration limits.

**Amending commits after hook failure**: applies to coding workflows — when a pre-commit hook fails, create a new commit; don't amend the previous one.

---

## 8. Implications for an External Orchestration Layer

Claude Code's built-in team system is powerful for in-session coordination but has structural gaps that an external orchestration layer should fill:

| Concern | Claude Code Built-in | External Layer Role |
|---|---|---|
| Persistence across restarts | None (teams are session-bound) | Durable task graph in a database or file store |
| Task dependency modeling | Basic dependency + blocking | Rich DAG with typed edges, metadata, ADR references |
| Decision tracking | None | ADR store with downstream impact analysis |
| Retry and error handling | None (manual) | Configurable retry with backoff, escalation rules |
| Human approval gates | Plan-approval per teammate | Structured checkpoint system with batching and async flow |
| Audit log | Conversation history only | Structured event log: what ran, what decided, what changed |
| Context bundling | Manual (spawn prompts) | Automated context assembly: inject relevant ADRs, prior decisions, file ownership |
| Cross-session memory | CLAUDE.md only | Project knowledge base: decisions, conventions, discoveries |

The external layer treats Claude Code sessions as execution targets: it decides what to run, in what order, with what context, and verifies outputs. Claude Code handles the actual reasoning and tool use. This separation keeps each layer focused on what it does well.

---

## Sources

- [Orchestrate teams of Claude Code sessions — Claude Code Docs](https://code.claude.com/docs/en/agent-teams)
- [The Task Tool: Claude Code's Agent Orchestration System — DEV Community](https://dev.to/bhaidar/the-task-tool-claude-codes-agent-orchestration-system-4bf2)
- [From Tasks to Swarms: Agent Teams in Claude Code — alexop.dev](https://alexop.dev/posts/from-tasks-to-swarms-agent-teams-in-claude-code/)
- [Claude Code Agent Teams: The Complete Guide — ClaudeFast](https://claudefa.st/blog/guide/agents/agent-teams)
- [Effective Context Engineering for AI Agents — Anthropic Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Context Management with Subagents in Claude Code — RichSnapp.com](https://www.richsnapp.com/article/2025/10-05-context-management-with-subagents-in-claude-code)
- [AI Agent Orchestration Patterns — Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns)
- [Multi-agent workflows often fail. Here's how to engineer ones that don't — GitHub Blog](https://github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/)
- [ReAct: Synergizing Reasoning and Acting in Language Models — arXiv](https://arxiv.org/abs/2210.03629)
- [Human-in-the-loop Docs — LangChain](https://docs.langchain.com/oss/python/langchain/human-in-the-loop)
- [Human-in-the-Loop AI Agent — Temporal Platform Documentation](https://docs.temporal.io/ai-cookbook/human-in-the-loop-python)
- [From MapReduce to MapReduceProduce — ForGen AI Journal](https://blog.forgen.ai/from-mapreduce-to-map-reduce-produce-a-new-paradigm-for-agentic-ai-668375de2329)
- [Choosing the right orchestration pattern for multi-agent systems — Kore.ai](https://www.kore.ai/blog/choosing-the-right-orchestration-pattern-for-multi-agent-systems)
- [Orchestrating AI Agents in Production: The Patterns That Actually Work — HatchWorks](https://hatchworks.com/blog/ai-agents/orchestrating-ai-agents/)
- [LangGraph State Machines: Managing Complex Agent Task Flows in Production — DEV Community](https://dev.to/jamesli/langgraph-state-machines-managing-complex-agent-task-flows-in-production-36f4)
- [Architectural Decision Records — adr.github.io](https://adr.github.io/)
- [Deep Dive into Context Engineering for Agents — Galileo](https://galileo.ai/blog/context-engineering-for-agents)
- [Parallel agents — Google ADK Documentation](https://google.github.io/adk-docs/agents/workflow-agents/parallel-agents/)
- [StateFlow: Enhancing LLM Task-Solving through State-Driven Workflows — arXiv](https://arxiv.org/html/2403.11322v1)
