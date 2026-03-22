#!/usr/bin/env bash
set -euo pipefail

# Reset a demo project to scaffolding-only state for retesting the burndown system.
#
# Usage:
#   ./scripts/reset-demo-project.sh [project-dir] [pm-prefix]
#
# Defaults:
#   project-dir: ~/Documents/projects/bookmarks-demo
#   pm-prefix:   BKM
#
# What it does:
#   1. Removes all generated source code (keeps package.json, tsconfig, vitest config, backlog)
#   2. Restores cli.ts to a bare entry point
#   3. Purges PM project data (notes on disk + DB entries) and re-imports from backlog.json
#   4. Commits the clean state so agents start from a clean git baseline

BRAIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="${1:-$HOME/Documents/projects/bookmarks-demo}"
PM_PREFIX="${2:-BKM}"

BRAIN_INSTANCE="$BRAIN_DIR/.brain"
BRAIN_DB="$BRAIN_INSTANCE/brain.db"
PM_NOTES_DIR="$BRAIN_INSTANCE/notes/modules/pm/$PM_PREFIX"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "Error: project directory not found: $PROJECT_DIR"
  exit 1
fi

if [ ! -f "$PROJECT_DIR/backlog.json" ]; then
  echo "Error: backlog.json not found in $PROJECT_DIR"
  exit 1
fi

echo "==> Resetting demo project: $PROJECT_DIR ($PM_PREFIX)"

# --- Step 1: Remove generated source code ---
echo "  [1/5] Removing generated source..."
rm -rf "$PROJECT_DIR/src/commands"
rm -f "$PROJECT_DIR/src/db.ts"
rm -f "$PROJECT_DIR/src/config.ts"
rm -f "$PROJECT_DIR/src/output.ts"
rm -rf "$PROJECT_DIR/__tests__"
rm -rf "$PROJECT_DIR/dist"
find "$PROJECT_DIR" -maxdepth 1 -name "*.db" -delete 2>/dev/null || true

# --- Step 2: Restore bare cli.ts entry point ---
echo "  [2/5] Restoring bare cli.ts..."
mkdir -p "$PROJECT_DIR/src"
cat > "$PROJECT_DIR/src/cli.ts" << 'ENTRY'
#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('bookmarks')
  .description('CLI bookmark manager')
  .version('0.1.0');

// Commands will be added here as they are implemented

program.parse();
ENTRY

# --- Step 3: Purge PM notes from disk ---
echo "  [3/5] Purging PM notes for $PM_PREFIX..."
if [ -d "$PM_NOTES_DIR" ]; then
  rm -rf "$PM_NOTES_DIR"
  echo "    Removed $PM_NOTES_DIR"
else
  echo "    No PM notes directory found (already clean)"
fi

# --- Step 4: Purge PM data from brain DB and re-import ---
echo "  [4/5] Resetting task state and re-importing..."
cd "$BRAIN_DIR"

# Reset done tasks to pending via proper CLI command
DONE_IDS=$(npx tsx src/cli.ts pm task list --project "$PM_PREFIX" --status done --json 2>/dev/null \
  | python3 -c "import sys,json; [print(t['display_id']) for t in json.load(sys.stdin)]" 2>/dev/null || true)
if [ -n "$DONE_IDS" ]; then
  for task_id in $DONE_IDS; do
    npx tsx src/cli.ts pm task reset "$task_id" --force 2>/dev/null \
      && echo "    Reset $task_id" \
      || echo "    Warning: could not reset $task_id"
  done
fi

# Release claimed/in-progress tasks back to pending
ACTIVE_IDS=$(npx tsx src/cli.ts pm task list --project "$PM_PREFIX" --json 2>/dev/null \
  | python3 -c "import sys,json; [print(t['display_id']) for t in json.load(sys.stdin) if t['status'] in ('claimed','in-progress')]" 2>/dev/null || true)
if [ -n "$ACTIVE_IDS" ]; then
  for task_id in $ACTIVE_IDS; do
    npx tsx src/cli.ts pm task release "$task_id" 2>/dev/null \
      && echo "    Released $task_id" \
      || echo "    Warning: could not release $task_id"
  done
fi

# If project doesn't exist yet, import from backlog.json
TASK_COUNT=$(npx tsx src/cli.ts pm task list --project "$PM_PREFIX" --json 2>/dev/null \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [ "$TASK_COUNT" = "0" ]; then
  echo "    No existing tasks — importing from backlog.json..."
  # Purge stale DB entries if notes directory was already cleaned
  if [ -f "$BRAIN_DB" ]; then
    MATCH="metadata LIKE '%\"${PM_PREFIX}\"%'"
    sqlite3 "$BRAIN_DB" "
      DELETE FROM chunks WHERE note_id IN (SELECT id FROM notes WHERE $MATCH);
      DELETE FROM relations WHERE source_id IN (SELECT id FROM notes WHERE $MATCH) OR target_id IN (SELECT id FROM notes WHERE $MATCH);
      DELETE FROM files WHERE path IN (SELECT file_path FROM notes WHERE $MATCH);
      DELETE FROM notes WHERE $MATCH;
    " 2>/dev/null || true
  fi
  npx tsx src/cli.ts pm import --from-json "$PROJECT_DIR/backlog.json" 2>&1 | sed 's/^/    /'
fi

# Verify import
TASK_COUNT=$(npx tsx src/cli.ts pm task list --project "$PM_PREFIX" --json 2>/dev/null \
  | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
echo "    Imported $TASK_COUNT tasks"

# --- Step 5: Commit clean state ---
echo "  [5/5] Committing clean state..."
cd "$PROJECT_DIR"
git add -A
if git diff --cached --quiet; then
  echo "    Working tree already clean, nothing to commit"
else
  git commit -m "Reset project to scaffolding for burndown testing"
fi

echo ""
echo "==> Done. Project reset to bare scaffolding."
echo "    Source: $PROJECT_DIR/src/cli.ts (bare entry point)"
echo "    Backlog: $PROJECT_DIR/backlog.json (unchanged)"
echo "    Tasks: $PM_PREFIX — $TASK_COUNT tasks, all pending"
echo ""
echo "    To run a burndown: brain pm burndown run --wip-limit 3"
