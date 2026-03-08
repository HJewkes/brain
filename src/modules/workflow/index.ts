import type { BrainModule } from '../types.js';

import { createWorkflowCommand } from './commands/workflow.js';
import { createResourceCommand } from './commands/resource.js';
import { createLifecycleCommands } from './commands/lifecycle.js';
import { createCollapseCommand } from './commands/collapse.js';

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

    ctx.registerExtractionStrategy({ shouldExtract: () => false });

    ctx.registerFilter({ visibility: 'private' });

    const wfCmd = createWorkflowCommand();
    wfCmd.addCommand(createResourceCommand());
    for (const cmd of createLifecycleCommands()) {
      wfCmd.addCommand(cmd);
    }
    wfCmd.addCommand(createCollapseCommand());

    ctx.registerCommand(wfCmd);
  },
};
