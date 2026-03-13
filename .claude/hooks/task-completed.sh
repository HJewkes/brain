#!/usr/bin/env bash
# claude/hooks/task-completed.sh
# Called when a task is marked complete. Dispatches through brain hook registry.
set -euo pipefail
brain hook dispatch task-completed

# Session commit (non-blocking — runs in background after DoD passes)
if command -v brain >/dev/null 2>&1; then
  (brain session commit 2>/dev/null &)
fi
