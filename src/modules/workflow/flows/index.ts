/** Registry of imperative workflow functions. */

import { planningWorkflow } from './planning.js';
import type { WorkflowFn } from '../runtime/types.js';

export const workflows: Record<string, WorkflowFn> = {
  planning: planningWorkflow,
};
