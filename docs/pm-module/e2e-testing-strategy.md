# E2E Testing Strategy for PM Module

## Problem

The PM module has over 1,000 unit and integration tests covering CLI commands, database
operations, and orchestration logic. However, zero tests involve actual Claude Code agent
interaction. This leaves the following behaviors untested:

- **Hook firing**: Do `SessionStart`, `PreToolUse`, and `SubagentStop` hooks actually execute?
- **Skill loading**: Does the `orchestrator` skill load and activate correctly?
- **Orchestration flow**: Does the agent follow the skill's dispatch protocol end-to-end?
- **Environment propagation**: Does `BRAIN_PM_ORCHESTRATE=1` propagate into the session?

The three hook scripts installed by `install-hooks.ts` represent the integration surface:

| Hook script | Event | Purpose |
|---|---|---|
| `brain-pm-session.sh` | `SessionStart` | Detect active project, set env, call `orchestrate session-start` |
| `brain-pm-worktree.sh` | `PreToolUse` | Guard worktree operations when `BRAIN_PM_WORKTREE` is set |
| `brain-pm-agent-done.sh` | `SubagentStop` | Call `orchestrate agent-done` to handle subagent completion |

Any E2E strategy must validate that these hooks fire under the correct conditions and that
the skill interprets the resulting state correctly.

---

## Approaches Evaluated

### 1. `claude -p` Headless CLI Mode

The `-p` (print) flag runs Claude non-interactively. All standard Claude Code settings are
loaded from `~/.claude/settings.json`, which is exactly where `brain pm install-hooks`
writes its hook entries.

**Confirmed capabilities:**
- Loads hooks from `~/.claude/settings.json` — hooks fire in `-p` mode by default
- `--allowedTools` restricts tool surface to safe operations (e.g., `Read,Bash(brain *)`)
- `--max-budget-usd <amount>` caps per-invocation spend (print mode only)
- `--max-turns <n>` caps agent iterations before exit
- `--model` selects model (aliases: `sonnet`, `haiku`, or full model ID)
- `--output-format json` returns structured output including `cost_usd`, `session_id`, `result`
- `--output-format stream-json` with `--verbose` exposes every tool call as a JSON event
- `--setting-sources user,project` controls which settings files are loaded
- Skills from `~/.claude/skills/` are loaded automatically when `SessionStart` fires

**Key limitation — skill invocation in `-p` mode:** The docs explicitly note that
user-invoked skills (slash commands like `/orchestrator`) are only available in interactive
mode. However, the `orchestrator` skill is loaded passively via the `SessionStart` hook
setting `BRAIN_PM_ORCHESTRATE=1` — it is context, not a slash command. The hook still fires.

**Key limitation — hooks confirmed to fire:** GitHub issue #7535 (closed) is a feature
request to add in-process hooks to CLI mode, which confirms that shell-command hooks
(the kind `install-hooks.ts` writes) do fire in headless mode. The request was about
performance overhead, not absence of hook execution.

**What `-p` mode cannot do:** It cannot assert on tool-call sequences without parsing
`stream-json` output manually. There is no built-in "verify Claude called X before Y"
assertion layer.

**Example test pattern:**
```bash
# Validate SessionStart hook fires and session-start orchestration runs
output=$(echo "List current tasks" | claude -p \
  --max-budget-usd 0.10 \
  --max-turns 3 \
  --model haiku \
  --allowedTools "Bash(brain pm *),Read" \
  --output-format json)

cost=$(echo "$output" | jq -r '.cost_usd')
result=$(echo "$output" | jq -r '.result')
# Assert cost is within budget and result mentions tasks
```

---

### 2. Agent SDK (`@anthropic-ai/claude-agent-sdk`)

The TypeScript SDK (`@anthropic-ai/claude-agent-sdk`) provides programmatic agent control
with in-process hooks, structured message streaming, and per-message metadata.

