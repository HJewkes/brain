# MCP Server Quick Start

Brain exposes its full capability set as a Model Context Protocol (MCP) server, making search, PM, workflow, agent, and session tools available to Claude and any other MCP client. Two transport modes are available: stdio (for Claude Code integration) and HTTP+SSE (for the dashboard or custom clients).

## Prerequisites

- brain installed and initialized (`brain init`)
- Claude Code or another MCP client

---

## 1. What Problem It Solves

Brain's CLI is powerful but requires switching contexts. The MCP server lets Claude interact with your knowledge base, project tasks, and running workflows directly in-conversation — no shell commands needed. Claude can search notes, pick up tasks, dispatch agents, and stream workflow events without leaving the chat.

---

## 2. Start the MCP Server (Stdio)

For Claude Code integration, add brain to your MCP config:

```json
{
  "mcpServers": {
    "brain": {
      "command": "npx",
      "args": ["tsx", "src/cli.ts", "serve", "--mcp"],
      "cwd": "/path/to/brain"
    }
  }
}
```

Or start it manually:

```bash
brain serve --mcp
```

---

## 3. Start the HTTP Server (Dashboard / Custom Clients)

```bash
brain serve --port 3456
```

This starts both an HTTP endpoint and an SSE channel for push events. The dashboard connects to this.

---

## 4. Available Tools

The server registers ~45 tools grouped by domain:

**Search & Knowledge**

| Tool | Description |
|---|---|
| `brain_search` | Hybrid BM25 + vector search across notes |
| `brain_memory_search` | Search extracted memory facts |
| `brain_note_read` | Fetch a note by ID or slug |
| `brain_note_list` | List notes with filters |
| `brain_memory_list` | List extracted memories |

**Project Management**

| Tool | Description |
|---|---|
| `brain_pm_next` | Eligible tasks ranked by priority |
| `brain_pm_context` | PM context for the active project |
| `brain_pm_overview` | High-level summary across workstreams |
| `brain_pm_task_add` | Create a new task |
| `brain_pm_task_update` | Update task fields |
| `brain_pm_task_complete` | Mark a task done |
| `brain_pm_wave` | Wave plan for remaining tasks |
| `brain_dispatch_triage` | Triage and route incoming work |

**Workflow**

| Tool | Description |
|---|---|
| `brain_workflow_start` | Start a named workflow |
| `brain_workflow_status` | Get run status and step results |
| `brain_workflow_signal` | Signal an assisted step |
| `brain_workflow_events` | Poll incremental events (with cursor) |

**Agents**

| Tool | Description |
|---|---|
| `brain_agent_list` | List agents with status filter |
| `brain_agent_status` | Get agent detail |
| `brain_agent_dispatch` | Dispatch an agent for a task |
| `brain_agent_activity` | Recent agent activity log |

**Inbox & Capture**

| Tool | Description |
|---|---|
| `brain_inbox_add` | Add an item to the capture inbox |
| `brain_note_add` | Create a new note |

**Sessions & Advisor**

| Tool | Description |
|---|---|
| `brain_session_list` | List ingested sessions |
| `brain_session_show` | Session detail and segments |
| `brain_advisor_ask` | Strategic question to Opus advisor |
| `brain_advisor_review` | Request advisor review of a plan |

---

## 5. Example: Search and Pick Up a Task

Inside a Claude conversation with brain MCP connected:

```
User: What's the next task for the VNM project?
Claude: [calls brain_pm_next] → MY-01-003 (high priority, ELIGIBLE)

User: Show me related context.
Claude: [calls brain_pm_context, brain_search "MY-01-003"] → returns task detail + relevant notes
```

---

## How It Works

The server is initialized in `src/server/index.ts`. Tool handlers are registered in `src/server/mcp.ts`. On startup, the MCP server initializes the V2 workflow runtime and the merge lifecycle reconciler. Resource list change notifications are sent over the SSE channel when agent or workflow state changes.

---

## Related

- Server entry: `src/server/index.ts`
- Tool catalog: `src/server/mcp.ts`
- Workflow runtime integration: `src/server/index.ts:initV2Runtime`
