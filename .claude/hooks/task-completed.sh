#!/usr/bin/env bash
# claude/hooks/task-completed.sh
# Called when a task is marked complete. Enforces DoD.
set -euo pipefail

# If agent has a specific DoD spec, use it
if [ -n "${AO_AGENT_ID:-}" ]; then
  AGENT_DIR=".claude/ao/agents/$AO_AGENT_ID"
  if [ -f "$AGENT_DIR/agent.yaml" ]; then
    DOD_SPEC=$(grep 'dodSpec:' "$AGENT_DIR/agent.yaml" | awk '{print $2}' | tr -d '"' | tr -d "'")
    if [ -n "$DOD_SPEC" ] && [ -f "$DOD_SPEC" ]; then
      ao check-dod --spec "$DOD_SPEC"
      exit $?
    fi
  fi
fi

ao check-dod

# Session commit (non-blocking — runs in background after DoD passes)
if command -v brain >/dev/null 2>&1; then
  (brain session commit 2>/dev/null &)
fi
