import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import { assembleDispatch, type ContextBundle } from '../engine/dispatch.js';

function formatHuman(bundle: ContextBundle): string {
  const lines: string[] = [];

  const title = bundle.task.title ?? bundle.task.display_id;
  lines.push(`Task: ${bundle.task.display_id} - ${title}`);
  lines.push(`Status: ${bundle.task.status} | Priority: ${bundle.task.priority} | Category: ${bundle.task.category}`);

  if (bundle.workstream) {
    lines.push(`Workstream: ${bundle.workstream.displayId} - ${bundle.workstream.title}`);
  }
  lines.push('');

  if (bundle.body) {
    lines.push('--- Description ---');
    lines.push(bundle.body);
    lines.push('');
  }

  if (bundle.relatedNotes.length > 0) {
    lines.push('--- Related Notes ---');
    for (const note of bundle.relatedNotes) {
      lines.push(`  [${note.score.toFixed(2)}] ${note.title}`);
      if (note.excerpt) {
        lines.push(`    ${note.excerpt.slice(0, 200)}`);
      }
    }
    lines.push('');
  }

  if (bundle.prompt) {
    lines.push('--- Prompt ---');
    lines.push(bundle.prompt);
    lines.push('');
  }

  if (bundle.dependencies.length > 0) {
    lines.push('--- Dependencies ---');
    for (const dep of bundle.dependencies) {
      const summary = dep.summary ? ` - ${dep.summary}` : '';
      lines.push(`  ${dep.displayId} [${dep.status}] ${dep.name}${summary}`);
    }
    lines.push('');
  }

  if (bundle.decisions.length > 0) {
    lines.push('--- Decisions ---');
    for (const dec of bundle.decisions) {
      lines.push(`  ${dec.displayId} [${dec.status}] ${dec.content}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function createContextCommand(): Command {
  const cmd = new Command('context')
    .description('Assemble rich context for a task')
    .argument('<id>', 'Task display ID')
    .option('--decisions', 'Include decisions (default: true)')
    .option('--deps', 'Include dependencies (default: true)')
    .option('--since <timestamp>', 'Filter to activities/decisions after timestamp')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const displayId = id.toUpperCase();
        const result = await assembleDispatch(svc.db, svc.embedder, svc.config, displayId);

        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const bundle = result.data;

        // --since is accepted but not yet implemented (decisions lack timestamps)

        if (opts.json) {
          process.stdout.write(JSON.stringify(bundle, null, 2) + '\n');
          return;
        }

        process.stdout.write(formatHuman(bundle) + '\n');
      });
    });
  return cmd as unknown as Command;
}
