import { Command, type CommandUnknownOpts } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { instantiateWorkflow, expandWorkflow } from '../data/workflow-ops.js';
import { advanceWorkflow } from '../engine/lifecycle.js';
import { getWorkflowDefinition, getInstanceStepStates } from '../data/queries.js';
import { dispatchTemplate } from '../engine/dispatch.js';

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
            JSON.stringify({ error: true, code: 'INVALID_CONTEXT', message: msg }) + '\n'
          );
        } else {
          process.stderr.write(`Error [INVALID_CONTEXT]: ${msg}\n`);
        }
        process.exitCode = 1;
        return;
      }

      await withBrain(async (svc) => {
        const result = await instantiateWorkflow(
          svc.db,
          svc.config,
          svc.embedder,
          workflowId,
          opts.project,
          context
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
          process.stdout.write(
            `Expanded: ${data.tasksCreated} tasks created, ${data.edges} edges\n`
          );
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

  const run = new Command('run')
    .description('Instantiate, expand, and dispatch the first step(s) of a workflow')
    .argument('<definition-id>', 'Workflow definition ID to run')
    .requiredOption('--project <prefix>', 'Project prefix for the instance')
    .option('--param <key=value...>', 'Parameter key=value pairs', [] as string[])
    .option('--template <name>', 'Override dispatch template for first step(s)')
    .option('--json', 'Output JSON')
    .action(async (definitionId, opts) => {
      let params: Record<string, string>;
      try {
        params = parseContextPairs(opts.param);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(
          formatError({ code: 'INVALID_PARAM', message: msg }, !!opts.json) + '\n'
        );
        process.exitCode = 1;
        return;
      }

      await withBrain(async (svc) => {
        // 1. Instantiate
        const instResult = await instantiateWorkflow(
          svc.db,
          svc.config,
          svc.embedder,
          definitionId,
          opts.project,
          params
        );
        if (!instResult.ok) {
          process.stderr.write(formatError(instResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        const instanceId = instResult.data.display_id;

        // 2. Expand
        const expandResult = await expandWorkflow(svc.db, svc.config, svc.embedder, instanceId);
        if (!expandResult.ok) {
          process.stderr.write(formatError(expandResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        // 3. Find entry steps (no unconditional predecessors)
        const defResult = getWorkflowDefinition(svc.db, definitionId);
        if (!defResult.ok) {
          process.stderr.write(formatError(defResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        const { definition } = defResult.data;
        const unconditionalEdges = definition.edges.filter((e) => !e.condition);
        const hasIncoming = new Set(unconditionalEdges.map((e) => e.to));
        const entrySteps = definition.steps.filter((s) => !hasIncoming.has(s.id));

        // 4. Map step IDs to task display IDs
        const stepsResult = getInstanceStepStates(svc.db, instanceId);
        const stepToTask = new Map<string, string>();
        if (stepsResult.ok) {
          for (const step of stepsResult.data.steps) {
            stepToTask.set(step.stepId, step.taskDisplayId);
          }
        }

        // 5. Dispatch first step(s)
        const dispatched: Array<{ stepId: string; taskId: string; template: string }> = [];
        const dispatchErrors: Array<{ stepId: string; error: string }> = [];

        for (const step of entrySteps) {
          const taskId = stepToTask.get(step.id);
          if (!taskId) continue;

          const templateName = opts.template ?? step.template;
          if (!templateName) {
            dispatchErrors.push({
              stepId: step.id,
              error: `No template specified (use --template or define template in step)`,
            });
            continue;
          }

          const dispatchResult = await dispatchTemplate(
            svc.db,
            svc.config,
            svc.embedder,
            taskId,
            templateName,
            { claim: true }
          );

          if (!dispatchResult.ok) {
            dispatchErrors.push({
              stepId: step.id,
              error: dispatchResult.error.message,
            });
            continue;
          }

          dispatched.push({ stepId: step.id, taskId, template: templateName });
        }

        // 6. Output
        if (opts.json) {
          process.stdout.write(
            JSON.stringify(
              {
                instance_id: instanceId,
                workflow_id: instResult.data.workflow_id,
                workflow_version: instResult.data.workflow_version,
                tasks_created: expandResult.data.tasksCreated,
                edges: expandResult.data.edges,
                dispatched,
                errors: dispatchErrors,
              },
              null,
              2
            ) + '\n'
          );
        } else {
          process.stdout.write(`Instance: ${instanceId}\n`);
          process.stdout.write(
            `  Workflow: ${instResult.data.workflow_id} v${instResult.data.workflow_version}\n`
          );
          process.stdout.write(
            `  Expanded: ${expandResult.data.tasksCreated} tasks, ${expandResult.data.edges} edges\n`
          );

          if (dispatched.length > 0) {
            process.stdout.write(`\nDispatched steps:\n`);
            for (const d of dispatched) {
              process.stdout.write(`  ${d.stepId} → ${d.taskId} (${d.template})\n`);
            }
          }

          if (dispatchErrors.length > 0) {
            process.stdout.write(`\nDispatch errors:\n`);
            for (const e of dispatchErrors) {
              process.stdout.write(`  ${e.stepId}: ${e.error}\n`);
            }
          }

          // Print the rendered template for the first dispatched step
          if (dispatched.length > 0) {
            const firstTask = dispatched[0];
            const rendered = await dispatchTemplate(
              svc.db,
              svc.config,
              svc.embedder,
              firstTask.taskId,
              firstTask.template,
              { dryRun: true }
            );
            if (rendered.ok) {
              process.stdout.write(`\n--- Dispatch prompt (${firstTask.stepId}) ---\n`);
              process.stdout.write(rendered.data.rendered + '\n');
            }
          }
        }
      });
    });

  return [add, expand, advance, run] as CommandUnknownOpts[];
}
