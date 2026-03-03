#!/usr/bin/env bash
# claude/hooks/task-completed.sh
# Called when a task is marked complete. Enforces DoD.
set -euo pipefail
ao check-dod
