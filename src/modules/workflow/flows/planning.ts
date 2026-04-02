/**
 * Planning workflow — imperative port of planning-workflow.json.
 *
 * Steps: research → interview → design ⇄ critic → spec-tests → decompose → implement → review
 *
 * Parameters:
 *   complexity: 'low' | 'medium' | 'high' (default 'high')
 *     - low:    skip research and interview
 *     - medium: skip interview
 *     - high:   full pipeline including assisted interview
 *   planId: optional plan identifier
 */

import type { WorkflowFn } from '../runtime/types.js';

export const planningWorkflow: WorkflowFn = async (ctx) => {
  const complexity = ctx.param('complexity') ?? 'high';

  // Research phase (skip for low complexity)
  if (complexity !== 'low') {
    await ctx.dispatch('research', 'planning-research');
  }

  // Interview phase (high complexity only, assisted step)
  if (complexity === 'high') {
    await ctx.assisted('interview', 'planning-interview');
  }

  // Design → Critic revision loop (max 3 iterations per JSON gates)
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
