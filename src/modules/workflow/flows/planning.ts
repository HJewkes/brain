/**
 * Planning workflow — produces design artifacts for a feature.
 *
 * Steps: seed → research → interview → design ⇄ critic → spec-tests → review (assisted) → decompose
 *
 * Outputs (written to .plans/<planId>/):
 *   - pre-existing-context.md (seed)
 *   - research-brief.md (research agent)
 *   - spec.md, design.md, acceptance-criteria.md (design agent)
 *   - critic-report.md (critic agent)
 *
 * Parameters:
 *   brief: REQUIRED — what to build (injected as RESEARCH_FOCUS and priorContext)
 *   complexity: 'low' | 'medium' | 'high' (default 'high')
 *     - low:    skip research and interview
 *     - medium: skip interview
 *     - high:   full pipeline including assisted interview
 *   planId: plan identifier (defaults to run ID prefix)
 *   brainNotes: comma-separated note slugs for pre-existing context
 *   files: comma-separated file paths for pre-existing context
 *   priorContext: free-text prior research/decisions (defaults to brief)
 *   interviewAnswers: pre-filled interview responses
 */

import type { WorkflowFn } from '../runtime/types.js';
import { buildPlanningSeed } from './planning-seed.js';
import { buildPlanningCompletion } from './planning-completion.js';

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

  // Seed phase — gather pre-existing context (deterministic, no LLM).
  // Plan-dir cleanup happens INSIDE the seed step so it's cached as a unit
  // and won't fire on hydration replay (which would otherwise destroy
  // artifacts from prior steps in the same workflow instance).
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

  // Design → Critic revision loop (max 3 iterations)
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

  // Spec tests validate the acceptance criteria
  await ctx.dispatch('spec-tests', 'planning-spectests');

  // Coordinator-assisted review — presents design summary to user for approval
  await ctx.assisted('review', 'planning-review');

  // Decompose approved design into PM tasks with wave dependencies
  await ctx.dispatch('decompose', 'planning-decompose');

  // Completion phase — ingest plan artifacts into brain and create implementation task
  if (ctx.db && ctx.config && ctx.embedder) {
    await ctx.seed(
      'completion',
      buildPlanningCompletion({
        projectDir: ctx.projectDir,
        planId,
        brief,
        workflowName: 'planning',
        project: ctx.project,
        workstream: parseInt(ctx.param('workstream') ?? '1', 10),
        db: ctx.db,
        config: ctx.config,
        embedder: ctx.embedder,
      })
    );
  }
};
