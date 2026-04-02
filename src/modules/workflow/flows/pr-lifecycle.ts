/**
 * PR lifecycle workflow — implement, create PR, review, fix, merge.
 *
 * Steps: implement → create-pr → review ⇄ fixup → merge
 *
 * After implementation, a PR is created (assisted step), then the review
 * loop runs until approved or max iterations.
 */

import type { WorkflowFn } from '../runtime/types.js';

export const prLifecycleWorkflow: WorkflowFn = async (ctx) => {
  await ctx.dispatch('implement', 'implementation-compact');
  await ctx.assisted('create-pr', 'ops');

  let review = await ctx.dispatch('review', 'review-agent');

  while (review.signal === 'changes_requested' && ctx.iteration('fixup') < 3) {
    await ctx.dispatch('fixup', 'review-fixup');
    review = await ctx.dispatch('review', 'review-agent');
  }

  await ctx.assisted('merge', 'ops');
};
