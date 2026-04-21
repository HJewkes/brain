# Advisor MCP Tool Design

**Task**: VNM-45.30
**Date**: 2026-04-11
**Status**: Design complete

## Overview

The advisor tool lets a coordinator agent (running Sonnet/Haiku) consult Opus for strategic guidance mid-loop. VNM-45.31 shipped the focused-question mode (`brain_advisor_ask`). This design covers the full-review mode and resolves remaining design decisions.

## Two Modes

### Mode 1: Focused Question (`brain_advisor_ask` — shipped)

Already implemented in `src/server/advisor.ts`. Coordinator sends a question + curated context, Opus answers concisely. Max 500 tokens default. Low cost (~$0.02–0.05 per call).

**When to use**: Before spawning agents, when encountering conflicts, quick go/no-go decisions.

### Mode 2: Full Review (`brain_advisor_review` — new)

Coordinator sends a structured state summary and asks Opus to produce strategic feedback, course corrections, or a revised plan. Higher token budget (2000 default). Used at key decision points.

**When to use**: Wave boundaries, error recovery, completion review, mid-dispatch health checks.

## Tool Schema: `brain_advisor_review`

```typescript
server.tool('brain_advisor_review', {
  // What the coordinator wants reviewed
  review_type: z.enum([
    'wave_plan',       // Review wave assignment before dispatch
    'wave_result',     // Assess wave outcome, suggest next steps
    'error_recovery',  // Advise on failures / blocked tasks
    'completion',      // Final review before marking work done
  ]),

  // Structured state — coordinator assembles this
  state: z.object({
    workstream: z.string().optional(),
    wave: z.number().optional(),
    tasks: z.array(z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      outcome: z.string().optional(),  // for wave_result
    })).optional(),
    failures: z.array(z.object({
      taskId: z.string(),
      error: z.string(),
    })).optional(),
    cost_so_far_usd: z.number().optional(),
    notes: z.string().optional(),  // freeform context
  }),

  max_tokens: z.number().optional(),  // default 2000
})
```

**Response format**: Structured JSON with severity and action items.

```typescript
interface AdvisorReviewResponse {
  summary: string;           // 1-2 sentence assessment
  severity: 'ok' | 'warn' | 'critical';
  items: Array<{
    action: string;          // What to do
    rationale: string;       // Why
    priority: 'high' | 'medium' | 'low';
    affects?: string[];      // Task IDs affected
  }>;
  revised_plan?: string;     // Only if approach needs changing
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    durationMs: number;
  };
}
```

## Design Decisions

### 1. Context Assembly

**Decision**: Coordinator assembles context, not the tool.

The coordinator knows what's relevant. The tool receives pre-assembled context — it doesn't query the DB or run brain searches itself. This keeps the advisor stateless and composable.

For focused mode: coordinator passes a `context` string (freeform).
For full review: coordinator passes a structured `state` object with typed fields.

The coordinator can build state from:
- `brain_pm_task_list` / `brain_pm_wave` for task/wave state
- `brain_pm_overview` for project-level context
- `brain_agent_activity` for cost and agent status
- Direct git/CI output for verification results

**Rationale**: The advisor doesn't need DB access. Passing context explicitly means (a) the coordinator can curate what matters, (b) the advisor module stays decoupled from PM internals, (c) we can test the advisor with synthetic state.

### 2. Invocation Mechanism

**Decision**: Shell out to `claude -p` (keep existing pattern from VNM-45.31).

Pros:
- Already working in `src/server/advisor.ts`
- Handles authentication, model routing, output formatting
- Permission-mode sandboxing (`--plan`) prevents advisor from taking actions
- JSON output format gives structured cost/token metrics for free

Cons:
- ~2s startup overhead per call (process spawn + model load)
- No streaming — coordinator blocks until response is complete

Direct API calls would eliminate startup overhead but require managing API keys, retry logic, and response parsing that the CLI already handles. The 2s overhead is acceptable for a tool called 2-4 times per wave, not per task.

**Future option**: If advisor latency becomes a bottleneck, add a `--fast` flag or switch to direct API. The `askAdvisor()` function signature stays the same — only the internals change.

### 3. Response Format

**Decision**: Mode-dependent.

