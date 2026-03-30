import type { BrainModule } from '../types.js';

import { createWorkflowCommand } from './commands/workflow.js';
import { createResourceCommand } from './commands/resource.js';
import { createLifecycleCommands } from './commands/lifecycle.js';
import { createCollapseCommand } from './commands/collapse.js';
import { createObserveCommand } from './commands/observe.js';
import { createImproveCommand } from './commands/improve.js';
import { createReportCommand } from './commands/report.js';
import { createSeedCommand } from './commands/seed.js';
import { frictionHook } from './hooks/friction-hook.js';
import { advanceHook } from './hooks/advance-hook.js';

export {
  resolveTemplate,
  listTemplateNames,
  listTemplates,
  renderTemplate,
  extractVariables,
} from './engine/templates.js';

export const workflowModule: BrainModule = {
  name: 'workflow',
  version: '1.0.0',
  description: 'Workflow definition, instantiation, and lifecycle management',
  register(ctx) {
    ctx.registerNoteType({
      name: 'workflow',
      description: 'Workflow definition with steps and edges',
      tier: 'slow',
      schema: {
        type: 'object',
        properties: {
          display_id: { type: 'string', description: 'Display identifier' },
          name: { type: 'string', description: 'Workflow name' },
          version: { type: 'number', description: 'Workflow version number' },
          registration_status: {
            type: 'string',
            enum: ['registered', 'draft', 'archived'],
            description: 'Registration status',
          },
          step_count: { type: 'number', description: 'Number of steps in the workflow' },
          edge_count: { type: 'number', description: 'Number of edges in the workflow' },
        },
        required: ['name', 'version', 'registration_status'],
      },
    });

    ctx.registerNoteType({
      name: 'resource',
      description: 'Resource bound to a workflow instance',
      tier: 'fast',
      schema: {
        type: 'object',
        properties: {
          display_id: { type: 'string', description: 'Display identifier' },
          resource_type: { type: 'string', description: 'Type of resource' },
          project: { type: 'string', description: 'Associated project prefix' },
          status: {
            type: 'string',
            enum: ['active', 'released', 'expired'],
            description: 'Resource status',
          },
          data: { type: 'string', description: 'Resource data payload' },
        },
        required: ['resource_type', 'status'],
      },
    });

    ctx.registerNoteType({
      name: 'observation',
      description: 'Workflow observation recording friction, patterns, or improvements',
      tier: 'fast',
      schema: {
        type: 'object',
        properties: {
          observation_type: {
            type: 'string',
            enum: ['friction', 'pattern', 'improvement', 'anomaly'],
            description: 'Type of observation',
          },
          impact: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical'],
            description: 'Impact severity',
          },
          category: {
            type: 'string',
            description: 'Observation category (e.g., tool-failure, permission, retry)',
          },
          session_id: { type: 'string', description: 'Source session ID' },
          status: {
            type: 'string',
            enum: ['new', 'acknowledged', 'resolved', 'dismissed'],
            description: 'Observation status',
          },
        },
        required: ['observation_type', 'impact', 'status'],
      },
    });

    ctx.registerRelationType({
      name: 'instance-of',
      description: 'Workflow instance is an instance of a workflow definition',
    });

    ctx.registerRelationType({
      name: 'expands-to',
      description: 'Workflow step expands to sub-steps',
    });

    ctx.registerRelationType({
      name: 'iteration-of',
      description: 'Workflow instance is an iteration of a previous instance',
    });

    ctx.registerRelationType({
      name: 'observed-in',
      description: 'Observation was detected in a session',
    });

    ctx.registerExtractionStrategy({ shouldExtract: () => false });

    ctx.registerFilter({ visibility: 'private' });

    const wfCmd = createWorkflowCommand();
    wfCmd.addCommand(createResourceCommand());
    for (const cmd of createLifecycleCommands()) {
      wfCmd.addCommand(cmd);
    }
    wfCmd.addCommand(createCollapseCommand());
    wfCmd.addCommand(createObserveCommand());
    wfCmd.addCommand(createImproveCommand());
    wfCmd.addCommand(createReportCommand());
    wfCmd.addCommand(createSeedCommand());

    ctx.registerCommand(wfCmd);

    ctx.registerHookHandler(frictionHook);
    ctx.registerHookHandler(advanceHook);
  },
};
