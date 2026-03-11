import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { registerWorkflow, getWorkflowStatus } from '../data/workflow-ops.js';
import { getWorkflowDefinition, listWorkflows, getInstanceStepStates } from '../data/queries.js';
import type { WorkflowNoteMetadata } from '../types.js';
import { dispatchTemplate } from '../engine/dispatch.js';

function formatWorkflowLine(wf: WorkflowNoteMetadata): string {
  return `${wf.display_id} - ${wf.name} v${wf.version} [${wf.registration_status}]`;
}

function formatError(error: { code: string; message: string }, json: boolean): string {
  if (json) {
    return JSON.stringify({ error: true, code: error.code, message: error.message });
  }
  return `Error [${error.code}]: ${error.message}`;
}

export function createWorkflowCommand(): Command {
  const cmd = new Command('workflow').description('Workflow definition management');

  cmd
    .command('register')
    .description('Register a workflow definition')
    .argument('<note-id>', 'Note ID of the workflow to register')
    .option('--json', 'Output JSON')
    .action(async (noteId, opts) => {
      await withBrain(async (svc) => {
        const result = await registerWorkflow(svc.db, svc.config, svc.embedder, noteId);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        const meta = result.data;
        if (opts.json) {
          process.stdout.write(JSON.stringify(meta, null, 2) + '\n');
        } else {
          process.stdout.write(`Registered workflow: ${meta.name}\n`);
          process.stdout.write(`  Version: ${meta.version}\n`);
          process.stdout.write(`  Steps: ${meta.step_count}\n`);
          process.stdout.write(`  Edges: ${meta.edge_count}\n`);
        }
      });
    });

  cmd
    .command('list')
    .description('List registered workflows')
    .option('--project <prefix>', 'Filter by project prefix')
    .option('--status <status>', 'Filter by registration status')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const filters: { project?: string; status?: string } = {};
        if (opts.project) filters.project = opts.project;
        if (opts.status) filters.status = opts.status;

        const result = listWorkflows(svc.db, filters);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const workflows = result.data;
        if (opts.json) {
          process.stdout.write(JSON.stringify(workflows, null, 2) + '\n');
        } else if (workflows.length === 0) {
          process.stdout.write('No workflows found.\n');
        } else {
          for (const wf of workflows) {
            process.stdout.write(formatWorkflowLine(wf) + '\n');
          }
        }
      });
    });

  cmd
    .command('show')
    .description('Show workflow definition details')
    .argument('<workflow-id>', 'Workflow display ID')
    .option('--json', 'Output JSON')
    .action(async (workflowId, opts) => {
      await withBrain(async (svc) => {
        const result = getWorkflowDefinition(svc.db, workflowId);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const { definition, metadata } = result.data;
        if (opts.json) {
          process.stdout.write(JSON.stringify({ metadata, definition }, null, 2) + '\n');
        } else {
          process.stdout.write(`${metadata.display_id} - ${metadata.name}\n`);
          process.stdout.write(`  Version: ${metadata.version}\n`);
          process.stdout.write(`  Steps: ${metadata.step_count}\n`);
          process.stdout.write(`  Edges: ${metadata.edge_count}\n`);
          if (definition.steps.length > 0) {
            process.stdout.write('\nSteps:\n');
            for (const step of definition.steps) {
              const mode = step.mode ? ` (${step.mode})` : '';
              process.stdout.write(`  ${step.id} - ${step.name}${mode}\n`);
            }
          }
        }
      });
    });

  cmd
    .command('status')
    .description('Show workflow instance status')
    .argument('<instance-id>', 'Instance display ID')
    .option('--history', 'Show execution history')
    .option('--json', 'Output JSON')
    .action(async (instanceId, opts) => {
      await withBrain(async (svc) => {
        const result = getWorkflowStatus(svc.db, instanceId);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const { instance: metadata, steps, progress } = result.data;

        if (opts.json) {
          process.stdout.write(JSON.stringify({ metadata, steps, progress }, null, 2) + '\n');
        } else {
          process.stdout.write(`Instance: ${instanceId}\n`);
          process.stdout.write(
            `  Workflow: ${metadata.workflow_id} v${metadata.workflow_version}\n`
          );
          process.stdout.write(`  Status: ${metadata.instance_status}\n`);
          process.stdout.write(
            `  Progress: ${progress.done}/${progress.total} done, ${progress.active} active, ${progress.pending} pending, ${progress.pruned} pruned\n`
          );

          if (steps.length > 0) {
            process.stdout.write('\nSteps:\n');
            for (const step of steps) {
              process.stdout.write(`  ${step.stepId} (${step.taskDisplayId}) - ${step.status}\n`);
            }
          }

          if (opts.history) {
            process.stdout.write('\nHistory not yet available.\n');
          }
        }
      });
    });

  cmd
    .command('dispatch')
    .description('Fill a dispatch template with task and project metadata')
    .argument('<task-id>', 'Brain PM task display ID (e.g., SDK-02.03)')
    .argument('<template>', 'Template name (e.g., implementation-compact)')
    .option('--branch <name>', 'Override auto-generated branch name')
    .option('--worktree <path>', 'Set worktree path')
    .option('--dry-run', 'Show filled template without claiming the task')
    .option('--claim', 'Auto-claim the task before dispatch')
    .option('--json', 'Output JSON with template and metadata')
    .action(async (taskId, templateName, opts) => {
      await withBrain(async (svc) => {
        const result = await dispatchTemplate(
          svc.db,
          svc.config,
          svc.embedder,
          taskId.toUpperCase(),
          templateName,
          {
            branch: opts.branch,
            worktree: opts.worktree,
            dryRun: opts.dryRun,
            claim: opts.claim,
          }
        );
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
        } else {
          if (result.data.mode === 'assisted') {
            process.stdout.write('## Assisted Step — Coordinator Instructions\n\n');
            process.stdout.write(
              'This step requires interactive coordination. Use this prompt in your current session.\n'
            );
            process.stdout.write('Do NOT dispatch this to an autonomous agent.\n\n');
            process.stdout.write('---\n\n');
          }
          process.stdout.write(result.data.rendered + '\n');
        }
      });
    });

  cmd
    .command('gate')
    .description('Set gate status for a workflow step')
    .argument('<instance-id>', 'Instance display ID')
    .argument('<step-id>', 'Step ID within the workflow')
    .argument('<action>', 'Gate action: pass')
    .option('--json', 'Output JSON')
    .action(async (instanceId, stepId, action, opts) => {
      if (action !== 'pass') {
        const msg = `Unknown gate action "${action}". Supported: pass`;
        process.stderr.write(
          formatError({ code: 'INVALID_ACTION', message: msg }, !!opts.json) + '\n'
        );
        process.exitCode = 1;
        return;
      }

      await withBrain(async (svc) => {
        const stepsResult = getInstanceStepStates(svc.db, instanceId);
        if (!stepsResult.ok) {
          process.stderr.write(formatError(stepsResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const step = stepsResult.data.steps.find((s) => s.stepId === stepId);
        if (!step) {
          const msg = `Step "${stepId}" not found in instance "${instanceId}"`;
          process.stderr.write(
            formatError({ code: 'NOT_FOUND', message: msg }, !!opts.json) + '\n'
          );
          process.exitCode = 1;
          return;
        }

        const taskNotes = svc.db.getModuleNoteIds({ module: 'pm', type: 'task' });
        const notes = svc.db.getNotesByIds(taskNotes);
        let updated = false;

        for (const [, note] of notes) {
          if (!note.metadata) continue;
          const meta = JSON.parse(note.metadata) as Record<string, unknown>;
          if (meta.display_id !== step.taskDisplayId) continue;

          const newMeta = { ...meta, gate_status: 'passed' };
          svc.db.upsertNote({ ...note, metadata: JSON.stringify(newMeta) });
          updated = true;
          break;
        }

        if (!updated) {
          const msg = `Could not update gate for task "${step.taskDisplayId}"`;
          process.stderr.write(
            formatError({ code: 'UPDATE_FAILED', message: msg }, !!opts.json) + '\n'
          );
          process.exitCode = 1;
          return;
        }

        if (opts.json) {
          process.stdout.write(
            JSON.stringify(
              { instance_id: instanceId, step_id: stepId, gate_status: 'passed' },
              null,
              2
            ) + '\n'
          );
        } else {
          process.stdout.write(`Gate passed for step "${stepId}" (${step.taskDisplayId})\n`);
        }
      });
    });

  return cmd;
}
