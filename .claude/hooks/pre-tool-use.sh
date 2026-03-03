#!/usr/bin/env bash
# claude/hooks/pre-tool-use.sh
# Called on every Write/Edit tool call. Pipes hook JSON to ao check-ownership.
set -euo pipefail
ao check-ownership