- **Focused question**: Free text (enumerated steps/bullets). The coordinator parses what it needs. Keeping this lightweight is important — most calls are quick checks.
- **Full review**: Structured JSON (summary + severity + action items). The coordinator can branch on `severity`, iterate `items`, and log them. The system prompt instructs Opus to return valid JSON.

The full-review system prompt includes a JSON schema example so Opus produces parseable output. Fallback: if JSON parsing fails, return the raw text as `summary` with `severity: 'warn'`.

### 4. Cost Tracking

**Decision**: Integrate with existing cost-aggregation module.

Each advisor call returns `usage: { costUsd, inputTokens, outputTokens, durationMs }` (already shipped in VNM-45.31). The coordinator should:

1. Log advisor cost to stderr for immediate visibility.
2. Store advisor calls as agent context entries under a synthetic "advisor" agent ID, so `aggregateByWorkstream()` picks them up.
3. Include advisor cost in the `cost_so_far_usd` field when calling `brain_advisor_review`, giving the advisor cost-awareness.

No new cost tracking infrastructure needed — the existing `AgentCostEntry` pattern handles it. The coordinator accumulates advisor costs across the dispatch session and includes them in wave summaries.

### 5. Caching

**Decision**: No caching. Each call gets fresh advice.

Reasons:
- Advisor calls are infrequent (2-4 per wave, not per task)
- Context changes between calls (tasks complete, failures occur)
- The key insight from Anthropic's advisor pattern is that the first call is most valuable — caching would only help if the same question is asked twice with identical context, which shouldn't happen
- Cache invalidation complexity isn't worth it for ~$0.10/wave in advisor costs

If repeated calls with near-identical context become a pattern, add a simple content-hash dedup at the coordinator level (compare SHA-256 of question+context, skip if seen in last 5 minutes). This belongs in the coordinator logic, not the tool.

## Integration with Dispatch Infrastructure

### Recommended Cadence

```
executeWave(wave):
  ┌─ brain_advisor_ask: "Should I proceed with this wave?" + wave summary
  │  (gate: if severity=critical, pause and escalate)
  │
  ├─ spawn agents (existing flow)
  ├─ waitForAgent() per task (existing flow)
  │
  ├─ brain_advisor_review(type='wave_result'): task outcomes + failures
  │  (decide: retry failures? adjust next wave? escalate?)
  │
  └─ deliverAndCleanup() (existing flow)
```

### Coordinator Template Changes

The dispatch coordinator template (`src/modules/workflow/templates/`) should include advisor tool usage instructions:

1. **Wave start**: Call `brain_advisor_ask` with wave assignment summary. Ask: "Should I proceed with this wave given [context]?" If the advisor says no, pause and report to the user.
2. **Error recovery**: When >30% of wave tasks fail, call `brain_advisor_review(type='error_recovery')` before retrying. The advisor can spot systemic issues (shared dependency broken, wrong base branch, etc).
3. **Wave end**: Call `brain_advisor_review(type='wave_result')` with outcomes. Use the severity rating to decide whether to proceed to the next wave or pause for human review.
4. **Session end**: Call `brain_advisor_review(type='completion')` with full session summary. Include in the session briefing for next time.

### Cost Budget

At ~$0.03/focused + ~$0.10/review, a 6-wave dispatch with 2 advisor calls per wave costs ~$0.78 in advisor fees. This is <5% of total dispatch cost (typically $15-25 for a full wave set). Acceptable.

## Implementation Plan

1. **VNM-45.31** (shipped): `brain_advisor_ask` focused question mode
2. **Next**: Add `brain_advisor_review` to `registerAdvisorTools()` in `mcp.ts`
   - New system prompt for structured review output
   - JSON parsing with fallback in `advisor.ts`
   - `review_type`-specific prompt templates
3. **Next**: Update coordinator dispatch template to include advisor call instructions
4. **Next**: Add advisor cost entries to agent context storage

## Files to Modify

| File | Change |
|------|--------|
| `src/server/advisor.ts` | Add `reviewAdvisor()` function, review system prompt, response parsing |
| `src/server/mcp.ts` | Add `brain_advisor_review` tool registration |
| `src/modules/workflow/templates/dispatch-*.md` | Add advisor usage instructions to coordinator prompts |

## Non-Goals

- Advisor does not read the DB directly
- Advisor does not spawn agents or take actions
- No persistent advisor "memory" across calls (context is always passed in)
- No streaming — coordinator waits for complete response
- No multi-turn advisor conversations — single question/answer per call
