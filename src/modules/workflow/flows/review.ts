/**
 * Review workflow — automated review with risk-based routing.
 *
 * Steps: review → route → fixup|human-review|merge
 *
 * The review agent produces a verdict and risk score. Routing:
 *   - approved (low risk): auto-merge
 *   - needs_fixes: fixup agent → re-review loop
 *   - high_risk: pause for human review → merge or fixup
 */

import type { WorkflowFn } from '../runtime/types.js';

export const reviewWorkflow: WorkflowFn = async (ctx) => {
  let review = await ctx.dispatch('review', 'review-agent');

  if (review.signal === 'high_risk') {
    const humanReview = await ctx.assisted('human-review', 'ops');

    if (humanReview.signal === 'needs_fixes') {
      await ctx.dispatch('fixup', 'review-fixup');
      review = await ctx.dispatch('review', 'review-agent');
    }
  }

  while (review.signal === 'needs_fixes' && ctx.iteration('fixup') < 3) {
    await ctx.dispatch('fixup', 'review-fixup');
    review = await ctx.dispatch('review', 'review-agent');
  }

  await ctx.assisted('merge', 'ops');
};
