import type Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DependencyPRContext {
  displayId: string;
  title: string;
  status: string;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  summary: string | null;
}

interface TaskRow {
  id: string;
  title: string | null;
  metadata: string | null;
  contentDir: string | null;
}

interface DeliveryRow {
  branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
}

const SUMMARY_MAX_CHARS = 1200;

function findTaskByDisplayId(db: Database.Database, displayId: string): TaskRow | null {
  try {
    const row = db
      .prepare(
        `SELECT id, title, metadata, content_dir as contentDir
         FROM notes
         WHERE module = 'pm'
           AND type = 'task'
           AND json_extract(metadata, '$.display_id') = ?
         LIMIT 1`
      )
      .get(displayId) as TaskRow | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

function readDependsOn(metadata: string | null): string[] {
  if (!metadata) return [];
  try {
    const meta = JSON.parse(metadata) as { depends_on?: string[] };
    return Array.isArray(meta.depends_on) ? meta.depends_on : [];
  } catch {
    return [];
  }
}

function readTaskStatus(metadata: string | null): string {
  if (!metadata) return 'unknown';
  try {
    const meta = JSON.parse(metadata) as { status?: string };
    return meta.status ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function readTaskSummary(contentDir: string | null): string | null {
  if (!contentDir) return null;
  const summaryPath = join(contentDir, 'summary.md');
  if (!existsSync(summaryPath)) return null;
  const text = readFileSync(summaryPath, 'utf-8').trim();
  if (!text) return null;
  return text.length > SUMMARY_MAX_CHARS
    ? text.slice(0, SUMMARY_MAX_CHARS).trimEnd() + '\n…'
    : text;
}

function findLatestDelivery(db: Database.Database, taskId: string): DeliveryRow | null {
  try {
    const row = db
      .prepare(
        `SELECT branch, pr_number, pr_url
         FROM delivery_states
         WHERE task_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(taskId) as DeliveryRow | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

/**
 * Build dependency context for an AI reviewer evaluating a PR.
 *
 * Returns one entry per upstream task referenced in the task's `depends_on`.
 * Each entry includes the dependency's title, status, agent branch, PR URL,
 * and (when available) the summary the dependency author wrote at completion.
 *
 * Reviewers see each PR in isolation, so missing schemas/columns/functions
 * declared by an unmerged dependency get flagged as critical issues. Passing
 * this context into the review prompt lets the reviewer recognize that what
 * looks like a missing reference is actually provided by an upstream PR.
 */
export function buildDependencyPRContexts(
  db: Database.Database,
  taskDisplayId: string
): DependencyPRContext[] {
  const task = findTaskByDisplayId(db, taskDisplayId);
  if (!task) return [];
  const dependsOn = readDependsOn(task.metadata);
  if (dependsOn.length === 0) return [];

  const contexts: DependencyPRContext[] = [];
  for (const depId of dependsOn) {
    const depTask = findTaskByDisplayId(db, depId);
    if (!depTask) {
      contexts.push({
        displayId: depId,
        title: depId,
        status: 'unknown',
        branch: null,
        prNumber: null,
        prUrl: null,
        summary: null,
      });
      continue;
    }
    const delivery = findLatestDelivery(db, depId);
    contexts.push({
      displayId: depId,
      title: depTask.title ?? depId,
      status: readTaskStatus(depTask.metadata),
      branch: delivery?.branch ?? null,
      prNumber: delivery?.pr_number ?? null,
      prUrl: delivery?.pr_url ?? null,
      summary: readTaskSummary(depTask.contentDir),
    });
  }
  return contexts;
}

/**
 * Render dependency contexts as a markdown block ready to inject into a
 * review-agent prompt. Returns an empty string when there are no
 * dependencies, so the template falls back to its base text without an
 * empty section.
 */
export function renderDependencyContextBlock(contexts: DependencyPRContext[]): string {
  if (contexts.length === 0) return '';
  const lines: string[] = [
    '## Dependency PR Context',
    '',
    'This PR depends on the following upstream task(s). Their PRs may not yet',
    'be merged into the base branch you are diffing against. Schema, columns,',
    'functions, types, or files referenced by the current PR but missing from',
    'the diff are likely provided by these dependencies — do NOT flag them as',
    'critical issues without first checking the upstream branches/PRs.',
    '',
  ];
  for (const ctx of contexts) {
    lines.push(`### ${ctx.displayId} — ${ctx.title}`);
    lines.push(`- Status: ${ctx.status}`);
    if (ctx.prUrl) {
      lines.push(`- PR: ${ctx.prUrl}${ctx.prNumber ? ` (#${ctx.prNumber})` : ''}`);
    } else if (ctx.prNumber) {
      lines.push(`- PR: #${ctx.prNumber}`);
    }
    if (ctx.branch) lines.push(`- Branch: \`${ctx.branch}\``);
    if (ctx.summary) {
      lines.push('');
      lines.push('Summary from upstream author:');
      lines.push('');
      lines.push(ctx.summary);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

export function buildDependencyContextString(
  db: Database.Database,
  taskDisplayId: string | null | undefined
): string {
  if (!taskDisplayId) return '';
  return renderDependencyContextBlock(buildDependencyPRContexts(db, taskDisplayId));
}
