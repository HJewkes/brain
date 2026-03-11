import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type { Result } from '../../../errors.js';
import type { ProjectBranchPrefix } from '../../pm/types.js';
import { ok, fail } from '../../../errors.js';
import { renderTemplate } from './templates.js';
import { getProject } from '../../pm/data/project-ops.js';
import { getTask, updateTaskStatus } from '../../pm/data/task-ops.js';
import { readTaskBody } from '../../pm/engine/dispatch.js';
import { getPmNotes } from '../../pm/data/queries.js';
import { generateClaim } from '../../pm/engine/claims.js';

export interface DispatchOptions {
  branch?: string;
  worktree?: string;
  dryRun?: boolean;
  claim?: boolean;
}

export interface DispatchResult {
  rendered: string;
  template: string;
  taskId: string;
  variables: Record<string, string>;
  unfilled: string[];
}

const CATEGORY_TO_PREFIX: Record<string, keyof ProjectBranchPrefix> = {
  implementation: 'feature',
  feature: 'feature',
  testing: 'feature',
  documentation: 'feature',
  design: 'feature',
  configuration: 'feature',
  migration: 'feature',
  bug: 'bug',
  fix: 'bug',
  refactor: 'refactor',
  infrastructure: 'infrastructure',
  research: 'feature',
  review: 'feature',
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function buildBranchName(
  category: string,
  title: string,
  branchPrefix?: ProjectBranchPrefix
): string {
  const prefixKey = CATEGORY_TO_PREFIX[category] ?? 'feature';
  const prefix = branchPrefix?.[prefixKey] ?? defaultBranchPrefix(prefixKey);
  const slug = slugify(title);
  return `${prefix}/${slug}`;
}

function defaultBranchPrefix(key: keyof ProjectBranchPrefix): string {
  const defaults: Record<keyof ProjectBranchPrefix, string> = {
    feature: 'feat',
    bug: 'fix',
    refactor: 'refactor',
    infrastructure: 'infra',
  };
  return defaults[key];
}

export async function dispatchTemplate(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  taskId: string,
  templateName: string,
  opts: DispatchOptions = {}
): Promise<Result<DispatchResult>> {
  const prefix = taskId.split('-')[0];

  const taskResult = getTask(db, taskId);
  if (!taskResult.ok) {
    return fail(taskResult.error.code, taskResult.error.message, taskResult.error.details);
  }
  const task = taskResult.data;

  const projectResult = getProject(db, prefix);

  const vars: Record<string, string> = {};
  vars.TASK_ID = taskId;
  vars.BRAIN_TASK_ID = taskId;
  vars.PROJECT_PREFIX = prefix;

  if (projectResult.ok) {
    const p = projectResult.data;
    vars.REPO_PATH = p.path ?? '';
    vars.BUILD_CMD = p.commands?.build ?? 'N/A';
    vars.TEST_CMD = p.commands?.test ?? 'N/A';
    vars.TYPECHECK_CMD = p.commands?.typecheck ?? 'N/A';
    vars.LINT_CMD = p.commands?.lint ?? 'N/A';
    vars.BASE_BRANCH = p.default_branch ?? 'main';
    vars.REVIEW_THRESHOLD = String(p.review_threshold ?? 5);

    vars.BRANCH_NAME =
      opts.branch ?? buildBranchName(task.category, task.title ?? taskId, p.branch_prefix);
  } else {
    vars.REPO_PATH = '';
    vars.BUILD_CMD = 'N/A';
    vars.TEST_CMD = 'N/A';
    vars.TYPECHECK_CMD = 'N/A';
    vars.LINT_CMD = 'N/A';
    vars.BASE_BRANCH = 'main';
    vars.REVIEW_THRESHOLD = '5';
    vars.BRANCH_NAME = opts.branch ?? buildBranchName(task.category, task.title ?? taskId);
  }

  vars.WORKTREE_PATH = opts.worktree ?? '';

  const taskNotes = getPmNotes(db, 'task', { display_id: taskId });
  if (taskNotes.length > 0) {
    const body = readTaskBody(taskNotes[0]);
    vars.IMPLEMENTATION_INSTRUCTIONS = body;
    vars.TASK_DESCRIPTION = body;
  }

  if (task.claim_token) {
    vars.CLAIM_TOKEN = task.claim_token;
  }

  if (opts.claim && !opts.dryRun) {
    const claimResult = await updateTaskStatus(db, config, embedder, taskId, 'claimed');
    if (!claimResult.ok) {
      return fail(claimResult.error.code, claimResult.error.message, claimResult.error.details);
    }
    const claim = generateClaim();
    vars.CLAIM_TOKEN = claim.token;
  }

  const rendered = renderTemplate(templateName, vars);
  if (!rendered.ok) return rendered;

  const unfilledMatches = rendered.data.matchAll(/\{\{(\w+)\}\}/g);
  const unfilled = [...new Set([...unfilledMatches].map((m) => m[1]))].sort();

  return ok({
    rendered: rendered.data,
    template: templateName,
    taskId,
    variables: vars,
    unfilled,
  });
}
