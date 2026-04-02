/**
 * UX prototype workflow — ideate, build, review, iterate, extract, implement.
 *
 * Steps: ideate → prototype → review ⇄ iterate → extract → implement
 *
 * The review step can loop back to iterate (max 3 rounds) until the
 * prototype is approved, then patterns are extracted and implemented.
 */

import type { WorkflowFn } from '../runtime/types.js';

export const uxPrototypeWorkflow: WorkflowFn = async (ctx) => {
  await ctx.dispatch('ideate', 'brainstorm-explore');
  await ctx.dispatch('prototype', 'implementation-compact');

  let review = await ctx.dispatch('review', 'review-agent');

  while (review.signal === 'needs_changes' && ctx.iteration('iterate') < 3) {
    await ctx.dispatch('iterate', 'implementation-compact');
    review = await ctx.dispatch('review', 'review-agent');
  }

  await ctx.dispatch('extract', 'ops');
  await ctx.dispatch('implement', 'implementation-compact');
};
