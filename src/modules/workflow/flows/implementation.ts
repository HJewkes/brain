/**
 * Implementation workflow — build, review, fix loop.
 *
 * Steps: dispatch → implement → review ⇄ fix → merge
 *
 * The dispatch step is assisted (coordinator assigns work),
 * then the agent implements, gets reviewed, and iterates on fixes
 * until approved or max iterations reached.
 */

import type { WorkflowFn } from '../runtime/types.js';

export const implementationWorkflow: WorkflowFn = async (ctx) => {
  await ctx.assisted('dispatch', 'ops');
  await ctx.dispatch('implement', 'implementation-compact');

  let review = await ctx.dispatch('review', 'review-agent');

  while (review.signal === 'needs_fixes' && ctx.iteration('fix') < 3) {
    await ctx.dispatch('fix', 'review-fixup');
    review = await ctx.dispatch('review', 'review-agent');
  }

  if (review.signal === 'approved') {
    await ctx.assisted('merge', 'ops');
  }
};
