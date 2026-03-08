import { Command, type CommandUnknownOpts } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { instantiateWorkflow, expandWorkflow } from '../data/workflow-ops.js';
import { advanceWorkflow } from '../engine/lifecycle.js';

function formatError(error: { code: string; message: string }, json: boolean): string {
  if (json) {
    return JSON.stringify({ error: true, code: error.code, message: error.message });
  }
  return `Error [${error.code}]: ${error.message}`;
}

function parseContextPairs(pairs: string[]): Record<string, string> {
  const context: Record<string, string> = {};
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) {
      throw new Error(`Invalid context pair: "${pair}" (expected key=value)`);
    }
    context[pair.slice(0, eqIndex)] = pair.slice(eqIndex + 1);
  }
  return context;
}

export function createLifecycleCommands(): CommandUnknownOpts[] {
  const add = new Command('add')
    .description('Add a workflow instance')
    .argument('<workflow-id>', 'Workflow definition ID to instantiate')
    .requiredOption('--project <prefix>', 'Project prefix for the instance')
    .option('--context <key=value...>', 'Context key=value pairs', [] as string[])
    .option('--json', 'Output JSON')
    .action(async (workflowId, opts) => {
      let context: Record<string, string>;
      try {
        context = parseContextPairs(opts.context);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (opts.json) {
          process.stderr.write(
            JSON.stringify({ error: true, code: 'INVALID_CONTEXT', message: msg }) + '\n',
          );
        } else {
          process.stderr.write(`Error [INVALID_CONTEXT]: ${msg}\n`);
        }
        process.exitCode = 1;
        return;
      }

      await withBrain(async (svc) => {
        const result = await instantiateWorkflow(
          svc.db, svc.config, svc.embedder, workflowId, opts.project, context,
        );
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        const data = result.data;
        if (opts.json) {
          process.stdout.write(JSON.stringify(data, null, 2) + '\n');
        } else {
          process.stdout.write(`Created workflow instance ${data.display_id}\n`);
          process.stdout.write(`  Workflow: ${data.workflow_id} v${data.workflow_version}\n`);
          process.stdout.write(`  Status: ${data.instance_status}\n`);
        }
      });
    });

  const expand = new Command('expand')
    .description('Expand a workflow instance into tasks')
    .argument('<instance-id>', 'Instance display ID to expand')
    .option('--json', 'Output JSON')
    .action(async (instanceId, opts) => {
      await withBrain(async (svc) => {
        const result = await expandWorkflow(svc.db, svc.config, svc.embedder, instanceId);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        const data = result.data;
        if (opts.json) {
          process.stdout.write(JSON.stringify(data, null, 2) + '\n');
        } else {
          process.stdout.write(`Expanded: ${data.tasksCreated} tasks created, ${data.edges} edges\n`);
        }
      });
    });

  const advance = new Command('advance')
    .description('Advance a workflow to the next step')
    .argument('<instance-id>', 'Instance display ID to advance')
    .option('--json', 'Output JSON')
    .action(async (instanceId, opts) => {
      await withBrain(async (svc) => {
        const result = await advanceWorkflow(svc.db, svc.config, instanceId);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        const data = result.data;
        if (opts.json) {
          process.stdout.write(JSON.stringify(data, null, 2) + '\n');
        } else {
          const advancedStr = data.advanced.length > 0 ? data.advanced.join(', ') : '(none)';
          const prunedStr = data.pruned.length > 0 ? data.pruned.join(', ') : '(none)';
          process.stdout.write(`Advanced: ${advancedStr}\n`);
          process.stdout.write(`Pruned: ${prunedStr}\n`);
          if (data.warnings.length > 0) {
            process.stdout.write(`Warnings: ${data.warnings.join('; ')}\n`);
          }
          process.stdout.write(`Completed: ${data.completed}\n`);
        }
      });
    });

  return [add, expand, advance] as CommandUnknownOpts[];
}
