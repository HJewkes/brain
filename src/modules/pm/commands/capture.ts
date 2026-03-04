import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import { createCapture, listCaptures, processCapture } from '../data/capture-ops.js';
import { resolveProject } from '../data/queries.js';

function outputResult(data: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else if (Array.isArray(data)) {
    for (const item of data) {
      process.stdout.write(formatCaptureLine(item) + '\n');
    }
    if (data.length === 0) {
      process.stdout.write('No captures found.\n');
    }
  } else {
    process.stdout.write(formatCaptureLine(data) + '\n');
  }
}

function formatCaptureLine(capture: unknown): string {
  const c = capture as Record<string, unknown>;
  const content = String(c.content ?? '').slice(0, 60);
  const processed = c.processed ? ' [processed]' : '';
  const project = c.project ? ` (${c.project})` : '';
  return `${c.noteId}${project}${processed} — ${content}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createCaptureCommands(): Command<any, any, any>[] {
  const captureCmd = new Command('capture')
    .description('Quick capture a note')
    .argument('<text>', 'Text to capture')
    .option('--project <p>', 'Project scope')
    .option('--source <s>', 'Capture source', 'cli')
    .option('--json', 'Output JSON')
    .action(async (text, opts) => {
      await withBrain(async (svc) => {
        const result = await createCapture(svc.db, svc.config, svc.embedder, {
          content: text,
          source: opts.source,
          project: opts.project,
        });
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  const inboxCmd = new Command('inbox')
    .description('List unprocessed captures')
    .option('--project <p>', 'Filter by project')
    .option('--all', 'Include processed captures')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const processed = opts.all ? undefined : false;
        const result = listCaptures(svc.db, {
          project: opts.project,
          processed,
        });
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  const processCmd = new Command('process')
    .description('Process a capture into a task')
    .argument('<capture-id>', 'Capture note ID')
    .requiredOption('--task-name <n>', 'Name for the new task')
    .requiredOption('--workstream <ws>', 'Workstream number', parseInt)
    .requiredOption(
      '--description <text>',
      'Task description/body content (required for search indexing)'
    )
    .option('--project <p>', 'Project prefix (uses active if omitted)')
    .option('--json', 'Output JSON')
    .action(async (captureId, opts) => {
      await withBrain(async (svc) => {
        const projectResult = resolveProject(svc.db, opts.project);
        if (!projectResult.ok) {
          process.stderr.write(formatError(projectResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        const project = projectResult.data;
        const result = await processCapture(svc.db, svc.config, svc.embedder, captureId, {
          project,
          workstream: opts.workstream,
          name: opts.taskName,
          description: opts.description,
        });
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
        } else {
          process.stdout.write(`Processed capture into task ${result.data.display_id}\n`);
        }
      });
    });

  return [captureCmd, inboxCmd, processCmd];
}
