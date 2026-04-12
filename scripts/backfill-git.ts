#!/usr/bin/env npx tsx
/**
 * Backfill task stage transitions from git history.
 *
 * Strategy:
 *  1. Parse git log for commits that reference task IDs (VNM-XX.XX patterns).
 *  2. For each referenced task, compute:
 *     - first_commit_date → start (pending/claimed → in-progress)
 *     - last_commit_date  → complete (in-progress → done), only if task is done
 *  3. For done/in-progress tasks with no git evidence, fall back to:
 *     - claimed_at field (start), created field (start fallback)
 *  4. Write activity notes matching the format used by the live system.
 *  5. Idempotent — skip if note file already exists.
 *
 * Usage: npx tsx scripts/backfill-git.ts [--dry-run]
 */

import { execSync } from "child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";

const VNM_DIR = join(
  import.meta.dirname,
  "../.brain/notes/modules/pm/VNM"
);

const DRY_RUN = process.argv.includes("--dry-run");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskMeta {
  displayId: string;
  status: string;
  claimedAt: string | null;
  created: string | null;
  title: string;
}

interface CommitRecord {
  sha: string;
  date: string; // ISO-8601
  subject: string;
}

interface TaskTransitions {
  taskId: string;
  startDate: string;
  completeDate: string | null; // null if task not done
  source: string;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function getCommits(): CommitRecord[] {
  const raw = execSync(
    'git log --all --format="%H %cI %s" --since="2026-01-01"',
    { encoding: "utf8" }
  );
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const spaceIdx = line.indexOf(" ");
      const rest = line.slice(spaceIdx + 1);
      const spaceIdx2 = rest.indexOf(" ");
      return {
        sha: line.slice(0, spaceIdx),
        date: rest.slice(0, spaceIdx2),
        subject: rest.slice(spaceIdx2 + 1),
      };
    });
}

function extractTaskIds(text: string): string[] {
  const matches = text.match(/VNM-\d+\.\d+/gi) ?? [];
  // Normalize to uppercase canonical form e.g. VNM-05.01
  return matches.map((m) => {
    const [prefix, nums] = m.toUpperCase().split("-");
    const [ws, num] = nums.split(".");
    return `${prefix}-${ws}.${num.padStart(2, "0")}`;
  });
}

// ---------------------------------------------------------------------------
// Task note parsing
// ---------------------------------------------------------------------------

