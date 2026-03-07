#!/usr/bin/env bash
set -euo pipefail

# PM Diagnostic Automation — Orchestrator
# Usage: ./scripts/diagnostic/run.sh <version> [options]
#   --skip-setup       Skip reset/build/onboarding (re-run tests only)
#   --phase <name>     Run only: test-bench, audits, assemble, observations
#   --concurrency <n>  Parallel test agents (default: 6)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$PROJECT_DIR"
WORKSPACE_DIR="${WORKSPACE_DIR:-${PWD}}"

VERSION="${1:?Usage: run.sh <version> [--skip-setup] [--phase <name>] [--concurrency <n>]}"
shift

SKIP_SETUP=false
SKIP_QUALITY_GATE=false
PHASE="all"
CONCURRENCY=6

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-setup) SKIP_SETUP=true; shift ;;
    --skip-quality-gate) SKIP_QUALITY_GATE=true; shift ;;
    --phase) PHASE="$2"; shift 2 ;;
    --concurrency) CONCURRENCY="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

RESULTS_DIR="docs/pm-module/diagnostic/${VERSION}"
PROMPTS_DIR="docs/pm-module/diagnostic/prompts"
SCHEMA_FILE="scripts/diagnostic/schema.json"

# Compute previous version for delta comparison
VERSION_NUM="${VERSION#v}"
PREV_NUM=$((VERSION_NUM - 1))
PREVIOUS_VERSION="v${PREV_NUM}"

SETUP_SESSION_LOG=""

mkdir -p "${RESULTS_DIR}/test-bench"

echo "═══════════════════════════════════════════════"
echo "  PM Diagnostic — ${VERSION}"
echo "  Phase: ${PHASE}"
echo "  Skip setup: ${SKIP_SETUP}"
echo "  Concurrency: ${CONCURRENCY}"
echo "  Results: ${RESULTS_DIR}/"
echo "═══════════════════════════════════════════════"

apply_template() {
  local file="$1"
  sed \
    -e "s|{{VERSION}}|${VERSION}|g" \
    -e "s|{{RESULTS_DIR}}|${RESULTS_DIR}|g" \
    -e "s|{{PREVIOUS_VERSION}}|${PREVIOUS_VERSION}|g" \
    "$file"
}

run_agent() {
  local prompt_file="$1"
  local output_file="${2:-}"
  local model="${3:-sonnet}"
  local extra_flags="${4:-}"

  local prompt
  prompt="$(apply_template "$prompt_file")"

  local cmd=(
    env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT
        -u CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY
        -u CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
        -u CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
    claude -p
    --model "$model"
    --permission-mode bypassPermissions
    --no-session-persistence
    --setting-sources user
  )

  if [[ -n "$extra_flags" ]]; then
    # shellcheck disable=SC2206
    cmd+=($extra_flags)
  fi

  if [[ -n "$output_file" ]]; then
    "${cmd[@]}" "$prompt" > "$output_file"
  else
    "${cmd[@]}" "$prompt"
  fi
}

# ── Phase 0: Reset & Build ──────────────────────────

run_setup() {
  echo ""
  echo "── Phase 0: Reset & Build ──────────────────────"

  echo "Building..."
  npm run build --silent

  echo "Resetting brain..."
  (cd /tmp && npx tsx "$PROJECT_DIR/src/cli.ts" reset --confirm)

  echo "Linking..."
  npm link --silent

  echo "Initializing brain..."
  # Run from /tmp to avoid local .brain/ instance resolution
  (cd /tmp && brain init --notes-dir ~/brain --embedder local)

  echo "Ingesting command reference docs..."
  for doc in docs/pm-module/commands/*.md; do
    (cd /tmp && brain add "$PROJECT_DIR/$doc" --type guide --tier fast 2>/dev/null) || true
  done

  echo "Spawning setup agent (with session persistence)..."
  local prompt
  prompt="$(apply_template "${PROMPTS_DIR}/setup.md")"

  (cd "$WORKSPACE_DIR" && env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT \
    -u CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY \
    -u CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC \
    -u CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS \
    claude -p \
    --model sonnet \
    --permission-mode bypassPermissions \
    --no-session-persistence \
    --setting-sources user \
    "$prompt")

  # Find the session log written by the setup agent
  local project_hash_dir
  project_hash_dir=$(ls -dt ~/.claude/projects/*/ 2>/dev/null | head -1)
  if [[ -n "$project_hash_dir" ]]; then
    SETUP_SESSION_LOG=$(ls -t "${project_hash_dir}"*.jsonl 2>/dev/null | head -1)
    if [[ -n "$SETUP_SESSION_LOG" ]]; then
      echo "  Setup session log: ${SETUP_SESSION_LOG}"
    else
      echo "  WARNING: No session log found in ${project_hash_dir}"
    fi
  fi

  echo "Setup complete."
}

# ── Phase 1-3: Audits ───────────────────────────────

