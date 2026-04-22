#!/usr/bin/env npx tsx
/**
 * Full VNM → BRN project prefix rename migration.
 *
 * The built-in `brain pm rename-prefix` handles task/workstream/project notes (302 files),
 * but leaves activity notes, PR notes, database records, and docs untouched.
 * This script orchestrates all phases.
 *
 * Phases:
 *  1. Core PM rename via `brain pm rename-prefix VNM BRN`
 *  2. Activity notes: vnm-start-* and vnm-complete-* frontmatter + filenames
 *  3. PR activity notes: pr-N.md metadata.project field
 *  4. Old VNM directory cleanup (empty subdirs + parent dir)
 *  5. Database activities table UPDATE
 *  6. Rebuild index via `brain index`
 *  7. docs/ markdown find-and-replace
 *
 * Usage:
 *   npx tsx scripts/rename-project.ts [--dry-run]
 *
 * Safeguard: commit .brain/notes/modules/pm/ to git before running.
 */

import { execSync } from "child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(fileURLToPath(import.meta.url), "../../");
const NOTES_DIR = join(ROOT, ".brain/notes");
const VNM_PM_DIR = join(NOTES_DIR, "modules/pm/VNM");
const BRN_PM_DIR = join(NOTES_DIR, "modules/pm/BRN");
const DOCS_DIR = join(ROOT, "docs");
const DB_PATH = join(ROOT, ".brain/brain.db");

const DRY_RUN = process.argv.includes("--dry-run");
const OLD = "VNM";
const NEW = "BRN";
const OLD_LOWER = OLD.toLowerCase();
const NEW_LOWER = NEW.toLowerCase();

// Matches VNM-01, VNM-01.01 in any context
const DISPLAY_ID_RE = new RegExp(`\\b${OLD}(-\\d{2}(?:\\.\\d{2})?)\\b`, "g");

function log(msg: string) {
  process.stdout.write(msg + "\n");
}

