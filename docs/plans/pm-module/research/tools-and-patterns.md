# Tools and Patterns: A Research Briefing

**Date**: 2026-02-25
**Scope**: CLI task managers, AI agent orchestration, PM data models, plugin systems, dependency graph engines
**Purpose**: Inform the data model and architecture of a new task management system

---

## Table of Contents

1. [CLI-Based Task Managers](#1-cli-based-task-managers)
2. [AI Agent Orchestration Frameworks](#2-ai-agent-orchestration-frameworks)
3. [Project Management Data Models](#3-project-management-data-models)
4. [Plugin and Module Systems](#4-plugin-and-module-systems)
5. [Dependency Graph Engines](#5-dependency-graph-engines)
6. [Cross-Cutting Takeaways](#6-cross-cutting-takeaways)

---

## 1. CLI-Based Task Managers

### 1.1 Taskwarrior

**Storage format**: SQLite in v3.x (Rust rewrite). The v2.x format used newline-delimited JSON files (`pending.data`, `completed.data`) where each line was a JSON object. The SQLite migration resolved concurrency and integrity issues.

**Data model**: Every task is a key-value map with string keys and string values. There is no enforced schema — consumers must tolerate unexpected or contradictory fields. All fields are optional.

Core fields:

| Field | Type | Notes |
|-------|------|-------|
| `uuid` | string (UUID4) | Stable identifier across sync |
| `status` | enum | `P` (pending), `C` (completed), `D` (deleted), `R` (recurring) |
| `description` | string | Single-line summary |
| `entry` | Unix timestamp | Creation time |
| `modified` | Unix timestamp | Last modification |
| `end` | Unix timestamp | Completion or deletion time |
| `start` | Unix timestamp | Most recent activation; absence = inactive |
| `wait` | Unix timestamp | Task hidden until this time |
| `due` | Unix timestamp | Due date |
| `project` | string | Dot-notation hierarchy (`work.infra.networking`) |
| `priority` | enum | `H`, `M`, `L` |
| `tag_<name>` | string (ignored) | One key per tag; value is meaningless |
| `dep_<uuid>` | string (ignored) | One key per dependency UUID |
| `annotation_<timestamp>` | string | User annotations keyed by timestamp |

**Extensibility (UDAs)**: Any unrecognized key is silently treated as a User-Defined Attribute. The recommended namespace format is `<namespace>.<key>` (e.g., `jira.issue_id`). UDAs can be given types and default values in `taskrc`.

**Dependencies**: Stored as `dep_<uuid>` keys on the blocking task. Exported as a comma-separated `depends` field. Taskwarrior computes virtual tags: `+BLOCKED` (has unresolved deps) and `+BLOCKING` (other tasks depend on it). Circular dependencies are rejected at write time.

**Filtering and scoping**: A powerful filter DSL on the CLI — `task project:work +urgent -BLOCKED due:today`. Filters combine attribute tests, virtual tags, and logical operators. Reports are named, pre-defined filter+sort combinations stored in `taskrc`.

**Projects**: A flat string with dot-notation as a convention. There is no separate project entity — `project:work.infra` is just a filter value. Sub-project hierarchies are derived at query time from prefix matching.

**What works well**:
- The UDA mechanism allows integration with external systems without schema changes.
- Virtual tags like `+BLOCKED` and `+BLOCKING` make dependency filtering ergonomic.
- The dot-notation project scoping is lightweight and requires no upfront registration.

**What doesn't work well**:
- The flat key-value map with no enforced schema causes subtle bugs across clients (the spec explicitly says consumers must handle contradictory data).
- Projects are strings, not entities — you can't attach metadata to a project.
- No support for sub-tasks within a task (annotations are notes, not children).
- Sync requires a separate Taskserver daemon (v2.x) or careful file management.

---

### 1.2 todo.txt

**Storage format**: Plain UTF-8 text, one task per line. The file is the schema.

**Line format**:
```
(A) 2024-01-15 Call dentist +health @phone due:2024-01-20
x 2024-01-14 2024-01-10 Buy milk +groceries
```

Field encoding by position and prefix:

| Prefix/Position | Meaning |
|-----------------|---------|
| `x ` at start | Completed |
| `(A)` | Priority, A–Z |
| Date after completion marker | Completion date |
| Date after priority | Creation date |
| `+word` | Project tag |
| `@word` | Context tag |
| `key:value` | Extension metadata (due, rec, t, etc.) |

**Extensions**: The base format is intentionally minimal. Communities have standardized on extension key-value pairs embedded in the task line: `due:2024-01-20`, `rec:1w`, `t:2024-01-10` (threshold/defer date). There is no official extension registry — tools interpret keys ad hoc.

**Filtering**: Done by grepping. Tools like `todotxt-cli` wrap grep with convenience aliases. No query language.

**What works well**:
- Zero lock-in. Any text editor, any tool works.
- Git-friendly diffs are meaningful at the line level.
- Trivially parseable in any language.

**What doesn't work well**:
- No stable task identifier. Moving/editing lines can break external references.
- No dependencies. No sub-tasks.
- Extension key collision is undetected — two tools can write incompatible `due:` interpretations.
- Priority is a single letter with no semantic meaning beyond ordering.

---

### 1.3 Ultralist

**Storage format**: `.todos.json` in the current directory (or `$HOME`). Initialized with `ultralist init`.

**JSON schema**:
```json
{
  "todos": [
    {
      "id": 1,
      "uuid": "550e8400-e29b-41d4-a716-446655440000",
      "subject": "Fix login bug +backend @auth",
      "projects": ["backend"],
      "contexts": ["auth"],
      "due": "2024-01-20",
      "completed": false,
      "completedDate": "",
      "archived": false,
      "isPriority": false,
      "notes": ["Affects only Safari", "Reported by @alice"]
    }
  ]
}
```

**Key design choices**:
- Projects and contexts are extracted from the subject line AND stored as separate arrays, keeping both the human-readable subject and machine-queryable fields.
- `notes` is an array of strings — a simple append-only log, not nested tasks.
- `archived` is a separate boolean from `completed`, allowing soft archival.
- UUIDs for stability, sequential IDs for CLI ergonomics.
- No dependency system.

**Filtering**: CLI flags (`ultralist list due:tod`, `ultralist list +project`, `ultralist list p` for priority). Simple predicate-based, no boolean composition.

**Sync**: Optional sync to ultralist.io SaaS — local file is always the source of truth; sync happens in the background.

**What works well**:
- The dual-storage of tags (in subject text AND in arrays) is ergonomic for both human entry and machine querying.
- JSON is more structured than plain text but simpler than a database.
- The notes array acknowledges that tasks accumulate commentary over time.

**What doesn't work well**:
- No dependency model.
- No hierarchical projects.
- File-per-list means cross-list operations require tooling.

---

### 1.4 Taskell

**Storage format**: Markdown files with a specific heading convention. Each column in the kanban is an `##` heading; each task is a `-` list item under a heading.

```markdown
## To Do

- [ ] Write tests +backend
  - [ ] Unit tests for auth
  - [ ] Integration tests

## In Progress

- [ ] Fix login bug
  due: 2024-01-20

## Done

- [x] Set up CI
```

**Data model**: Board-centric kanban, not a task-centric list. The column is the primary organizational unit. Sub-tasks are nested list items. Due dates are embedded as `due:` inline text.

**Integrations**: Can fetch from Trello boards or GitHub Projects and convert them to local markdown. No push-back — import only.

**What works well**:
- Markdown storage makes it trivially diff-able and versionable.
- The visual board maps directly to how many teams think.
- Sub-tasks as nested list items feel natural.

**What doesn't work well**:
- No stable task IDs — tasks are identified by position in the file.
- The kanban model doesn't fit all workflows (no priority, no dependency edges).
- Changing markdown settings breaks existing files.
- Archived: there's no archival concept — done tasks stay in "Done" column forever or must be manually pruned.

---

### 1.5 dstask

**Storage format**: One YAML file per task, in a directory structure organized by status. Tasks are stored under `~/.dstask/`:

```
~/.dstask/
  pending/    # YAML files named <uuid4>.yaml
  active/     # started tasks
  resolved/   # completed
  template/   # task templates
```

**YAML schema** (from the DATABASE_FORMAT.md):
```yaml
uuid: "550e8400-e29b-41d4-a716-446655440000"
status: pending          # pending, active, resolved, template
summary: "Fix login bug"
tags: [backend, auth]
project: myapp
priority: 3              # integer
notes: |
  Multi-line markdown note page for this task
created: 2024-01-10T09:00:00Z
resolved: null
due: 2024-01-20T00:00:00Z
```

**Key design choice**: Each task gets its own markdown note page (`notes` field). This makes dstask a hybrid task manager and note-taking system — the task is both a unit of work and a document.

**Git sync**: The entire `~/.dstask/` directory is a git repository. `dstask sync` runs `git pull --rebase && git push`. Merge conflicts in YAML files are infrequent because each task is its own file. Undo is `git revert`.

**Context**: `dstask context` sets a filter context persisted to disk. All subsequent commands operate within that context until cleared.

**What works well**:
- One file per task makes merge conflicts nearly impossible.
- The markdown note per task is powerful — tasks naturally accumulate rich context.
- Git as sync/undo is simple and requires no custom protocol.
- Context system provides persistent scoping without per-command filter flags.

**What doesn't work well**:
- No dependency system.
- No sub-tasks within a task (notes are freeform, not structured).
- YAML is harder to grep than JSON or plain text.
- The directory-per-status model requires file moves on status change (a git-tracked rename).

---

### CLI Task Manager Comparison Table

| Feature | Taskwarrior | todo.txt | Ultralist | Taskell | dstask |
|---------|-------------|----------|-----------|---------|--------|
| Storage | SQLite (v3) / JSON | Plain text | JSON | Markdown | YAML (1 file/task) |
| Dependencies | Yes (UUID refs) | No | No | No | No |
| Sub-tasks | No | No | No (notes only) | Yes (nested list) | No |
| Projects | String (dot-notation) | String tag | String array | Column | String |
| Tags | Yes | Yes (@context) | Yes | No | Yes |
| Priorities | H/M/L | A-Z | Boolean | No | Integer |
| Stable IDs | UUID | None | UUID + int | None | UUID |
| Sync | Taskserver / Taskchampion | Manual | SaaS optional | Manual | Git |
| Extensibility | UDAs | Key:value ad hoc | None | None | None |
| Query language | Rich DSL | Grep | Simple flags | None | Tags/project |
| Notes per task | Annotations | Inline | Array | Inline | Markdown page |

---

## 2. AI Agent Orchestration Frameworks

### 2.1 LangGraph

**Core abstraction**: A stateful directed graph where nodes are functions/runnables and edges define execution flow. The graph is compiled into a runnable with a `StateGraph` as the controller.

**State model**: A typed Python dict (or Pydantic model) is the central data structure. Every node receives the full state and returns a partial update. State is accumulated across the graph execution — it's the shared blackboard.

```python
class AgentState(TypedDict):
    messages: Annotated[list, add_messages]  # reducer function
    current_task: str
    results: dict
    next_agent: str

graph = StateGraph(AgentState)
graph.add_node("researcher", research_agent)
graph.add_node("writer", writer_agent)
graph.add_conditional_edges("researcher", route_by_result, {
    "needs_more": "researcher",
    "done": "writer"
})
```

**Checkpointing and persistence**: LangGraph saves a checkpoint at every "super-step" (one round of node executions). Checkpoints are stored to a thread (identified by `thread_id`). This enables:
- **Fault tolerance**: Resume from last successful super-step on failure.
- **Human-in-the-loop**: Interrupt the graph at any node, wait for human input, resume.
- **State forking**: Branch the graph at any checkpoint to explore alternative paths.
- **Time-travel debugging**: Replay execution from any prior checkpoint.

**Parallel execution**: Multiple nodes can be added to a single "super-step" by adding edges from a common upstream node. LangGraph executes all nodes in a super-step concurrently.

**What works well**:
- Explicit, inspectable state — the state dict is always visible.
- Checkpointing is production-grade and makes long-running agents reliable.
- Conditional routing is first-class — not an afterthought.
- Graph visualization is built in.

**What doesn't work well**:
- State management becomes complex as the state schema grows.
- The graph definition API is verbose for simple sequential flows.
- No built-in task queue — suited for workflow graphs, not dynamic task lists.

---

### 2.2 CrewAI

**Core abstraction**: Role-based "crews" of agents. The unit of work is a `Task` assigned to an `Agent`. Tasks form a DAG through the `context` attribute.

**Task model**:
```python
Task(
    description="Research the competitive landscape for product X",
    expected_output="A markdown report with 5 competitors and their strengths",
    agent=researcher_agent,
    context=[market_data_task],   # tasks whose output feeds this task
    async_execution=False,
    output_file="report.md"       # optional file output
)
```

**Execution models**:
- **Sequential**: Tasks run in order, each receiving the previous task's output automatically.
- **Hierarchical**: A manager agent (using a manager LLM) dynamically assigns tasks to worker agents based on their roles and capabilities. Delegation is via tool calls, not graph edges.
- **Parallel (async)**: Tasks marked `async_execution=True` run without blocking; downstream tasks that declare them in `context` wait for completion.

**Agent model**: Each agent has a `role`, `goal`, `backstory`, a set of `tools`, and an `allow_delegation` flag. When delegation is enabled in a hierarchical crew, the manager generates tool calls like `delegate_work(task, coworker)`.

**What works well**:
- The role/goal/backstory model produces good agent behavior — the LLM uses the backstory as context.
- The `context` attribute for task dependencies is intuitive.
- `expected_output` provides a clear contract between tasks.

**What doesn't work well**:
- Hierarchical delegation has schema validation issues (known bug with manager agent tool calls).
- No built-in state persistence — if a crew execution fails mid-way, there's no checkpoint.
- The crew/task model is tightly coupled to Python classes — hard to serialize to a database.
- Flow control is limited — no branching based on task outcomes without custom code.

---

### 2.3 AutoGen (v0.4+)

**Core abstraction**: Actors that communicate via messages. In v0.4, Microsoft adopted an actor model for multi-agent orchestration, moving away from the earlier conversation-centric model.

**Conversation patterns (v0.2 model, still widely used)**:

1. **Two-agent chat**: `UserProxy` and `AssistantAgent` exchange messages until termination condition.
2. **GroupChat**: `GroupChatManager` selects speakers in round-robin, random, or LLM-based order. All agents share the same message history (single context window).
3. **Swarm**: Agents generate `HandoffMessage` to route to the next agent. The swarm replaces sequential conversation with explicit handoffs.

**State management**: In GroupChat, state is the accumulated conversation history. In the Swarm pattern, the active agent changes via handoff, and each agent has its own context. There is no structured state object — state is implicit in message history.

**Tool use**: Tools are registered as functions on agents. The LLM generates tool-call JSON; the framework executes the function and returns results. Handoffs are implemented as tools.

**What works well**:
- The conversation metaphor is natural for LLM-driven workflows.
- GroupChat requires minimal orchestration code.
- The Swarm pattern maps well to pipelines where each stage has a clear owner.

**What doesn't work well**:
- No persistent state — GroupChat state lives in memory.
- Speaker selection in GroupChat is non-deterministic (LLM-chosen), which is hard to test.
- No dependency graph — tasks are implicit in the conversation flow.
- Debugging requires parsing unstructured message logs.

---

### 2.4 AI Orchestration Pattern Comparison

| Concern | LangGraph | CrewAI | AutoGen |
|---------|-----------|--------|---------|
| Task model | Graph nodes | Task objects with context | Message sequence |
| State | Typed dict, explicit | Implicit (last output) | Message history |
| Routing | Conditional edges | Sequential/hierarchical | Handoff messages |
| Parallelism | Super-step concurrency | async_execution flag | GroupChat (round-robin) |
| Persistence | Built-in checkpointing | None | None |
| Dependency expression | Graph edges | context= attribute | Implicit in order |
| Debugging | Graph visualization | Limited | Log parsing |
| Best for | Complex stateful workflows | Role-based pipelines | Conversational tasks |

**Key pattern: the "Task Graph with Agent Dispatch"**

The emerging production pattern combines LangGraph's stateful graph with CrewAI's role model:
- A LangGraph orchestrator holds the task graph and state.
- Each node in the graph represents an agent dispatch (a CrewAI crew, an AutoGen agent, or a raw LLM call).
- Checkpointing happens at the graph level, not within individual agent executions.
- The task graph is the source of truth for "what has been done and what comes next."

---

## 3. Project Management Data Models

### 3.1 Linear

**Hierarchy**: Workspace → Team → Project → Issue → Sub-issue

Linear's conceptual model separates organizational structure from work tracking:

```
Workspace
  └── Team (e.g., "Engineering", "Design")
       ├── Cycles (time-boxed sprints, 1-2 weeks)
       ├── Projects (feature-oriented groupings of issues)
       │    └── Issues
       │         └── Sub-issues
       └── Initiatives (cross-team groupings of Projects)
```

**Issue model** (the atomic unit):

| Field | Type | Notes |
|-------|------|-------|
| `identifier` | string | `ENG-142` — team prefix + sequential number |
| `title` | string | Short summary |
| `description` | markdown | Rich text body |
| `state` | WorkflowState | Per-team state machine (Backlog→Todo→In Progress→Done) |
| `priority` | enum | Urgent/High/Medium/Low/No Priority |
| `assignee` | User ref | Single assignee |
| `labels` | Label[] | Many-to-many |
| `parent` | Issue ref | Sub-issue relationship |
| `cycle` | Cycle ref | Current sprint membership |
| `project` | Project ref | Feature grouping |
| `dueDate` | date | |
| `estimate` | number | Story points |
| `relations` | IssueRelation[] | blocks/blocked-by/duplicate/related |

**Workflow states**: Each team defines its own state machine. States have a `type` (backlog, unstarted, started, completed, cancelled) which enables cross-team reporting without hardcoding state names.

**Cycles vs Projects**: Cycles are time-bound (sprint cadence); Projects are feature-bound (open-ended until shipped). An issue can be in a cycle AND a project simultaneously.

**API**: GraphQL. The schema is fully introspectable at Apollo Studio. Relations between entities use UUID references. The SDK generates typed TypeScript queries from the schema.

**What works well**:
- The `identifier` pattern (`ENG-142`) gives stable, human-readable references.
- Separating workflow state _type_ from state _name_ allows cross-team analytics.
- Initiatives grouping Projects gives a clean three-level portfolio view.
- The GraphQL API is the same API the Linear app uses internally.

**What doesn't work well**:
- Sub-issues only go one level deep (no recursive sub-tasks).
- Cycle membership is manual — no automatic backlog promotion.
- Teams are rigid organizational units; cross-team collaboration requires Initiatives, which is coarser than many teams need.

---

### 3.2 Plane

**Hierarchy**: Workspace → Project → Module / Cycle → Issue → Sub-issue (recursive)

Plane is open-source (Next.js + Django + PostgreSQL) and explicitly models more levels:

```
Workspace
  └── Project
       ├── Modules (topic groupings, like Epics)
       ├── Cycles (time-boxed sprints)
       ├── Issues
       │    └── Sub-issues (recursive, unlimited depth)
       └── Pages (AI-powered notes linked to issues)
```

**Issue model**: Similar to Linear but with recursive sub-issues. Labels, priorities, estimates, assignees all present. State machines are per-project.

**Key differentiator**: Sub-issues are recursive (sub-sub-tasks supported), unlike Linear's single-level limit. Modules are explicitly modeled as a first-class entity (separate from Projects), allowing issues to belong to both a Module and a Cycle simultaneously.

**Views**: Built-in kanban, list, gantt, calendar, and spreadsheet views. Views are saved filter/grouping combinations — not separate data.

**Storage**: PostgreSQL primary store, Redis for background tasks and caching. The open-source codebase makes the full Django model available for inspection.

---

### 3.3 Shortcut (formerly Clubhouse)

**Hierarchy**: Milestone → Epic → Story → Task (checklist item)

```
Milestone (high-level roadmap item)
  └── Epic (feature or initiative)
       └── Story (unit of work)
            └── Task (checklist item within a story)
```

**Story model** (the atomic unit):

| Field | Type | Notes |
|-------|------|-------|
| `id` | integer | Sequential per workspace |
| `story_type` | enum | feature / bug / chore |
| `name` | string | |
| `description` | markdown | |
| `workflow_state` | WorkflowState | |
| `owner_ids` | User[] | Multiple owners |
| `labels` | Label[] | |
| `epic_id` | Epic ref | |
| `iteration_id` | Iteration ref | Sprint membership |
| `estimate` | integer | Points |
| `deadline` | date | |
| `story_links` | StoryLink[] | blocks/blocked-by/duplicates/relates-to |

**Iterations**: Time-boxed work periods (sprints). Stories can be in an Iteration and an Epic simultaneously, mirroring Linear's Cycle/Project duality.

**Workflow states**: Workspace-level, not team-level. States apply across all projects, which limits customization but simplifies cross-team views.

**API**: REST v3. Resources mirror the hierarchy: Milestones, Epics, Stories, Iterations, Workflows. Story links model the dependency graph between stories.

**What works well**:
- The `story_type` (feature/bug/chore) is semantically meaningful and drives different workflows.
- Multiple owners per story (vs. Linear's single assignee) is more realistic.
- Milestones provide a high-level roadmap layer without requiring a separate tool.

**What doesn't work well**:
- Tasks within stories are unstructured checklist items — not first-class entities with IDs.
- Workspace-level workflow states mean every team uses the same state machine.
- No recursive sub-stories (checklist items are the only sub-unit).

---

### PM Data Model Comparison Table

| Concept | Linear | Plane | Shortcut |
|---------|--------|-------|----------|
| Top level | Initiative | Workspace | Milestone |
| Grouping | Project | Module | Epic |
| Sprint | Cycle | Cycle | Iteration |
| Atom | Issue | Issue | Story |
| Sub-atom | Sub-issue (1 level) | Sub-issue (recursive) | Task (checklist only) |
| Dependencies | Relations (blocks/related) | Relations | Story links |
| State scope | Per-team | Per-project | Workspace |
| State typing | Yes (type field) | Yes | No |
| Multiple assignees | No | Yes | Yes |
| API type | GraphQL | REST | REST |

---

## 4. Plugin and Module Systems

### 4.1 VSCode Extension System

**Registration mechanism**: `package.json` as the Extension Manifest. All capabilities are declared statically in `contributes` before any code runs. VSCode validates the manifest at install time.

```json
{
  "contributes": {
    "commands": [
      {
        "command": "myext.doThing",
        "title": "My Extension: Do Thing",
        "category": "My Extension"
      }
    ],
    "configuration": {
      "title": "My Extension",
      "properties": {
        "myext.maxResults": {
          "type": "integer",
          "default": 10
        }
      }
    },
    "jsonValidation": [
      {
        "fileMatch": "*.myformat.json",
        "url": "./schemas/myformat.schema.json"
      }
    ]
  }
}
```

**Namespace isolation**: Command IDs are namespaced by the extension's publisher and name (`publisher.extension.command`). Configuration keys follow the same convention. Extensions cannot register commands in another extension's namespace.

**Schema enforcement**: Extensions can contribute JSON schemas for their data formats via `jsonValidation`. VSCode uses these schemas for editor validation, autocomplete, and hover documentation on files matching the `fileMatch` pattern.

**Activation model**: Extensions declare `activationEvents` (e.g., `onCommand:myext.doThing`, `onLanguage:python`). The extension host does not load the extension until a matching event fires — lazy loading by default.

**Isolation**: Extensions run in a separate Node.js process (the extension host). They cannot access VSCode's UI DOM. They communicate with the main process via a message-passing API (`vscode.window`, `vscode.workspace`, etc.).

**What works well**:
- Static manifest means capabilities are discoverable without executing code.
- Schema-based JSON validation is a clean mechanism for plugin-owned data.
- The activation event system keeps cold start fast.

**What doesn't work well**:
- No capability/permission system — any extension can read any file on the filesystem.
- The extension host process model means cross-extension communication requires messages through the main process.
- Schema contributions are limited to JSON files — no way to contribute schemas for other data stores.

---

### 4.2 Neovim Plugin System

**Loading mechanism**: Plugins are directories on `runtimepath`. Lua modules in `lua/` are auto-discovered via `require()`. Vimscript in `plugin/` auto-executes on startup.

**Lazy loading pattern**: Plugin authors put command and keymap definitions in `plugin/<name>.lua` (small, runs eagerly), and do the heavy `require()` of actual plugin code only when the command fires.

```lua
-- plugin/myplug.lua  (runs eagerly, tiny)
vim.api.nvim_create_user_command("MyPlugDoThing", function()
  require("myplug").do_thing()  -- lazy require on first call
end, {})

-- lua/myplug/init.lua  (loaded lazily)
local M = {}
M.do_thing = function() ... end
return M
```

**Namespace isolation**: By convention, plugins own a Lua module namespace (`myplug.*`). No enforcement — namespace collisions are possible and do occur. The `vim.g` (global) and `vim.b` (buffer) namespaces are flat; plugins use `vim.g.myplug_option` by convention.

**Display namespaces**: `vim.api.nvim_create_namespace("myplug")` creates an isolated namespace for extmarks, diagnostics, and highlights. Namespace IDs prevent one plugin's decorations from interfering with another's.

**Configuration pattern**: Plugins expose a `setup(opts)` function that merges user options with defaults. This is convention, not enforcement.

```lua
require("myplug").setup({
  max_results = 10,
  enable_feature_x = true,
})
```

**What works well**:
- The `setup()` convention is widely adopted and provides a clear plugin initialization contract.
- Display namespaces (`nvim_create_namespace`) are proper isolation for visual output.
- Lazy loading via plugin managers (lazy.nvim) is first-class.

**What doesn't work well**:
- No global module namespace registry — collisions go undetected.
- `vim.g` is a flat dict — plugins pollute a shared namespace.
- No schema enforcement on configuration — plugins must validate `opts` themselves.
- No capability model — any plugin can call any API.

---

### 4.3 Obsidian Plugin System

**Structure**: Each plugin lives in `.obsidian/plugins/<plugin-id>/` with `manifest.json`, `main.js`, and optionally `styles.css`.

**Manifest**:
```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "minAppVersion": "1.0.0",
  "description": "Does things",
  "author": "Author Name",
  "authorUrl": "https://example.com",
  "isDesktopOnly": false
}
```

**Plugin lifecycle**: The `Plugin` base class provides:
- `onload()` / `onunload()` hooks
- `this.app` access to the full Obsidian API
- `this.registerEvent(event)` — auto-detaches on unload
- `this.addCommand(command)` — auto-deregisters on unload
- `this.loadData()` / `this.saveData()` — plugin-scoped JSON storage in `data.json`

**Data isolation**: `this.loadData()` and `this.saveData()` read/write `<plugin-dir>/data.json`. This is the only truly isolated storage — plugins can also read/write arbitrary vault files and `app.vault` metadata.

**Security model**: Plugins run in the Electron renderer process with full Node.js and browser API access. There is no permission system. Obsidian reviews plugins for the community store (source code review), but this is a human process, not a technical enforcement.

**What works well**:
- `registerEvent` / `addCommand` auto-cleanup on unload is an excellent pattern — no resource leak concern.
- `data.json` per plugin is practical isolation for plugin settings and state.
- The App object provides a stable, well-typed API for vault interaction.

**What doesn't work well**:
- No declared permission/capability system. Users cannot see what a plugin will access.
- No namespace enforcement for commands — plugins must manually prefix their command IDs.
- Frontmatter metadata has no schema ownership — multiple plugins can read/write the same fields.

---

### 4.4 Grafana Plugin System

**Types**: Data source plugins, panel plugins, app plugins (full sub-applications).

**Manifest (`plugin.json`)**:
```json
{
  "type": "datasource",
  "name": "My Data Source",
  "id": "myorg-myds-datasource",
  "info": { ... },
  "dependencies": {
    "grafanaVersion": "10.0.0",
    "plugins": []
  },
  "routes": [
    {
      "path": "api",
      "url": "https://api.example.com",
      "headers": [{ "name": "Authorization", "content": "Bearer {{ .SecureJsonData.apiKey }}" }]
    }
  ],
  "extensions": {
    "exposedComponents": ["myorg-myds-datasource/components/ConfigEditor/v1"]
  }
}
```

**Architecture**: Parallel frontend (TypeScript/React) and backend (Go) plugin systems. The backend plugin runs as a child process communicating via gRPC. The frontend plugin is a webpack bundle loaded dynamically.

**Extension points**: Plugins declare `exposedComponents` (React components they expose to other plugins) and `extensionPoints` (locations in Grafana's UI where plugins can inject UI). This is a declared, schema-enforced extension mechanism — you cannot inject into a point not listed in your manifest.

**Data source proxy**: Grafana proxies all data source HTTP requests through its backend, injecting authentication headers from secure config. Plugins never have direct access to credentials — they provide query parameters and Grafana handles auth.

**What works well**:
- The plugin ID convention (`<org>-<name>-<type>`) enforces namespace uniqueness in the registry.
- `exposedComponents` / `extensionPoints` in the manifest is a rare example of statically-declared extension points with schema enforcement.
- The proxy model for data source auth is excellent — credentials stay server-side.

**What doesn't work well**:
- The full parallel frontend/backend plugin architecture is high implementation overhead.
- The exposed component / extension point system requires forward-planning — you can't extend a point that wasn't pre-declared.

---

### Plugin System Pattern Comparison

| Concern | VSCode | Neovim | Obsidian | Grafana |
|---------|--------|--------|----------|---------|
| Manifest | package.json (static) | None | manifest.json | plugin.json |
| Namespace enforcement | Yes (command prefix) | Convention only | Convention only | Yes (ID convention) |
| Schema contribution | JSON schema contrib | None | None | Extension points |
| Isolation | Extension host process | None | None (Electron) | Backend subprocess |
| Lazy loading | activationEvents | plugin/ + lazy require | Plugin load event | Bundle load |
| Data storage | Secrets API / files | vim.g / files | data.json | Secure JSON fields |
| Capability/permissions | None | None | None | Proxy routes |
| Auto-cleanup | Disposables | Manual | registerEvent | None |

**Key pattern: the Disposable/Cleanup Registry**

Obsidian's `registerEvent` and VSCode's `context.subscriptions.push(disposable)` solve the same problem: plugins can register callbacks, commands, and timers that must be cleaned up on plugin unload. The pattern:

```typescript
// VSCode pattern
export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("myext.cmd", handler),
    vscode.workspace.onDidChangeTextDocument(handler2)
  );
  // All disposed automatically when extension deactivates
}
```

This should be adopted in any plugin system. The alternative (manual cleanup) consistently leads to resource leaks.

---

## 5. Dependency Graph Engines

### 5.1 GNU Make

**Model**: Rules with prerequisites. The target is a file (or `.PHONY` name); prerequisites are files or other targets.

```makefile
main.o: main.c utils.h
    gcc -c main.c -o main.o

program: main.o lib.o
    gcc main.o lib.o -o program
```

**Graph construction**: Make builds a DAG from all rules. Nodes are targets; edges point from target to prerequisite (i.e., "target depends on prerequisite").

**"Next eligible" computation**: Make uses a reverse DFS — start from the requested target, recursively check prerequisites. A target needs rebuilding if: (a) the output file doesn't exist, or (b) any prerequisite's mtime is newer than the target's mtime. This is timestamp-based incremental computation.

**Order-only prerequisites**: The `|` syntax specifies prerequisites that must be built before the target but whose timestamps do not trigger a rebuild. Used for creating directories that don't themselves constitute a reason to rebuild.

**Parallel execution**: `make -j N` runs independent targets in parallel. Make uses a fork-based job server. The topological ordering guarantees that a target is started only after all its prerequisites complete.

**Algorithms used**:
- Topological sort (Kahn's algorithm or DFS-based) to determine build order.
- Timestamp comparison for incremental builds.
- No cycle detection in old GNU Make — cycles cause infinite loops. Modern versions attempt to detect and report cycles.

**What works well**:
- The file-as-node model means freshness is observable from the filesystem without additional state.
- The `-j` flag for parallelism is trivially composable with any Makefile.

**What doesn't work well**:
- Timestamp-based freshness is fragile — time skew, `touch`, and generated files cause false rebuilds or missed rebuilds.
- No content-hash caching — identical outputs are still rebuilt if timestamps change.
- Rule syntax is error-prone (tabs vs spaces, shell quoting).

---

### 5.2 Bazel

**Model**: BUILD files declare targets (rules). Rules define inputs, outputs, and a command (action). Bazel constructs an action graph, not just a dependency graph.

```python
# BUILD
cc_library(
    name = "utils",
    srcs = ["utils.cc"],
    hdrs = ["utils.h"],
)

cc_binary(
    name = "program",
    srcs = ["main.cc"],
    deps = [":utils"],
)
```

**Action graph**: Each target is expanded into one or more actions. An action has:
- Deterministic inputs (file hashes)
- Expected outputs (declared upfront)
- A command (hermetic — no network, no env vars by default)

**Hermeticity**: Actions must be hermetic — they cannot access undeclared inputs (network, filesystem outside declared deps, environment variables). This is enforced via sandboxing on Linux (namespaces) and process isolation on macOS.

**Caching**: Bazel computes an action key as a hash of: command line + input file hashes + environment variables. This is a content-based cache, not timestamp-based. If the action key matches a cached result, Bazel restores outputs without executing. Remote caching shares the action cache across machines.

**"Next eligible" computation**: Bazel performs a reverse topological sort of the action graph. An action is eligible to run when all its input actions have successfully produced their declared outputs. This is tracked in-memory during the build.

**Incremental builds**: Because the cache key includes input content hashes, Bazel's incremental builds are correct even across machine boundaries and time skew.

**What works well**:
- Content-hash caching is fundamentally more correct than timestamp-based.
- Hermeticity ensures reproducibility — the same inputs always produce the same outputs.
- Remote caching and remote execution are first-class features.
- The action graph is explicit and queryable (`bazel query`).

**What doesn't work well**:
- BUILD file syntax (Starlark) has a steep learning curve.
- Hermetic sandboxing is complex to configure correctly for real-world builds.
- Cold build times can be slow — the analysis phase builds the full action graph before execution starts.

---

### 5.3 Nx

**Model**: Project graph + task graph. The project graph models relationships between packages in a monorepo. The task graph is derived from the project graph by expanding each project's tasks (build, test, lint) into nodes.

```json
// nx.json (project task dependencies)
{
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"],  // ^ = all dependencies must build first
      "inputs": ["default", "^default"],
      "outputs": ["{projectRoot}/dist"]
    },
    "test": {
      "dependsOn": ["build"]   // same project's build must run first
    }
  }
}
```

**Affected computation**: Nx computes which projects are affected by a change using:
1. Git diff to find changed files.
2. Project graph lookup to find which project owns each changed file.
3. Reverse transitive closure — any project that depends (directly or transitively) on a changed project is "affected."

This means a change to a shared library marks all downstream packages as affected, requiring their tasks to re-run.

**Cache**: Computation hash = task inputs hash (file contents matching configured `inputs` globs + env vars). Outputs matching `outputs` patterns are stored. Cache is consulted before task execution; hit = restore outputs and skip execution. Remote cache (Nx Cloud) shares across CI runners.

**Task scheduling**: Topological sort of the task graph. Nx uses a work-stealing scheduler — idle workers pull from the ready queue (tasks whose all dependencies are complete). This achieves near-optimal parallelism without a central queue bottleneck.

**What works well**:
- The `^` prefix in `dependsOn` is an elegant shorthand for "all transitive package dependencies."
- Affected computation is precise and git-aware — no guessing.
- The work-stealing scheduler is sophisticated and documented.

**What doesn't work well**:
- Nx is monorepo-specific. The model doesn't map to general task graphs without packages.
- `inputs` configuration requires careful thought — over-broad inputs defeat caching, under-broad inputs cause missed invalidations.

---

### 5.4 Turborepo

**Model**: Task pipeline defined in `turbo.json`. Tasks are associated with npm workspace packages; dependencies between tasks mirror package dependency relationships.

```json
// turbo.json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],   // topological: deps must build first
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"],    // same-package: build before test
      "inputs": ["src/**", "tests/**"]
    },
    "lint": {
      "dependsOn": [],           // no deps: can run in parallel with everything
      "outputs": []
    }
  }
}
```

**Cycle detection**: Turborepo uses **Tarjan's strongly connected components algorithm** to detect cycles in the task graph before execution. A cycle causes an immediate error with a descriptive message.

**Scheduling**: Topological sort → parallel execution across available CPU cores. Turborepo maintains a ready queue (tasks with all dependencies complete) and dispatches to workers.

**Cache**: Hash of task inputs (file content fingerprints matching `inputs` globs + env vars listed in `env`). Outputs matching `outputs` globs are stored locally (`.turbo/cache`) and optionally in a remote cache. Cache key mismatch = run; hit = restore outputs.

**What works well**:
- Tarjan's algorithm for cycle detection is a specific, well-understood choice — not ad hoc.
- The `dependsOn: ["^build"]` vs `dependsOn: ["build"]` distinction clearly expresses topological vs same-package ordering.
- Zero config for simple pipelines — the package.json scripts are used as-is.

**What doesn't work well**:
- Pipeline configuration is monorepo-package-centric. General-purpose task graphs without a package structure require workarounds.
- No "affected" computation — Turborepo relies on caching to make unchanged tasks fast rather than skipping them.

---

### Dependency Graph Engine Comparison

| Concern | Make | Bazel | Nx | Turborepo |
|---------|------|-------|----|-----------|
| Freshness model | mtime (timestamp) | Content hash | Content hash | Content hash |
| Hermeticity | None | Enforced (sandbox) | Declared inputs | Declared inputs |
| Cycle detection | Weak (may loop) | Yes | Yes | Tarjan's SCC |
| Parallel execution | `-j N` (fork) | Multi-threaded | Work-stealing | Thread pool |
| Remote caching | No | Yes (gRPC) | Nx Cloud | Vercel / self-host |
| Affected computation | No | `bazel query` | git-based | No (cache-based) |
| Task definition | Rule syntax | Starlark | nx.json | turbo.json |
| Query language | No | `bazel query` | `nx graph` | No |
| Incremental correctness | Fragile | High | High | High |

**Core algorithms summary**:

1. **Build order**: Topological sort (Kahn's algorithm or DFS post-order) on the DAG. All tools use this.
2. **Next eligible task**: A task becomes eligible when its in-degree in the remaining task graph drops to zero — i.e., all dependencies have completed. Maintained as a ready queue.
3. **Cycle detection**: DFS with coloring (white/gray/black) detects back edges. Turborepo uses Tarjan's SCC (more principled, finds all SCCs not just one cycle).
4. **Incremental build**: Content hash of inputs → cache lookup → skip or execute. Bazel's action key is the gold standard.
5. **Affected set**: Git diff → file-to-project mapping → reverse transitive closure in the project graph. Nx's implementation is the most refined.

---

## 6. Cross-Cutting Takeaways

### 6.1 Data Model

**Use UUIDs as primary identifiers, sequential integers for display.**
- Taskwarrior and Ultralist both do this. UUIDs are stable across devices, sync operations, and renames. Integers are ergonomic for humans to type.
- Rule: UUID as the identity; integer as a session-local alias.

**Model dependencies as first-class edges with metadata.**
- Taskwarrior's `dep_<uuid>` key-per-dependency works but encodes dependency type poorly. Linear's `IssueRelation` (blocks/blocked-by/duplicate/related) is better — the relation type is meaningful.
- Recommendation: a separate `TaskRelation` entity with `from_id`, `to_id`, `type` (blocks/relates/duplicates).

**Separate workflow state name from state type.**
- Linear's state machine types (unstarted, started, completed, cancelled) enable cross-team analytics without hardcoding state names. This is worth adopting: every state has a semantic type even if its display name is custom.

**Projects are entities, not tags.**
- Taskwarrior's string-based projects are lightweight but prevent attaching metadata. Linear's Project with its own description, status, and milestone dates is far more useful. Design: `Project` entity with `id`, `name`, `description`, `status`, `owner`, `target_date`.

**Notes per task are different from sub-tasks.**
- dstask's markdown note page per task is powerful for accumulating rich context.
- Ultralist's notes array is simpler and machine-queryable.
- Sub-tasks (Plane's recursive issues, Taskell's nested list items) are a separate concept.
- Design: distinguish `Note` (append-only narrative), `Checklist` (ordered boolean items), and `SubTask` (first-class task with its own lifecycle).

---

### 6.2 CLI Interface

**Context scoping should be persistent, not per-command.**
- dstask's `context` command sets a persistent scope. Taskwarrior requires `project:X` on every command.
- Recommendation: a `ctx set <filter>` command that persists the active context to a local config file. All subsequent commands operate within that context.

**Virtual tags / computed attributes make filtering powerful.**
- Taskwarrior's `+BLOCKED`, `+BLOCKING`, `+TODAY`, `+OVERDUE` virtual tags are among its most useful features. They're computed at query time from other fields.
- Design: support computed attributes as filter tokens. `+blocked`, `+ready` (no blockers, not waiting), `+due-today`, `+overdue`.

**Report = named filter + sort + format.**
- Taskwarrior's report system is the right abstraction. Pre-defined reports (`next`, `all`, `overdue`) with customizable defaults and per-report override.
- Store reports in config, not in the data store.

---

### 6.3 Storage

**SQLite is the right choice for a single-user CLI tool.**
- Taskwarrior v3's migration from JSON files to SQLite was the correct move. SQLite gives ACID guarantees, efficient queries, and a proven schema migration story.
- Avoid file-per-task (dstask) for large task sets — directory listing and YAML parsing become slow.
- Avoid plain JSON files (Ultralist) — no indexing, full-file rewrites on every change.

**Keep a separate sync layer.**
- The data store (SQLite) and the sync mechanism should be decoupled. dstask's git-based sync is elegant because git handles conflict resolution. Taskwarrior's Taskchampion (the new CRDT-based sync server) is more robust for multi-device.
- Design: SQLite locally + optional git export of a portable format (JSON or YAML) for sync.

---

### 6.4 Extensibility

**Require a manifest for plugin registration.**
- VSCode's static `package.json` and Grafana's `plugin.json` both require plugins to declare capabilities before code runs. This enables discovery, validation, and UI surfacing without executing untrusted code.
- Design: plugins register via a `plugin.toml` with a declared ID (namespaced), list of commands, list of custom fields contributed, and list of report types contributed.

**Plugins own their data fields via namespace.**
- Taskwarrior's UDA system (unrecognized keys treated as custom attributes) is flexible but lacks namespace enforcement. Any plugin can read/write any UDA.
- Better: plugins declare the custom fields they own. The core enforces that no other plugin writes to those fields. Inspired by Grafana's `exposedComponents` declaration.

**Auto-cleanup is not optional.**
- Obsidian's `registerEvent` and VSCode's `context.subscriptions` both provide lifecycle-managed registration. Any plugin system without this pattern will accumulate resource leaks.
- Design: all plugin-registered commands, hooks, and event handlers go into a registry that is torn down when the plugin is unloaded.

---

### 6.5 Dependency Graph

**Use content-hash caching, not timestamps.**
- Bazel and Nx have demonstrated that timestamp-based freshness (Make) is fragile. For a task management system with automated tasks, cache invalidation based on input content is correct.

**The "ready queue" pattern is universal.**
- All dependency engines converge on the same scheduler: maintain a set of tasks with zero remaining unmet dependencies. When a dependency completes, decrement the dependent tasks' in-degree; those that reach zero enter the ready queue.
- For a task manager: `SELECT * FROM tasks WHERE status = 'pending' AND id NOT IN (SELECT to_id FROM task_relations WHERE type = 'blocks' AND from_id IN (SELECT id FROM tasks WHERE status != 'done'))`.

**Expose cycle detection as a command, not just an error.**
- Bazel's `bazel query "somepath(//foo, //bar)"` and `nx graph` provide interactive dependency visualization. Users should be able to run `tasks deps --graph` to see the dependency graph and `tasks deps --check` to detect cycles before they cause problems.

**Tarjan's SCC algorithm for cycle detection.**
- Turborepo's use of Tarjan's strongly connected components is the right choice. Unlike simple DFS back-edge detection (which finds one cycle), Tarjan's finds all SCCs and can report all cyclic subgraphs at once.

---

## Sources

- [Taskwarrior Task Representation](https://taskwarrior.org/docs/task/)
- [Taskwarrior Dependency Management (DeepWiki)](https://deepwiki.com/GothenburgBitFactory/taskwarrior/3.5-dependency-management)
- [dstask GitHub repository](https://github.com/naggie/dstask)
- [dstask blog post by Cal Bryant](https://calbryant.uk/blog/dstask-a-terminal-based-git-powered-task-manager/)
- [todo.txt format specification](https://github.com/todotxt/todo.txt)
- [Available todo.txt attributes and extensions](https://github.com/ransome1/sleek/wiki/Available-todo.txt-attributes-and-extensions)
- [Ultralist GitHub repository](https://github.com/gammons/ultralist)
- [Taskell GitHub repository](https://github.com/smallhadroncollider/taskell)
- [Taskell documentation - LinuxLinks](https://www.linuxlinks.com/taskell-command-line-kanban-board-task-manager/)
- [CrewAI Tasks documentation](https://docs.crewai.com/en/concepts/tasks)
- [CrewAI Sequential Processes](https://docs.crewai.com/how-to/sequential-process)
- [LangGraph Architecture and Design (Medium)](https://medium.com/@shuv.sdr/langgraph-architecture-and-design-280c365aaf2c)
- [LangGraph Persistence documentation](https://docs.langchain.com/oss/python/langgraph/persistence)
- [Mastering Persistence in LangGraph (Medium)](https://medium.com/@vinodkrane/mastering-persistence-in-langgraph-checkpoints-threads-and-beyond-21e412aaed60)
- [AutoGen Multi-agent Conversation Framework](https://microsoft.github.io/autogen/0.2/docs/Use-Cases/agent_chat/)
- [AutoGen Swarm pattern](https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/swarm.html)
- [CrewAI vs LangGraph vs AutoGen - DataCamp](https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen)
- [Linear Conceptual Model](https://linear.app/docs/conceptual-model)
- [Linear API GraphQL](https://linear.app/developers/graphql)
- [Linear Projects documentation](https://linear.app/docs/projects)
- [Plane GitHub repository](https://github.com/makeplane/plane)
- [Shortcut REST API v3](https://developer.shortcut.com/api/rest/v3)
- [How Shortcut uses Milestones and Epics](https://www.shortcut.com/blog/how-we-use-milestones-epics-product-management-clubhouse)
- [VSCode Contribution Points](https://code.visualstudio.com/api/references/contribution-points)
- [VSCode Extension Anatomy](https://code.visualstudio.com/api/get-started/extension-anatomy)
- [Neovim Extension and Plugin System (DeepWiki)](https://deepwiki.com/neovim/neovim/4-extension-and-plugin-system)
- [Obsidian Plugin Development (DeepWiki)](https://deepwiki.com/obsidianmd/obsidian-api/3-plugin-development)
- [Obsidian Plugin Security](https://help.obsidian.md/plugin-security)
- [Grafana Plugin System (DeepWiki)](https://deepwiki.com/grafana/grafana/11-plugin-system)
- [Grafana plugin.json metadata reference](https://grafana.com/developers/plugin-tools/reference/plugin-json)
- [Turborepo configuring tasks](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks)
- [Nx Affected documentation](https://nx.dev/docs/features/ci-features/affected)
- [Nx How Caching Works](https://nx.dev/docs/concepts/how-caching-works)
- [Bazel Hermeticity](https://bazel.build/basics/hermeticity)
- [Bazel Remote Caching](https://bazel.build/remote/caching)
- [Topological Sorting for Dependency Resolution (Medium)](https://medium.com/@amit.anjani89/topological-sorting-explained-a-step-by-step-guide-for-dependency-resolution-1a6af382b065)
- [Task Dependency Resolution - mise (DeepWiki)](https://deepwiki.com/jdx/mise/5.2-task-execution-and-dependency-resolution)
- [Graph-Based Approach to Task Dependencies (Medium)](https://medium.com/@samarthgvasist/graph-based-approach-to-manage-task-dependencies-1d565ba2af0e)