run_audits() {
  echo ""
  echo "── Phase 1-3: Audits (parallel) ────────────────"

  local pids=()
  for audit in data-audit gap-analysis; do
    echo "  Spawning ${audit} agent..."
    run_agent \
      "${PROMPTS_DIR}/${audit}.md" \
      "${RESULTS_DIR}/${audit}.md" \
      sonnet &
    pids+=($!)
  done

  # Session audit runs separately — needs setup session log path
  if [[ -n "${SETUP_SESSION_LOG:-}" ]]; then
    echo "  Spawning session-audit agent..."
    local prompt
    prompt="$(apply_template "${PROMPTS_DIR}/session-audit.md")"
    prompt="${prompt//\{\{SETUP_SESSION_LOG\}\}/${SETUP_SESSION_LOG}}"

    local cmd=(
      env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT
          -u CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY
          -u CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
          -u CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
      claude -p
      --model sonnet
      --permission-mode bypassPermissions
      --no-session-persistence
      --setting-sources user
    )
    "${cmd[@]}" "$prompt" > "${RESULTS_DIR}/session-audit.md" &
    pids+=($!)
  else
    echo "  SKIP: session-audit (no setup session log available)"
  fi

  echo "  Waiting for ${#pids[@]} audit agents..."
  local failed=0
  for pid in "${pids[@]}"; do
    if ! wait "$pid"; then
      ((failed++))
    fi
  done

  if [[ $failed -gt 0 ]]; then
    echo "  WARNING: ${failed} audit agent(s) failed"
  else
    echo "  All audits complete."
  fi
}

# ── Phase 4: Test Bench ─────────────────────────────

run_test_bench() {
  echo ""
  echo "── Phase 4: Test Bench (${CONCURRENCY} concurrent) ──────"

  local total=0
  local failed=0
  local pids=()
  local next_i=1

  # Launch agents in waves of $CONCURRENCY
  while [[ $next_i -le 30 ]]; do
    local wave_pids=()
    local wave_count=0

    while [[ $next_i -le 30 && $wave_count -lt $CONCURRENCY ]]; do
      local num
      num=$(printf "%02d" "$next_i")
      local prompt_file="${PROMPTS_DIR}/test-bench/P-${num}.md"
      local output_file="${RESULTS_DIR}/test-bench/P-${num}.json"
      ((next_i++))

      if [[ ! -f "$prompt_file" ]]; then
        echo "  SKIP: ${prompt_file} not found"
        continue
      fi

      run_agent "$prompt_file" "$output_file" sonnet "--output-format json" &
      local pid=$!
      echo "  Started P-${num} (pid ${pid})"
      wave_pids+=("$pid")
      ((total++))
      ((wave_count++))
    done

    # Wait for entire wave to finish
    for pid in "${wave_pids[@]}"; do
      if ! wait "$pid"; then
        ((failed++))
      fi
    done
    echo "  Wave complete (${wave_count} agents)"
  done

  echo "  Test bench complete: ${total} prompts, ${failed} failures"
}

# ── Phase 4b: Assemble ──────────────────────────────

run_assemble() {
  echo ""
  echo "── Phase 4b: Assemble Results ──────────────────"

  npx tsx scripts/diagnostic/assemble.ts \
    --version "$VERSION" \
    --previous "$PREVIOUS_VERSION" \
    --results-dir "$RESULTS_DIR"

  echo "  Wrote ${RESULTS_DIR}/test-bench-results.md"
}

# ── Phase 5a: Observations ──────────────────────────

run_observations() {
  echo ""
  echo "── Phase 5a: Extract Observations ──────────────"

  run_agent \
    "${PROMPTS_DIR}/observations.md" \
    "${RESULTS_DIR}/observations.md" \
    sonnet

  echo "  Wrote ${RESULTS_DIR}/observations.md"
}

# ── Phase 5b: Summary ───────────────────────────────

run_summary() {
  echo ""
  echo "── Phase 5b: Generate Summary ──────────────────"

  run_agent \
    "${PROMPTS_DIR}/summary.md" \
    "${RESULTS_DIR}/summary.md" \
    sonnet

  echo "  Wrote ${RESULTS_DIR}/summary.md"
}

# ── Execute ─────────────────────────────────────────

case "$PHASE" in
  all)
    if [[ "$SKIP_SETUP" == false ]]; then
      run_setup
    fi
    echo ""
    echo "── Quality Gate ─────────────────────────────────"
    if [[ "$SKIP_QUALITY_GATE" == true ]]; then
      bash "${SCRIPT_DIR}/quality-gate.sh" --skip
    else
      bash "${SCRIPT_DIR}/quality-gate.sh"
    fi
    run_audits
    run_test_bench
    run_assemble
    echo ""
    echo "── Phase 5: Observations + Summary (parallel) ──"
    run_observations &
    pid_obs=$!
    run_summary &
    pid_sum=$!
    wait "$pid_obs" "$pid_sum"

    echo ""
    echo "── Ingesting diagnostic outputs ──────────────"
    (cd /tmp && brain add "$PROJECT_DIR/${RESULTS_DIR}/summary.md" --type note --tier fast 2>/dev/null) || echo "  SKIP: summary.md ingest failed"
    (cd /tmp && brain add "$PROJECT_DIR/${RESULTS_DIR}/gap-analysis.md" --type note --tier fast 2>/dev/null) || echo "  SKIP: gap-analysis.md ingest failed"
    echo "  Diagnostic outputs ingested for future reference."
    ;;
  test-bench)
    run_test_bench
    run_assemble
    ;;
  audits)
    run_audits
    ;;
  assemble)
    run_assemble
    ;;
  observations)
    run_observations
    run_summary
    ;;
  *)
    echo "Unknown phase: ${PHASE}"
    echo "Valid phases: all, test-bench, audits, assemble, observations"
    exit 1
    ;;
esac

echo ""
echo "═══════════════════════════════════════════════"
echo "  Diagnostic ${VERSION} complete"
echo "  Results: ${RESULTS_DIR}/"
echo "  Review:  ${RESULTS_DIR}/summary.md"
echo "═══════════════════════════════════════════════"
