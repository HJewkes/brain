/**
 * Single-step workflow — runs any template as a one-shot dispatch.
 *
 * Parameters:
 *   template: REQUIRED — the template name to dispatch
 *   stepId: optional step identifier (defaults to sanitised template name)
 *
 * All other context parameters are forwarded to the template via normal
 * variable substitution.
 */

import type { WorkflowFn } from '../runtime/types.js';

export const singleStepWorkflow: WorkflowFn = async (ctx) => {
  const template = ctx.param('template');
  if (!template) {
    throw new Error(
      'single-step workflow requires a "template" context parameter. ' +
        'Pass it via context: { template: "planning-decompose", ... } when starting the workflow.'
    );
  }

  const stepId = ctx.param('stepId') ?? template.replace(/[^a-z0-9-]/gi, '-');
  await ctx.dispatch(stepId, template);
};
