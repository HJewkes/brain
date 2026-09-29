# Search session events

Every `brain search` (CLI) and `brain_search` (MCP) call inside a brain session writes one
row to `session_events` with `event_type = 'search:query'` and `category = 'search'`.
Retrieval evals (precision@k, pruning against a baseline) read these rows.

## When an event is written

Only when `BRAIN_PM_SESSION` is set, the same gate the session capture hooks use. Brain
sets it for agents it dispatches. Outside a session nothing is recorded.

There is no separate opt-out config for session events. To avoid recording searches, run
them without `BRAIN_PM_SESSION` in the environment.

A failed write logs `brain: failed to record search event: <reason>` to stderr. The search
itself still returns its results.

## Payload (`data` column, JSON)

| Field          | Meaning                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `search_id`    | Random UUID, so repeated identical searches stay distinct rows          |
| `entry_point`  | `cli` or `mcp`                                                          |
| `agent_id`     | `BRAIN_AGENT_ID` or `null`                                              |
| `query`        | Query text, truncated to 500 characters                                 |
| `options`      | Mode and filters as passed (CLI flags, or `{ limit }` for MCP)          |
| `result_count` | Number of results returned, before the cap below                        |
| `results`      | Top 20 results: `rank`, `note_id`, `file_path`, `score`, `match_source` |
| `latency_ms`   | Wall time from the start of the search to the final ranked list         |

## Outcome (which result was used)

Not recorded as part of the event. Brain cannot tell reliably which result a caller acted
on. The session capture hooks already log later tool calls (`tool:Read`, MCP
`brain_note_read`) with their inputs, so an eval can join those against `note_id` or
`file_path` in the same session to estimate it.

## Reading events back

`BrainServiceClass.sessionEvents(displayId)` (HTTP `GET /api/sessions/:id/events`) returns
all events for a session, including search events.
