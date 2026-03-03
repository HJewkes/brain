#!/usr/bin/env bash
set -euo pipefail

# Shared quality checks — single source of truth for CI and pre-push hook.
# Usage: ./scripts/check.sh [--quick]
#   --quick  Skip tests (lint + format + typecheck + build only)

QUICK=false
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=true ;;
  esac
done

echo "── Lint ──────────────────────────────────────"
npm run lint

echo "── Format ────────────────────────────────────"
npm run format:check

echo "── Typecheck ─────────────────────────────────"
npm run typecheck

echo "── Build ───────────────────────────────────────"
npm run build
test -f dist/cli.js || { echo "Build output missing"; exit 1; }

if [ "$QUICK" = false ]; then
  echo "── Test ────────────────────────────────────────"
  npx vitest run --exclude '__tests__/eval/**' --exclude '__tests__/adapters/local-embedder.test.ts'
fi

echo "── All checks passed ─────────────────────────"
