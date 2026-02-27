import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import {
  writePrompt,
  getPrompt,
  listPrompts,
  getPromptHistory,
} from '../data/prompt-ops.js';

function outputResult(data: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else if (Array.isArray(data)) {
    for (const item of data) {
      process.stdout.write(formatPromptLine(item) + '\n');
    }
    if (data.length === 0) {
      process.stdout.write('No prompts found.\n');
    }
  } else {
    process.stdout.write(formatPromptLine(data) + '\n');
  }
}

function formatPromptLine(p: unknown): string {
  const prompt = p as Record<string, unknown>;
  const ver = prompt.version ? ` v${prompt.version}` : '';
  return `${prompt.display_id}${ver} - ${prompt.prompt_status} (task: ${prompt.task})`;
}

export function createPromptCommands(): Command {
  const cmd = new Command('prompt').description('Manage prompts');

  cmd
    .command('write')
    .description('Write a prompt for a task')
    .argument('<task-id>', 'Task display ID')
    .requiredOption('--project <prefix>', 'Parent project prefix')
    .option('--content <text>', 'Prompt content (reads stdin if omitted)')
    .option('--json', 'Output JSON')
    .action(async (taskId, opts) => {
      await withBrain(async (svc) => {
        const content = opts.content ?? '';
        const result = await writePrompt(svc.db, svc.config, svc.embedder, {
          project: opts.project.toUpperCase(),
          task: taskId.toUpperCase(),
          content,
        });
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  cmd
    .command('show')
    .description('Show a prompt for a task')
    .argument('<task-id>', 'Task display ID')
    .option('--version <n>', 'Specific version number')
    .option('--json', 'Output JSON')
    .action(async (taskId, opts) => {
      await withBrain(async (svc) => {
        const version = opts.version ? Number(opts.version) : undefined;
        const result = getPrompt(svc.db, taskId.toUpperCase(), version);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
        } else {
          const d = result.data;
          process.stdout.write(formatPromptLine(d) + '\n');
          if (d.content) {
            process.stdout.write('\n' + d.content + '\n');
          }
        }
      });
    });

  cmd
    .command('list')
    .description('List prompts')
    .option('--project <prefix>', 'Filter by project prefix')
    .option('--status <status>', 'Filter by prompt status')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        if (!opts.project) {
          process.stderr.write(
            formatError({ error: true, code: 'INVALID_INPUT', message: '--project is required for listing prompts' }, !!opts.json) + '\n',
          );
          process.exitCode = 1;
          return;
        }
        const result = listPrompts(svc.db, opts.project.toUpperCase(), {
          status: opts.status,
        });
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  cmd
    .command('history')
    .description('Show prompt history for a task')
    .argument('<task-id>', 'Task display ID')
    .option('--json', 'Output JSON')
    .action(async (taskId, opts) => {
      await withBrain(async (svc) => {
        const result = getPromptHistory(svc.db, taskId.toUpperCase());
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  return cmd;
}
