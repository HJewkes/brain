import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import { assembleContext } from '../engine/dispatch.js';
import type { ContextBundle } from '../engine/dispatch.js';

function filterBySince(bundle: ContextBundle, since: string): ContextBundle {
  const sinceDate = new Date(since);
  const filtered = { ...bundle };
  filtered.decisions = bundle.decisions.filter(() => {
    // Decisions don't carry timestamps in DecisionSummary;
    // the --since filter is best-effort based on available data.
    // Keep all decisions since we can't determine their creation time
    // from the summary alone.
    return true;
  });
  return filtered;
}

function formatHuman(bundle: ContextBundle): string {
  const lines: string[] = [];

  lines.push(`Task: ${bundle.task.display_id}`);
  lines.push(`Status: ${bundle.task.status}`);
  lines.push(`Category: ${bundle.task.category}`);
  lines.push(`Priority: ${bundle.task.priority}`);
  lines.push('');

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

  lines.push(`Context hash: ${bundle.contextHash}`);
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
        const result = assembleContext(svc.db, displayId);

        if (!result.ok) {
          process.stderr.write(
            formatError(result.error, !!opts.json) + '\n',
          );
          process.exitCode = 1;
          return;
        }

        let bundle = result.data;

        if (opts.since) {
          bundle = filterBySince(bundle, opts.since);
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify(bundle, null, 2) + '\n');
          return;
        }

        process.stdout.write(formatHuman(bundle) + '\n');
      });
    });
  return cmd as unknown as Command;
}
