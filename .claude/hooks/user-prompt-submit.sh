#!/usr/bin/env bash
# claude/hooks/user-prompt-submit.sh
# Called when user submits a prompt. Checks workspace and WIP.
set -euo pipefail
ao check-workspace
ao check-wip