function loadTasks(): Map<string, TaskMeta> {
  const tasks = new Map<string, TaskMeta>();

  if (!existsSync(VNM_DIR)) return tasks;

  for (const entry of readdirSync(VNM_DIR)) {
    // Only task notes: VNM-XX.YY.md (uppercase, no prefix)
    if (!/^VNM-\d+\.\d+\.md$/.test(entry)) continue;

    const content = readFileSync(join(VNM_DIR, entry), "utf8");

    const displayIdM = content.match(/^display_id:\s*(.+)$/m);
    if (!displayIdM) continue;
    const displayId = displayIdM[1].trim().replace(/["']/g, "");

    const statusM = content.match(/^status:\s*(\S+)/m);
    const status = statusM ? statusM[1] : "pending";

    const claimedM = content.match(/^claimed_at:\s*(.+)$/m);
    const claimedAt = claimedM ? claimedM[1].trim().replace(/["']/g, "") : null;

    const createdM = content.match(/^created:\s*(.+)$/m);
    const created = createdM ? createdM[1].trim().replace(/["']/g, "") : null;

    const titleM = content.match(/^title:\s*"?(.+?)"?$/m);
    const title = titleM ? titleM[1].trim().replace(/^"|"$/g, "") : displayId;

    tasks.set(displayId, { displayId, status, claimedAt, created, title });
  }

  return tasks;
}

// ---------------------------------------------------------------------------
// Activity note file helpers
// ---------------------------------------------------------------------------

function activityNoteFilename(
  type: "start" | "complete",
  taskId: string,
  isoDate: string
): string {
  // Matches existing naming convention:
  // vnm-start-vnm-05.01-2026-03-13T18-08-30.md
  const taskSlug = taskId.toLowerCase().replace(".", ".");
  const datePart = isoDate
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "T")
    .replace(/:/g, "-");
  return `vnm-${type}-${taskSlug.replace("vnm-", "vnm-")}-${datePart}.md`;
}

function activityNoteExists(type: "start" | "complete", taskId: string): boolean {
  const prefix = `vnm-${type}-${taskId.toLowerCase()}-`;
  return readdirSync(VNM_DIR).some((f) => f.startsWith(prefix));
}

function buildActivityNote(
  type: "start" | "complete",
  taskId: string,
  isoDate: string,
  source: string
): string {
  const id = activityNoteFilename(type, taskId, isoDate).replace(/\.md$/, "");
  const taskSlug = taskId.toLowerCase();

  if (type === "start") {
    return [
      "---",
      `id: ${id}`,
      `title: "Start: ${taskId} → in-progress"`,
      "type: activity",
      "tier: slow",
      "module: pm",
      "project: VNM",
      "activity_type: start",
      `task_id: ${taskId}`,
      "from_state: pending",
      "to_state: in-progress",
      "embed_status: queued",
      `created: ${isoDate}`,
      `modified: ${isoDate}`,
      `source: ${source}`,
      "---",
      "",
      `# Start: ${taskId}`,
      "",
    ].join("\n");
  } else {
    return [
      "---",
      `id: ${id}`,
      `title: "Complete: ${taskId} → done"`,
      "type: activity",
      "tier: slow",
      "module: pm",
      "project: VNM",
      "activity_type: complete",
      `task_id: ${taskId}`,
      "from_state: in-progress",
      "to_state: done",
      "embed_status: queued",
      `created: ${isoDate}`,
      `modified: ${isoDate}`,
      `source: ${source}`,
      "---",
      "",
      `# Complete: ${taskId}`,
      "",
    ].join("\n");
  }
}

function writeNote(filename: string, content: string): void {
  const path = join(VNM_DIR, filename);
  if (existsSync(path)) return; // idempotent
  if (DRY_RUN) {
    console.log(`  [dry-run] would write ${filename}`);
    return;
  }
  writeFileSync(path, content, "utf8");
}

// ---------------------------------------------------------------------------
// Date normalization
// ---------------------------------------------------------------------------

function toIso(raw: string | null): string | null {
  if (!raw) return null;
  // Already full ISO? Return as-is.
  if (raw.includes("T")) return raw.endsWith("Z") ? raw : raw + "Z";
  // Date only (2026-03-03) → midnight UTC
  return `${raw}T00:00:00.000Z`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log(`Loading tasks from ${VNM_DIR}...`);
  const tasks = loadTasks();
  console.log(`Found ${tasks.size} task notes`);

  console.log("Reading git history...");
  const commits = getCommits();
  console.log(`Found ${commits.length} commits`);

  // Build map: taskId -> sorted commit dates
  const taskCommits = new Map<string, string[]>();
  for (const commit of commits) {
    const ids = extractTaskIds(commit.subject);
    for (const id of ids) {
      if (!taskCommits.has(id)) taskCommits.set(id, []);
      taskCommits.get(id)!.push(commit.date);
    }
  }

  // Sort each task's commits chronologically
  for (const [id, dates] of taskCommits) {
    dates.sort();
    taskCommits.set(id, dates);
  }

  console.log(`Found git evidence for ${taskCommits.size} tasks`);

  // Build transition records: tasks that need backfill
  const transitions: TaskTransitions[] = [];

  // 1. Tasks with direct git evidence
  for (const [taskId, dates] of taskCommits) {
    const task = tasks.get(taskId);
    if (!task) continue; // Commit references a task we don't have notes for

    const startDate = dates[0];
    const lastDate = dates[dates.length - 1];
    const completeDate = task.status === "done" ? lastDate : null;

    transitions.push({
      taskId,
      startDate,
      completeDate,
      source: "git-backfill",
    });
  }

  // 2. Done/in-progress tasks with NO git evidence — use claimed_at or created
  for (const [taskId, task] of tasks) {
    if (taskCommits.has(taskId)) continue; // Already handled above
    if (task.status !== "done" && task.status !== "in-progress") continue;

    const raw = task.claimedAt ?? task.created;
    const startDate = toIso(raw);
    if (!startDate) continue;

    const completeDate = task.status === "done" ? startDate : null;

    transitions.push({
      taskId,
      startDate,
      completeDate,
      source: "task-metadata-backfill",
    });
  }

  console.log(`\nPlanning ${transitions.length} task transition sets...`);
  if (DRY_RUN) console.log("(dry-run mode — no files written)\n");

  let startsCreated = 0;
  let startsSkipped = 0;
  let completesCreated = 0;
  let completesSkipped = 0;
  const dateRange = { min: "9999", max: "0000" };

  for (const t of transitions) {
    // Track date range
    if (t.startDate < dateRange.min) dateRange.min = t.startDate;
    if (t.startDate > dateRange.max) dateRange.max = t.startDate;
    if (t.completeDate) {
      if (t.completeDate < dateRange.min) dateRange.min = t.completeDate;
      if (t.completeDate > dateRange.max) dateRange.max = t.completeDate;
    }

    // Start note
    if (activityNoteExists("start", t.taskId)) {
      startsSkipped++;
    } else {
      const isoDate = t.startDate.endsWith("Z") ? t.startDate : t.startDate + "Z";
      const filename = activityNoteFilename("start", t.taskId, isoDate);
      const content = buildActivityNote("start", t.taskId, isoDate, t.source);
      writeNote(filename, content);
      startsCreated++;
    }

    // Complete note
    if (t.completeDate) {
      if (activityNoteExists("complete", t.taskId)) {
        completesSkipped++;
      } else {
        const isoDate = t.completeDate.endsWith("Z")
          ? t.completeDate
          : t.completeDate + "Z";
        const filename = activityNoteFilename("complete", t.taskId, isoDate);
        const content = buildActivityNote("complete", t.taskId, isoDate, t.source);
        writeNote(filename, content);
        completesCreated++;
      }
    }
  }

  console.log("\nResults:");
  console.log(`  Start notes created:    ${startsCreated}`);
  console.log(`  Start notes skipped:    ${startsSkipped} (already exist)`);
  console.log(`  Complete notes created: ${completesCreated}`);
  console.log(`  Complete notes skipped: ${completesSkipped} (already exist)`);
  console.log(
    `  Total transitions:      ${startsCreated + completesCreated} new notes`
  );
  console.log(
    `  Date range:             ${dateRange.min.slice(0, 10)} → ${dateRange.max.slice(0, 10)}`
  );

  if (!DRY_RUN) {
    console.log("\nDone. Run 'brain index' to pick up the new notes.");
  }
}

main();
