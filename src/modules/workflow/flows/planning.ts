/**
 * Planning workflow — imperative port of planning-workflow.json.
 *
 * Steps: seed → research → interview → design ⇄ critic → spec-tests → decompose → implement → review
 *
 * Parameters:
 *   complexity: 'low' | 'medium' | 'high' (default 'high')
 *     - low:    skip research and interview
 *     - medium: skip interview
 *     - high:   full pipeline including assisted interview
 *   planId: optional plan identifier
 *   brainNotes: comma-separated note slugs for pre-existing context
 *   files: comma-separated file paths for pre-existing context
 *   priorContext: free-text prior research/decisions
 *   interviewAnswers: pre-filled interview responses
 */

import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WorkflowFn } from '../runtime/types.js';
import { buildPlanningSeed } from './planning-seed.js';

export const planningWorkflow: WorkflowFn = async (ctx) => {
  const brief = ctx.param('brief');
  if (!brief) {
    throw new Error(
      'Planning workflow requires a "brief" context parameter describing what to build. ' +
        'Pass it via context: { brief: "..." } when starting the workflow.'
    );
  }

  const complexity = ctx.param('complexity') ?? 'high';
  const explicitSkipResearch = ctx.param('skipResearch') === 'true';
  const planId = ctx.param('planId') ?? ctx.runId.slice(0, 8);

  // Clean plan directory to prevent prior run artifacts from polluting this run
  const planDir = resolve(ctx.projectDir, '.plans', planId);
  if (existsSync(planDir)) {
    rmSync(planDir, { recursive: true, force: true });
  }
  mkdirSync(planDir, { recursive: true });

  // Seed phase — gather pre-existing context (deterministic, no LLM)
  // Brief is always available (validated above), so seed always runs
  const priorContext = ctx.param('priorContext') ?? brief;
  await ctx.seed(
    'seed',
    buildPlanningSeed({
      projectDir: ctx.projectDir,
      planId,
      brainNotes: ctx.param('brainNotes'),
      files: ctx.param('files'),
      priorContext,
      interviewAnswers: ctx.param('interviewAnswers'),
    })
  );

  const skipResearch = explicitSkipResearch || ctx.param('skipResearch') === 'true';
  const hasInterviewAnswers = !!ctx.param('interviewAnswers');

  // Research phase (skip for low complexity or when seed provides full coverage)
  if (complexity !== 'low' && !skipResearch) {
    await ctx.dispatch('research', 'planning-research');
  }

  // Interview phase (high complexity only, skip if answers pre-filled)
  if (complexity === 'high' && !hasInterviewAnswers) {
    await ctx.assisted('interview', 'planning-interview');
  }

  // Design -> Critic revision loop (max 3 iterations per JSON gates)
  await ctx.dispatch('design', 'planning-design');
  let critic = await ctx.dispatch('critic', 'planning-critic');

  while (critic.signal === 'needs_revision' && ctx.iteration('design') < 3) {
    await ctx.dispatch('design', 'planning-design');
    critic = await ctx.dispatch('critic', 'planning-critic');
  }

  // Re-research if critic found open questions
  if (critic.signal === 'has_open_questions') {
    await ctx.dispatch('research', 'planning-research');
    await ctx.dispatch('design', 'planning-design');
    await ctx.dispatch('critic', 'planning-critic');
  }

  // Linear completion steps
  await ctx.dispatch('spec-tests', 'planning-spectests');
  await ctx.dispatch('decompose', 'planning-decompose');
  await ctx.dispatch('implement', 'implementation-compact');
  await ctx.dispatch('review', 'review-agent');
};
