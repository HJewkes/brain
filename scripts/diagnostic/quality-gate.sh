#!/usr/bin/env bash
set -euo pipefail

# Diagnostic Quality Gate — runs after setup, before test bench
# Validates that setup agent produced high-quality data
# Usage: quality-gate.sh [--skip]

if [[ "${1:-}" == "--skip" ]]; then
  echo "  Quality gate SKIPPED (--skip flag)"
  exit 0
fi

echo "  Running data quality gate..."

FAILURES=0

# Check: every task has a non-empty body
TASK_JSON=$(brain pm task list --json --full 2>/dev/null || echo '[]')
TASK_COUNT=$(echo "$TASK_JSON" | jq 'length')

if [[ "$TASK_COUNT" -eq 0 ]]; then
  echo "  FAIL: No tasks found"
  exit 1
fi

# Check empty descriptions
EMPTY_DESC=$(echo "$TASK_JSON" | jq '[.[] | select(.description == null or .description == "" or (.description | length) < 20)] | length')
if [[ "$EMPTY_DESC" -gt 0 ]]; then
  echo "  FAIL: ${EMPTY_DESC}/${TASK_COUNT} tasks have empty or trivial descriptions"
  ((FAILURES++))
fi

# Check: at least 2 distinct categories
CATEGORY_COUNT=$(echo "$TASK_JSON" | jq '[.[].category] | unique | length')
if [[ "$CATEGORY_COUNT" -lt 2 ]]; then
  echo "  FAIL: Only ${CATEGORY_COUNT} distinct category(ies) — need at least 2"
  ((FAILURES++))
fi

# Check: at least 1 low priority task
LOW_COUNT=$(echo "$TASK_JSON" | jq '[.[] | select(.priority == "low")] | length')
if [[ "$LOW_COUNT" -eq 0 ]]; then
  echo "  WARN: No low-priority tasks — priority range underutilized"
fi

# Check: depends_on is always an array (not null/missing)
NULL_DEPS=$(echo "$TASK_JSON" | jq '[.[] | select(.depends_on == null)] | length')
if [[ "$NULL_DEPS" -gt 0 ]]; then
  echo "  FAIL: ${NULL_DEPS}/${TASK_COUNT} tasks have null depends_on (should be [])"
  ((FAILURES++))
fi

if [[ "$FAILURES" -gt 0 ]]; then
  echo "  Quality gate FAILED (${FAILURES} check(s))"
  echo "  Use --skip-quality-gate to bypass"
  exit 1
else
  echo "  Quality gate PASSED (${TASK_COUNT} tasks, ${CATEGORY_COUNT} categories)"
fi
