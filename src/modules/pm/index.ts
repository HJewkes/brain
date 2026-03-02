import { Command } from '@commander-js/extra-typings';
import type { BrainModule } from '../../modules/types.js';
import { createPmCommand } from './commands/project.js';
import { createWorkstreamCommands } from './commands/workstream.js';
import { createTaskCommands } from './commands/task.js';
import { createOrchestrationCommands } from './commands/orchestration.js';
import { createDecisionCommands } from './commands/decision.js';
import { createPromptCommands } from './commands/prompt.js';
import { createContextCommand } from './commands/context.js';
import { createVerifyCommand } from './commands/verify.js';
import { createCaptureCommands } from './commands/capture.js';
import { createAuditCommands } from './commands/audit.js';
import { createImportCommand } from './commands/import.js';
import { createOrchestrateCommands } from './commands/orchestrate.js';
import { createInstallHooksCommand } from './commands/install-hooks.js';
import { createSetupCommand } from './commands/setup.js';
import { createCheckCommand } from './commands/check.js';
import { createOnboardCommand } from './commands/onboard.js';
import { createRelateCommand } from './commands/relate.js';

export const pmModule: BrainModule = {
  name: 'pm',
  version: '1.0.0',
  description: 'Project and task management module',
  register(ctx) {
    ctx.registerNoteType({
      name: 'project',
      description: 'Top-level project container',
      tier: 'slow',
      schema: {
        type: 'object',
        properties: {
          prefix: { type: 'string', description: 'Project prefix (2-5 uppercase chars)' },
          display_id: { type: 'string', description: 'Display identifier' },
          status: {
            type: 'string',
            enum: ['active', 'paused', 'completed', 'archived'],
            description: 'Project status',
          },
          phase: { type: 'string', description: 'Current phase' },
          wip_limit: { type: 'number', description: 'Work-in-progress limit' },
        },
        required: ['prefix', 'status'],
      },
    });

    ctx.registerNoteType({
      name: 'workstream',
      description: 'Parallel work track within a project',
      tier: 'slow',
      schema: {
        type: 'object',
        properties: {
          display_id: { type: 'string', description: 'Display identifier' },
          project: { type: 'string', description: 'Parent project prefix' },
          number: { type: 'number', description: 'Workstream number' },
          status: {
            type: 'string',
            enum: ['active', 'paused', 'completed'],
            description: 'Workstream status',
          },
        },
        required: ['project', 'number', 'status'],
      },
    });

    ctx.registerNoteType({
      name: 'task',
      description: 'Actionable work item',
      tier: 'slow',
      schema: {
        type: 'object',
        properties: {
          display_id: { type: 'string', description: 'Display identifier' },
          project: { type: 'string', description: 'Parent project prefix' },
          workstream: { type: 'number', description: 'Workstream number' },
          number: { type: 'number', description: 'Task number within workstream' },
          status: {
            type: 'string',
            enum: ['pending', 'claimed', 'in-progress', 'done', 'blocked', 'cancelled'],
            description: 'Task status',
          },
          mode: {
            type: 'string',
            enum: ['agent', 'assisted', 'human', 'review', 'auto', 'interactive'],
            description: 'Task execution mode',
          },
          category: {
            type: 'string',
            enum: [
              'implementation',
              'testing',
              'documentation',
              'research',
              'review',
              'infrastructure',
              'configuration',
              'design',
              'migration',
            ],
            description: 'Task category',
          },
          priority: {
            type: 'string',
            enum: ['critical', 'high', 'medium', 'low'],
            description: 'Task priority',
          },
          due_date: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
          milestone: { type: 'string', description: 'Milestone name' },
        },
        required: ['project', 'workstream', 'number', 'status', 'mode', 'category', 'priority'],
      },
    });

    ctx.registerNoteType({
      name: 'decision',
      description: 'Architectural or design decision record',
      tier: 'slow',
      schema: {
        type: 'object',
        properties: {
          display_id: { type: 'string', description: 'Display identifier' },
          project: { type: 'string', description: 'Parent project prefix' },
          status: {
            type: 'string',
            enum: ['proposed', 'accepted', 'superseded', 'rejected'],
            description: 'Decision status',
          },
          source_task: { type: 'string', description: 'Task that triggered this decision' },
        },
        required: ['project', 'status', 'source_task'],
      },
    });

    ctx.registerNoteType({
      name: 'prompt',
      description: 'LLM prompt template for task execution',
      tier: 'slow',
      schema: {
        type: 'object',
        properties: {
          display_id: { type: 'string', description: 'Display identifier' },
          project: { type: 'string', description: 'Parent project prefix' },
          task: { type: 'string', description: 'Associated task display ID' },
          prompt_status: {
            type: 'string',
            enum: ['stub', 'draft', 'current', 'stale', 'superseded'],
            description: 'Prompt lifecycle status',
          },
          version: { type: 'number', description: 'Prompt version number' },
        },
        required: ['project', 'task', 'prompt_status'],
      },
    });

    ctx.registerNoteType({
      name: 'capture',
      description: 'Quick capture for later processing',
      tier: 'fast',
      schema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Capture source identifier' },
          processed: { type: 'string', description: 'Whether capture has been processed' },
        },
        required: ['source'],
      },
    });

    ctx.registerNoteType({
      name: 'onboard-manifest',
      description: 'Onboarding activity manifest',
      tier: 'slow',
      schema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Parent project prefix' },
        },
        required: ['project'],
      },
    });

    ctx.registerRelationType({
      name: 'depends_on',
      description: 'Task dependency',
      inverse: 'blocks',
    });
    ctx.registerRelationType({
      name: 'blocks',
      description: 'Reverse of depends_on',
      inverse: 'depends_on',
    });
    ctx.registerRelationType({
      name: 'impacts',
      description: 'Decision impacts task',
    });
    ctx.registerRelationType({
      name: 'supersedes',
      description: 'Decision supersedes another',
    });

    ctx.registerExtractionStrategy({ shouldExtract: () => false });

    ctx.registerFilter({ visibility: 'private' });

    ctx.registerMigration({
      version: 1,
      description: 'Create PM metadata indexes',
      up: (db) => {
        const rawDb = db as { exec(sql: string): void };
        rawDb.exec(`
          CREATE INDEX IF NOT EXISTS idx_pm_display_id ON notes(module, json_extract(metadata, '$.display_id'));
          CREATE INDEX IF NOT EXISTS idx_pm_status ON notes(module, json_extract(metadata, '$.status'));
          CREATE INDEX IF NOT EXISTS idx_pm_project ON notes(module, json_extract(metadata, '$.project'));
          CREATE INDEX IF NOT EXISTS idx_pm_type ON notes(module, json_extract(metadata, '$.type'));
        `);
      },
    });

    const pmCmd = createPmCommand();
    pmCmd.addCommand(createWorkstreamCommands());
    pmCmd.addCommand(createTaskCommands());
    pmCmd.addCommand(createDecisionCommands());
    pmCmd.addCommand(createPromptCommands());
    pmCmd.addCommand(createContextCommand());
    pmCmd.addCommand(createVerifyCommand());
    for (const cmd of createOrchestrationCommands()) {
      pmCmd.addCommand(cmd);
    }
    for (const cmd of createCaptureCommands()) {
      pmCmd.addCommand(cmd);
    }
    pmCmd.addCommand(createAuditCommands());
    pmCmd.addCommand(createImportCommand());
    pmCmd.addCommand(createOrchestrateCommands());
    pmCmd.addCommand(createInstallHooksCommand());
    pmCmd.addCommand(createSetupCommand());
    pmCmd.addCommand(createCheckCommand());
    pmCmd.addCommand(createOnboardCommand());
    pmCmd.addCommand(createRelateCommand());

    // Plural aliases — delegate to subcommand
    const taskSubcommands = new Set([
      'add', 'list', 'show', 'update', 'done', 'block', 'unblock',
      'delete', 'claim', 'start', 'release',
    ]);
    const tasksAlias = new Command('tasks')
      .description('Task management (alias for "task")')
      .helpOption(false)
      .allowUnknownOption()
      .allowExcessArguments(true)
      .action(async () => {
        const idx = process.argv.indexOf('tasks');
        const tail = process.argv.slice(idx + 1);
        // Default to 'list' when no subcommand recognized
        const hasSubcommand = tail.length > 0 && taskSubcommands.has(tail[0]);
        const prefix = hasSubcommand ? [] : ['list'];
        await pmCmd.parseAsync(['node', 'brain-pm', 'task', ...prefix, ...tail], { from: 'node' });
      });
    pmCmd.addCommand(tasksAlias);

    const wsSubcommands = new Set(['list', 'show', 'add']);
    const workstreamsAlias = new Command('workstreams')
      .description('Workstream management (alias for "workstream")')
      .helpOption(false)
      .allowUnknownOption()
      .allowExcessArguments(true)
      .action(async () => {
        const idx = process.argv.indexOf('workstreams');
        const tail = process.argv.slice(idx + 1);
        const hasSubcommand = tail.length > 0 && wsSubcommands.has(tail[0]);
        const prefix = hasSubcommand ? [] : ['list'];
        await pmCmd.parseAsync(['node', 'brain-pm', 'workstream', ...prefix, ...tail], { from: 'node' });
      });
    pmCmd.addCommand(workstreamsAlias);

    const projectSubcommands = new Set(['list', 'show', 'add']);
    const projectsAlias = new Command('projects')
      .description('Project management (alias for "project")')
      .helpOption(false)
      .allowUnknownOption()
      .allowExcessArguments(true)
      .action(async () => {
        const idx = process.argv.indexOf('projects');
        const tail = process.argv.slice(idx + 1);
        const hasSubcommand = tail.length > 0 && projectSubcommands.has(tail[0]);
        const prefix = hasSubcommand ? [] : ['list'];
        await pmCmd.parseAsync(['node', 'brain-pm', 'project', ...prefix, ...tail], { from: 'node' });
      });
    pmCmd.addCommand(projectsAlias);

    const lsAlias = new Command('ls')
      .description('List projects (alias for "list")')
      .helpOption(false)
      .allowUnknownOption()
      .allowExcessArguments(true)
      .action(async () => {
        const idx = process.argv.indexOf('ls');
        const tail = process.argv.slice(idx + 1);
        await pmCmd.parseAsync(['node', 'brain-pm', 'list', ...tail], { from: 'node' });
      });
    pmCmd.addCommand(lsAlias);

    ctx.registerCommand(pmCmd);
  },
};
