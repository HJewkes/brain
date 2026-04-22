import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { BrainDB } from '../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../types.js';
import { renderTemplateFile } from './template-renderer.js';
import { buildAgentDispatchContext } from './dispatch-context.js';
import { buildTemplateVariables } from '../pm/commands/orchestration.js';
import { pullNextTask } from './task-pull.js';
import { buildSpawnPrompt } from './prompt-builder.js';
import type { PullResult } from './task-pull.js';
import type { RoutingResult } from '../pm/engine/routing.js';

export interface CoordinatorConfig {
  projectDir: string;
  teamName: string;
  wipLimit: number;
  templateName: string;
}

export interface CoordinatorPrompt {
  prompt: string;
  teamName: string;
  wipLimit: number;
}

export interface WorkerDispatch {
  taskId: string;
  claimToken: string;
  prompt: string;
  routing: RoutingResult;
  description: string;
}

/**
 * Render the coordinator agent prompt from template.
 * This is the entry point for `claude --agent` or Team/Agent spawning.
 */
export function renderCoordinatorPrompt(config: CoordinatorConfig): CoordinatorPrompt | null {
  const templatePath = join(config.projectDir, 'templates', 'agents', `${config.templateName}.md`);
  if (!existsSync(templatePath)) return null;

  const variables = {
    CWD: config.projectDir,
    PROJECT_DIR: config.projectDir,
    TEAM_NAME: config.teamName,
    BRAIN_CLI: 'npx tsx src/cli.ts',
  };

  const prompt = renderTemplateFile(config.projectDir, config.templateName, variables);

  return {
    prompt,
    teamName: config.teamName,
    wipLimit: config.wipLimit,
  };
}

/**
 * Build a worker dispatch for the next eligible task.
 * Renders the worker prompt template with full task context.
 */
export async function buildWorkerDispatch(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  options: {
    projectDir: string;
    teamName: string;
    templateName?: string;
  }
): Promise<WorkerDispatch | null> {
  const pullResult = await pullNextTask(db, config, embedder, {
    projectDir: options.projectDir,
  });
  if (!pullResult) return null;

  return buildWorkerDispatchFromPull(db, pullResult, options);
}

/**
 * Build a worker dispatch from an already-pulled task.
 */
export function buildWorkerDispatchFromPull(
  db: BrainDB,
  pullResult: PullResult,
  options: {
    projectDir: string;
    teamName: string;
    templateName?: string;
  }
): WorkerDispatch | null {
  const templateName =
    options.templateName ?? pullResult.dispatchContext.routing.template ?? 'worker';
  const templatePath = join(options.projectDir, 'templates', 'agents', `${templateName}.md`);

  if (!existsSync(templatePath)) {
    const fallback = buildSpawnPrompt(db, pullResult.taskId, {
      projectDir: options.projectDir,
    });
    return {
      taskId: pullResult.taskId,
      claimToken: pullResult.claimToken,
      prompt: fallback ?? pullResult.brief,
      routing: pullResult.dispatchContext.routing,
      description: `Implement ${pullResult.taskId}`,
    };
  }

  const dispatch = buildAgentDispatchContext(db, pullResult.taskId, {
    projectDir: options.projectDir,
  });
  if (!dispatch) return null;

  const variables = buildTemplateVariables(dispatch, options.projectDir, {
    teamName: options.teamName,
    claimToken: pullResult.claimToken,
  });

  const prompt = renderTemplateFile(options.projectDir, templateName, variables);

  return {
    taskId: pullResult.taskId,
    claimToken: pullResult.claimToken,
    prompt,
    routing: pullResult.dispatchContext.routing,
    description: `Implement ${pullResult.taskId}: ${dispatch.context.title}`,
  };
}
