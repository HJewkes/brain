#!/usr/bin/env bash
# claude/hooks/pre-compact.sh
# Called before context compaction. Saves session summary to brain.
# Fast path: HTTP to brain serve (~5ms). Fallback: CLI spawn (~200ms built).

INPUT=$(cat)

RESPONSE=$(echo "$INPUT" | curl -s -m 1 -w "%{http_code}" \
  -X POST http://localhost:7800/api/hooks/pre-compact \
  -H 'Content-Type: application/json' \
  -d @- 2>/dev/null)
HTTP_CODE="${RESPONSE: -3}"
BODY="${RESPONSE:0:${#RESPONSE}-3}"

if [ "$HTTP_CODE" = "200" ]; then
  STDOUT=$(echo "$BODY" | command -p python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('stdout',''),end='')" 2>/dev/null || true)
  [ -n "$STDOUT" ] && echo "$STDOUT"
  exit 0
elif [ "$HTTP_CODE" = "202" ]; then
  STDERR=$(echo "$BODY" | command -p python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('stderr',''),end='')" 2>/dev/null || true)
  [ -n "$STDERR" ] && echo "$STDERR" >&2
  exit 2
fi

# Fallback: spawn CLI process
echo "$INPUT" | brain hook dispatch pre-compact
