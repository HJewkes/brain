#!/usr/bin/env bash
# claude/hooks/user-prompt-submit.sh
# Called when user submits a prompt. Dispatches through brain hook registry.
set -euo pipefail
brain hook dispatch prompt-submit
