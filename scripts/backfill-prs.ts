#!/usr/bin/env npx tsx
/**
 * Backfill PR history from GitHub into brain as PM activity notes.
 * Idempotent — skips PRs that already have notes.
 *
 * Usage: npx tsx scripts/backfill-prs.ts
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

interface PRAuthor {
  id: string;
  is_bot: boolean;
  login: string;
  name: string;
}

interface PR {
  number: number;
  title: string;
  state: string;
  createdAt: string;
  mergedAt: string | null;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  author: PRAuthor;
  reviewDecision: string;
}

const VNM_DIR = join(
  import.meta.dirname,
  "../.brain/notes/modules/pm/VNM"
);

function fetchPRs(): PR[] {
  const output = execSync(
    "gh pr list --state all --limit 200 --json number,title,state,createdAt,mergedAt,headRefName,baseRefName,additions,deletions,changedFiles,author,reviewDecision",
    { encoding: "utf8" }
  );
  return JSON.parse(output) as PR[];
}

/**
 * Load all task notes from the VNM directory and build a branch -> display_id map.
 * Task notes have frontmatter but no branch field; we match by headRefName pattern instead.
 */
function buildTaskIndex(): Map<string, string> {
  const index = new Map<string, string>();

  if (!existsSync(VNM_DIR)) return index;

  const entries = readdirSync(VNM_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;

    const content = readFileSync(join(VNM_DIR, entry.name), "utf8");
    const idMatch = content.match(/^display_id:\s*(.+)$/m);
    if (!idMatch) continue;
    const displayId = idMatch[1].trim().replace(/["']/g, "");

    // Also check if there's a branch field explicitly set
    const branchMatch = content.match(/^branch:\s*(.+)$/m);
    if (branchMatch) {
      const branch = branchMatch[1].trim().replace(/["']/g, "");
      index.set(branch, displayId);
    }
  }

  return index;
}

/**
 * Try to infer a task ID from a branch name using common patterns.
 * e.g. feat/vnm-15.01-dashboard -> VNM-15.01
 */
function inferTaskFromBranch(branch: string, taskIndex: Map<string, string>): string | null {
  // Exact match first
  if (taskIndex.has(branch)) return taskIndex.get(branch)!;

  // Pattern: feat/vnm-15.01-something or fix/vnm-05.02
  const vnmMatch = branch.match(/vnm[-_](\d+)[._](\d+)/i);
  if (vnmMatch) {
    return `VNM-${vnmMatch[1]}.${vnmMatch[2].padStart(2, "0")}`;
  }

  return null;
}

function noteFilename(prNumber: number): string {
  return `pr-${prNumber}.md`;
}

function buildNote(pr: PR, linkedTask: string | null): string {
  const modified = pr.mergedAt ?? pr.createdAt;
  const reviewDecision = pr.reviewDecision || "NONE";
  const mergedAt = pr.mergedAt ?? "";

  const lines: string[] = [
    "---",
    `id: pr-${pr.number}`,
    `title: "PR #${pr.number}: ${pr.title.replace(/"/g, '\\"')}"`,
    "type: activity",
    "tier: fast",
    "module: pm",
    "metadata:",
    "  activity_type: pr",
    `  pr_number: ${pr.number}`,
    `  pr_url: "https://github.com/HJewkes/brain/pull/${pr.number}"`,
    `  pr_state: ${pr.state}`,
    `  head_branch: ${pr.headRefName}`,
    `  base_branch: ${pr.baseRefName}`,
    `  created_at: ${pr.createdAt}`,
    `  merged_at: ${mergedAt}`,
    `  additions: ${pr.additions}`,
    `  deletions: ${pr.deletions}`,
    `  changed_files: ${pr.changedFiles}`,
    `  author: ${pr.author.login}`,
    `  review_decision: ${reviewDecision}`,
    "  project: VNM",
  ];

  if (linkedTask) {
    lines.push(`  linked_task: ${linkedTask}`);
  }

  lines.push(
    `created: ${pr.createdAt}`,
    `modified: ${modified}`,
    "---",
    "",
    `# PR #${pr.number}: ${pr.title}`,
    ""
  );

  if (linkedTask) {
    lines.push(`**Linked task**: ${linkedTask}`, "");
  }

  lines.push(
    `**Branch**: \`${pr.headRefName}\` → \`${pr.baseRefName}\``,
    `**State**: ${pr.state}`,
    `**Author**: ${pr.author.login}`,
    `**Changes**: +${pr.additions} / -${pr.deletions} across ${pr.changedFiles} file${pr.changedFiles !== 1 ? "s" : ""}`,
    ""
  );

  return lines.join("\n");
}

function main() {
  console.log("Fetching PRs from GitHub...");
  const prs = fetchPRs();
  console.log(`Found ${prs.length} PRs`);

  if (!existsSync(VNM_DIR)) {
    mkdirSync(VNM_DIR, { recursive: true });
  }

  const taskIndex = buildTaskIndex();
  console.log(`Built task index with ${taskIndex.size} branch mappings`);

  let imported = 0;
  let skipped = 0;
  const linked: Array<{ pr: number; task: string }> = [];

  for (const pr of prs) {
    const filename = noteFilename(pr.number);
    const outputPath = join(VNM_DIR, filename);

    if (existsSync(outputPath)) {
      skipped++;
      continue;
    }

    const linkedTask = inferTaskFromBranch(pr.headRefName, taskIndex);
    const note = buildNote(pr, linkedTask);

    writeFileSync(outputPath, note, "utf8");
    imported++;

    if (linkedTask) {
      linked.push({ pr: pr.number, task: linkedTask });
    }
  }

  console.log(`\nResults:`);
  console.log(`  Imported: ${imported}`);
  console.log(`  Skipped (already exist): ${skipped}`);
  console.log(`  Linked to tasks: ${linked.length}`);

  if (linked.length > 0) {
    console.log("\nTask linkages:");
    for (const { pr, task } of linked) {
      console.log(`  PR #${pr} -> ${task}`);
    }
  }

  console.log(`\nDone. Run 'brain index' to pick up the new notes.`);
}

main();
