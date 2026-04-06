/** Registry of imperative workflow functions. */

import { planningWorkflow } from './planning.js';
import { implementationWorkflow } from './implementation.js';
import { reviewWorkflow } from './review.js';
import { brainstormingWorkflow } from './brainstorming.js';
import { prLifecycleWorkflow } from './pr-lifecycle.js';
import { uxPrototypeWorkflow } from './ux-prototype.js';
import { singleStepWorkflow } from './single-step.js';
import { waveExecutionWorkflow } from './wave-execution.js';
import type { WorkflowFn } from '../runtime/types.js';

export const workflows: Record<string, WorkflowFn> = {
  planning: planningWorkflow,
  implementation: implementationWorkflow,
  review: reviewWorkflow,
  brainstorming: brainstormingWorkflow,
  'pr-lifecycle': prLifecycleWorkflow,
  'ux-prototype': uxPrototypeWorkflow,
  step: singleStepWorkflow,
  'wave-execution': waveExecutionWorkflow,
};
