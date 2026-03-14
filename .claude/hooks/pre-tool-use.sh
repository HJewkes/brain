#!/usr/bin/env bash
# claude/hooks/pre-tool-use.sh
# Called on every Write/Edit tool call. Dispatches through brain hook registry.
set -euo pipefail
brain hook dispatch pre-tool-use