**Confirmed capabilities:**
- `settingSources: ['project']` loads skills from `.claude/skills/` and project `CLAUDE.md`
- In-process hook callbacks (`PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`, etc.) run
  as TypeScript functions — far lower overhead than shell hooks
- Each `message` in the async iterator exposes `type`, `tool_use`, `tool_input`, and
  `parent_tool_use_id` for trace inspection
- Subagent messages carry `parent_tool_use_id` linking them to the spawning `Task` call
- Per-turn cost available via usage metadata

**Key limitation — global settings not loaded:** The SDK does not load `~/.claude/settings.json`
by default. It uses `settingSources` to control which configuration files are loaded. This
means the hook scripts installed by `brain pm install-hooks` (shell scripts registered in
the global settings file) will not execute automatically. You would need to re-register
equivalent in-process hooks programmatically.

**Key limitation — skill loading:** Skills are loaded from `.claude/skills/` relative to
the working directory when `settingSources: ['project']` is set. The `orchestrator` skill
lives in `~/.claude/skills/orchestrator/SKILL.md` (user-scope), not project-scope. Loading
it would require either pointing the working directory at `~/.claude` or copying the skill
into the test project.

**What the SDK does well:** It is the right tool for testing the *orchestration logic* —
whether the agent, given the skill context, calls the right `brain pm` commands in the
right order. Hook callbacks can assert on every tool invocation without spawning shell
processes.

**Example test pattern:**
```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const toolCalls: string[] = [];
const messages = query({
  prompt: 'List my current tasks',
  options: {
    allowedTools: ['Bash'],
    hooks: {
      PostToolUse: [{
        matcher: 'Bash',
        hooks: [async (input) => {
          toolCalls.push((input as any).tool_input?.command ?? '');
          return {};
        }]
      }]
    }
  }
});

for await (const msg of messages) { /* drain */ }
assert(toolCalls.some(c => c.includes('brain pm briefing')));
```

---

### 3. Promptfoo Integration

Promptfoo is an evaluation framework that supports `anthropic:claude-agent-sdk` as a
provider, enabling YAML-configured assertion-based tests across multiple prompts.

**Confirmed capabilities:**
- Provider: `anthropic:claude-agent-sdk` with `working_dir`, `max_turns`, `permission_mode`
- `context.providerResponse?.metadata?.toolCalls` exposes tool call trace for assertions
- JavaScript assertion functions can check which tools were called and in what order
- Supports `llm-rubric` assertions (LLM-as-judge) for evaluating response quality
- Skills enabled via `setting_sources: ['project']` and `append_allowed_tools: ['Skill']`
- Built-in CI integration via `promptfoo eval` command and GitHub Action

**Key limitation — same SDK constraints apply:** Because Promptfoo wraps the Agent SDK,
it shares the same limitations: global `~/.claude/settings.json` hooks do not fire, and
user-scope skills require explicit configuration.

**Key limitation — cost per eval run:** Each test case invokes a live agent. A suite of
10 YAML test cases with `haiku` could cost $0.05–$0.50 per run. This must be gated in CI.

**Key limitation — maturity:** The `claude-agent-sdk` provider is relatively new. Skill
testing support specifically (via `setting_sources`) was documented but may have edge cases.

**Example config:**
```yaml
providers:
  - id: anthropic:claude-agent-sdk
    config:
      model: claude-haiku-4
      max_turns: 5
      working_dir: /tmp/brain-test
      permission_mode: acceptEdits

tests:
  - description: SessionStart triggers briefing command
    vars:
      prompt: Show me my current tasks
    assert:
      - type: javascript
        value: |
          context.providerResponse?.metadata?.toolCalls
            ?.some(c => c.name === 'Bash' && c.input?.command?.includes('brain pm briefing'))
```

---

### 4. CLI Pipeline Testing (No Agent)

Standard shell-level integration tests of `brain pm` subcommands using Bash or a test
runner like `bats`. No agent invocation, no API cost.