function dryLog(msg: string) {
  process.stdout.write(`[dry-run] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Phase 1: Core PM rename
// ---------------------------------------------------------------------------

function phase1CoreRename(): void {
  log("\n=== Phase 1: Core PM rename (project/workstream/task notes) ===");
  const flag = DRY_RUN ? " --dry-run" : "";
  const cmd = `npx tsx ${ROOT}src/cli.ts pm rename-prefix${flag} ${OLD} ${NEW}`;
  log(`Running: ${cmd}`);
  const output = execSync(cmd, { cwd: ROOT, encoding: "utf-8" });
  log(output);
}

// ---------------------------------------------------------------------------
// Phase 2: Activity notes (vnm-start-* and vnm-complete-*)
// ---------------------------------------------------------------------------

function rewriteActivityContent(content: string): string {
  // Rewrite frontmatter id field: vnm-start-vnm-XX → brn-start-brn-XX
  content = content.replace(
    new RegExp(`^(id:\\s*)${OLD_LOWER}-`, "m"),
    `$1${NEW_LOWER}-`
  );
  // Rewrite second occurrence of old_lower in id (e.g. brn-start-vnm-XX.XX → brn-start-brn-XX.XX)
  content = content.replace(
    new RegExp(`^(id:\\s*${NEW_LOWER}-(?:start|complete)-)(${OLD_LOWER}-)`, "m"),
    `$1${NEW_LOWER}-`
  );
  // Rewrite project field
  content = content.replace(
    new RegExp(`^(project:\\s*)${OLD}\\b`, "m"),
    `$1${NEW}`
  );
  // Rewrite task_id field
  content = content.replace(
    new RegExp(`^(task_id:\\s*)${OLD}(-\\d{2}\\.\\d{2})`, "m"),
    `$1${NEW}$2`
  );
  // Rewrite title and body: all VNM-XX.XX occurrences
  content = content.replace(DISPLAY_ID_RE, `${NEW}$1`);
  return content;
}

function computeActivityNewName(fileName: string): string {
  // vnm-start-vnm-XX.XX-<ts>.md → brn-start-brn-XX.XX-<ts>.md
  return fileName
    .replace(new RegExp(`^${OLD_LOWER}-`), `${NEW_LOWER}-`)
    .replace(new RegExp(`-${OLD_LOWER}-`), `-${NEW_LOWER}-`);
}

function phase2ActivityNotes(): void {
  log("\n=== Phase 2: Activity notes (vnm-start-*, vnm-complete-*) ===");

  if (!existsSync(VNM_PM_DIR)) {
    log("  VNM PM directory not found — Phase 1 may have already moved it, or it does not exist.");
    return;
  }

  const allFiles = readdirSync(VNM_PM_DIR, { withFileTypes: true });
  const activityFiles = allFiles
    .filter(
      (d) =>
        d.isFile() &&
        (d.name.startsWith(`${OLD_LOWER}-start-`) ||
          d.name.startsWith(`${OLD_LOWER}-complete-`))
    )
    .map((d) => d.name);

  log(`  Found ${activityFiles.length} activity notes to rename`);

  let renamed = 0;
  for (const fileName of activityFiles) {
    const oldPath = join(VNM_PM_DIR, fileName);
    const newFileName = computeActivityNewName(fileName);
    // After Phase 1, VNM dir → BRN dir; if Phase 1 already ran, write to BRN dir
    const targetDir = existsSync(BRN_PM_DIR) ? BRN_PM_DIR : VNM_PM_DIR;
    const newPath = join(targetDir, newFileName);

    const content = readFileSync(oldPath, "utf-8");
    const updated = rewriteActivityContent(content);

    if (DRY_RUN) {
      dryLog(`  ${fileName} → ${newFileName}`);
    } else {
      writeFileSync(newPath, updated, "utf-8");
      if (oldPath !== newPath) rmSync(oldPath);
      renamed++;
    }
  }

  if (!DRY_RUN) log(`  Renamed ${renamed} activity notes`);
}

// ---------------------------------------------------------------------------
// Phase 3: PR activity notes (pr-N.md)
// ---------------------------------------------------------------------------

function rewritePrContent(content: string): string {
  // Replace project: VNM inside metadata block (nested YAML)
  return content.replace(
    new RegExp(`(project:\\s*)${OLD}\\b`, "g"),
    `$1${NEW}`
  );
}

function phase3PrNotes(): void {
  log("\n=== Phase 3: PR activity notes (pr-N.md) ===");

  // After Phase 1, files should be in BRN dir; fall back to VNM dir
  const pmDir = existsSync(BRN_PM_DIR) ? BRN_PM_DIR : VNM_PM_DIR;

  if (!existsSync(pmDir)) {
    log("  PM directory not found — skipping");
    return;
  }

  const prFiles = readdirSync(pmDir, { withFileTypes: true })
    .filter((d) => d.isFile() && /^pr-\d+\.md$/.test(d.name))
    .map((d) => d.name);

  log(`  Found ${prFiles.length} PR notes to update`);

  let updated = 0;
  for (const fileName of prFiles) {
    const filePath = join(pmDir, fileName);
    const content = readFileSync(filePath, "utf-8");
    if (!content.includes(`project: ${OLD}`)) continue;

    const newContent = rewritePrContent(content);
    if (DRY_RUN) {
      dryLog(`  Update project field in ${fileName}`);
    } else {
      writeFileSync(filePath, newContent, "utf-8");
      updated++;
    }
  }

  if (!DRY_RUN) log(`  Updated ${updated} PR notes`);
}

// ---------------------------------------------------------------------------
// Phase 4: Cleanup empty VNM directory
// ---------------------------------------------------------------------------

function phase4Cleanup(): void {
  log("\n=== Phase 4: Cleanup empty VNM directory ===");

  if (!existsSync(VNM_PM_DIR)) {
    log("  VNM PM directory already gone — nothing to do");
    return;
  }

  // Remove empty task subdirs (VNM-XX.XX/)
  const entries = readdirSync(VNM_PM_DIR, { withFileTypes: true });
  const emptyDirs = entries.filter(
    (d) => d.isDirectory() && /^VNM-\d{2}\.\d{2}$/.test(d.name)
  );

  for (const dir of emptyDirs) {
    const dirPath = join(VNM_PM_DIR, dir.name);
    const contents = readdirSync(dirPath);
    if (contents.length === 0) {
      if (DRY_RUN) {
        dryLog(`  Remove empty dir: ${dirPath}`);
      } else {
        rmSync(dirPath, { recursive: true });
      }
    } else {
      log(`  WARNING: ${dir.name} is not empty (${contents.length} items) — skipping`);
    }
  }

  // Check if VNM dir itself is now empty
  const remaining = readdirSync(VNM_PM_DIR).filter((f) => f !== "." && f !== "..");
  if (remaining.length === 0) {
    if (DRY_RUN) {
      dryLog(`  Remove empty dir: ${VNM_PM_DIR}`);
    } else {
      rmSync(VNM_PM_DIR, { recursive: true });
      log("  Removed empty VNM PM directory");
    }
  } else {
    log(`  WARNING: VNM dir has ${remaining.length} remaining files — not removing`);
    if (remaining.length <= 10) log(`  Files: ${remaining.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// Phase 5: Database activities table
// ---------------------------------------------------------------------------

async function phase5DatabaseActivities(): Promise<void> {
  log("\n=== Phase 5: Database activities table ===");

  const sql = `UPDATE activities
SET note_ids = REPLACE(REPLACE(note_ids, '${OLD}-', '${NEW}-'), '"${OLD_LOWER}-', '"${NEW_LOWER}-'),
    metadata = REPLACE(metadata, '"display_id":"${OLD}-', '"display_id":"${NEW}-')
WHERE note_ids LIKE '%${OLD}%' OR metadata LIKE '%${OLD}%';`;

  if (DRY_RUN) {
    dryLog(`  Would run SQL:\n  ${sql}`);
    return;
  }

  // Use better-sqlite3 directly
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(DB_PATH);
  try {
    const result = db.prepare(sql).run();
    log(`  Updated ${result.changes} activities row(s)`);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Phase 6: Rebuild index
// ---------------------------------------------------------------------------

function phase6RebuildIndex(): void {
  log("\n=== Phase 6: Rebuild brain index ===");
  if (DRY_RUN) {
    dryLog("  Would run: brain index");
    return;
  }
  log("  Running brain index (this may take a moment)...");
  const output = execSync(`npx tsx ${ROOT}src/cli.ts index`, {
    cwd: ROOT,
    encoding: "utf-8",
  });
  log(output);
}

// ---------------------------------------------------------------------------
// Phase 7: docs/ markdown files
// ---------------------------------------------------------------------------

function findMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

function phase7DocsFiles(): void {
  log("\n=== Phase 7: docs/ markdown files ===");

  const mdFiles = findMarkdownFiles(DOCS_DIR).filter((f) => {
    const content = readFileSync(f, "utf-8");
    return DISPLAY_ID_RE.test(content);
  });

  // Reset lastIndex after test
  DISPLAY_ID_RE.lastIndex = 0;

  log(`  Found ${mdFiles.length} docs files referencing ${OLD}-XX`);

  let updated = 0;
  for (const filePath of mdFiles) {
    const content = readFileSync(filePath, "utf-8");
    const newContent = content.replace(DISPLAY_ID_RE, `${NEW}$1`);
    DISPLAY_ID_RE.lastIndex = 0;

    if (DRY_RUN) {
      const relPath = filePath.replace(ROOT, "");
      dryLog(`  Update ${relPath}`);
    } else {
      writeFileSync(filePath, newContent, "utf-8");
      updated++;
    }
  }

  if (!DRY_RUN) log(`  Updated ${updated} docs files`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function printValidationReminders(): void {
  log("\n=== Post-migration validation ===");
  log("Run these checks to confirm the rename succeeded:\n");
  log("  brain pm list                          # should show BRN - Brain (active)");
  log("  brain pm status BRN                    # should return project stats");
  log("  brain pm next BRN                      # should return next tasks");
  log("  brain search 'BRN-15'                  # should find workstream");
  log("  brain index                            # should show 0 unindexed/orphaned");
  log("");
  log("Database checks:");
  log("  SELECT COUNT(*) FROM notes WHERE id LIKE '%vnm%';      -- expect 0");
  log("  SELECT COUNT(*) FROM files WHERE path LIKE '%/VNM/%';  -- expect 0");
  log("");
  log("Memory files (manual update):");
  log("  ~/.claude/projects/-Users-hjewkes-Documents-projects-brain/memory/MEMORY.md");
  log("  ~/.claude/projects/-Users-hjewkes-Documents-projects-brain/memory/project_coherence_audit.md");
  log("  ~/.claude/projects/-Users-hjewkes-Documents-projects-brain/memory/project_dashboard_session.md");
  log("  ~/.claude/projects/-Users-hjewkes-Documents-projects-brain/memory/project_session_module_decisions.md");
  log("  ~/.claude/projects/-Users-hjewkes-Documents-projects-brain/memory/feedback_agent_nesting.md");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`${DRY_RUN ? "[DRY RUN] " : ""}VNM → BRN project prefix rename`);
  log(`Notes dir: ${NOTES_DIR}`);
  log(`DB path:   ${DB_PATH}`);
  log("");

  if (!DRY_RUN) {
    log("WARNING: This will modify ~840 note files and the database.");
    log("Recommend: git commit current state before proceeding.\n");
  }

  phase1CoreRename();
  phase2ActivityNotes();
  phase3PrNotes();
  phase4Cleanup();
  await phase5DatabaseActivities();
  phase6RebuildIndex();
  phase7DocsFiles();

  log("\n=== Migration complete ===");
  printValidationReminders();
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exitCode = 1;
});
