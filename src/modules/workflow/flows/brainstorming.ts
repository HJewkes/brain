/**
 * Brainstorming workflow — explore, design, and document.
 *
 * Steps: explore → interview → propose → design ⇄ interview → write-doc → write-plan
 *
 * If the design step signals needs_clarification, loop back to interview
 * for another round (max 3 iterations).
 */

import type { WorkflowFn } from '../runtime/types.js';

export const brainstormingWorkflow: WorkflowFn = async (ctx) => {
  await ctx.dispatch('explore', 'brainstorm-explore');
  await ctx.assisted('interview', 'brainstorm-interview');
  await ctx.dispatch('propose', 'brainstorm-propose');

  let design = await ctx.dispatch('design', 'brainstorm-design');

  while (design.signal === 'needs_clarification' && ctx.iteration('design') < 3) {
    await ctx.assisted('interview', 'brainstorm-interview');
    design = await ctx.dispatch('design', 'brainstorm-design');
  }

  await ctx.dispatch('write-doc', 'brainstorm-write-doc');
  await ctx.dispatch('write-plan', 'writing-plans');
};