**Confirmed capabilities:**
- Validates the full CLI pipeline: argument parsing, database reads, JSON output shape
- Can test `brain pm install-hooks --dry-run` output
- Can verify hook script content matches expected strings
- Can test that `brain pm orchestrate session-start` returns correct JSON given a seeded DB
- Fast, free, deterministic — suitable for every CI run

**What CLI tests cannot do:** They cannot verify agent behavior. They test the *tools*
the agent calls, not that the agent calls them correctly.

---

## Comparison Matrix

| Capability | `claude -p` | Agent SDK | Promptfoo | CLI Tests |
|---|---|---|---|---|
| Shell hooks fire (`SessionStart`, etc.) | Yes | No (must re-implement) | No (must re-implement) | N/A |
| Skill loaded from `~/.claude/skills/` | Yes | With config | With config | N/A |
| Assert on tool call sequence | Manual (stream-json) | Yes (callbacks) | Yes (YAML assertions) | N/A |
| Trace subagent calls | Manual (stream-json) | Yes (`parent_tool_use_id`) | Limited | N/A |
| Cost control | `--max-budget-usd` | Per-turn metadata | `max_turns` config | Free |
| CI-friendly | Yes (exit codes) | Yes (TypeScript test) | Yes (`promptfoo eval`) | Yes |
| Deterministic | No | No | No | Yes |
| Setup complexity | Low | Medium | Medium | Low |
| Hook script validation | Yes (hooks fire) | No | No | Partial (dry-run) |

---

## Recommendation

### Tier 1 — CLI Pipeline Tests (implement now, zero cost)

Write Vitest integration tests that exercise every `brain pm` command's JSON output,
error paths, and edge cases. These already exist but should be expanded to cover:
- `brain pm install-hooks --dry-run` output correctness
- `brain pm orchestrate session-start` with various DB states
- `brain pm orchestrate route` and `render` with mocked task data

This is free, fast, and provides regression coverage for the tools the agent calls.

### Tier 2 — `claude -p` Smoke Tests (implement next, low cost)

A small set of end-to-end smoke tests using `claude -p` that validate the installed hooks
actually fire and produce expected side effects. These require a real API key and a seeded
local `brain` database.

Target: 3–5 test scenarios, each capped at `--max-budget-usd 0.05` and `--max-turns 5`
using `--model haiku`. Parse `--output-format json` to assert `cost_usd` is within budget
and the response contains expected content. Run only on explicit `npm run test:e2e` invocation,
never in the default CI pipeline.

### Tier 3 — Agent SDK Assertion Tests (implement when Tier 2 is stable)

Replace the ad-hoc `stream-json` parsing with structured Agent SDK tests. These provide
precise tool-call sequence assertions without shell parsing. Use in-process hook callbacks
to capture the full tool trace and assert ordering: `brain pm briefing` before
`brain pm next`, for example.

Because the SDK does not load global settings hooks automatically, Tier 3 tests validate
the *skill logic and agent behavior* separately from the *hook installation*. Both layers
need testing; they are complementary.

Promptfoo is optional at this tier — it adds a YAML-driven regression suite useful for
tracking behavior across model upgrades, but adds tooling complexity. Adopt it if the
number of eval scenarios grows beyond 10.

---

## Implementation Plan

**Task 11 — CLI Pipeline Test Expansion:** Add missing Vitest integration tests for
`orchestrate session-start`, `orchestrate route`, and `orchestrate render`. Validate JSON
schemas and edge cases. No API cost.

**Task 12 — Smoke Test Harness:** Create `scripts/test-e2e.sh` that:
1. Seeds a temp brain database with a test project and tasks
2. Runs `brain pm install-hooks` pointing at a temp `~/.claude` directory
3. Invokes `claude -p` with `--setting-sources` pointing at the temp directory,
   `--max-budget-usd 0.05`, `--model haiku`, `--output-format json`
4. Asserts the JSON output contains expected task mentions
5. Tears down the temp directory

Gate this script behind `RUN_E2E_TESTS=1` so it never runs in default CI.
