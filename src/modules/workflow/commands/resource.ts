import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import {
  createResource,
  listResources,
  getResource,
  releaseResource,
} from '../data/resource-ops.js';
import type { ResourceMetadata } from '../types.js';

function parseDataPairs(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const pair of raw.split(',')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    const val = pair.slice(eqIdx + 1).trim();
    result[key] = val;
  }
  return result;
}

export function createResourceCommand(): Command {
  const cmd = new Command('resource').description('Workflow resource management');

  cmd
    .command('add')
    .description('Add a resource to a workflow')
    .requiredOption('--type <type>', 'Resource type (worktree|branch|ownership|wip-slot)')
    .requiredOption('--project <prefix>', 'Project prefix')
    .option('--data <pairs>', 'Comma-separated key=val data pairs')
    .option('--id <id>', 'Custom display ID')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const displayId = opts.id ?? `RES-${Date.now().toString(36).toUpperCase()}`;
        const resource: ResourceMetadata = {
          display_id: displayId,
          resource_type: opts.type as ResourceMetadata['resource_type'],
          project: opts.project,
          status: 'active',
          data: opts.data ? parseDataPairs(opts.data) : {},
        };

        const result = await createResource(svc.db, svc.config, svc.embedder, resource);
        if (!result.ok) {
          process.stderr.write(`Error: ${result.error.message}\n`);
          process.exitCode = 1;
          return;
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
        } else {
          process.stdout.write(`Created resource ${result.data.id} (${result.data.type})\n`);
        }
      });
    });

  cmd
    .command('list')
    .description('List workflow resources')
    .option('--type <type>', 'Filter by resource type')
    .option('--project <prefix>', 'Filter by project')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const result = listResources(svc.db, {
          type: opts.type,
          project: opts.project,
        });
        if (!result.ok) {
          process.stderr.write(`Error: ${result.error.message}\n`);
          process.exitCode = 1;
          return;
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
        } else if (result.data.length === 0) {
          process.stdout.write('No resources found.\n');
        } else {
          for (const r of result.data) {
            process.stdout.write(`${r.id}  ${r.type}  ${r.project}  ${r.status}\n`);
          }
        }
      });
    });

  cmd
    .command('show')
    .description('Show resource details')
    .argument('<id>', 'Resource display ID')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const result = getResource(svc.db, id);
        if (!result.ok) {
          process.stderr.write(`Error: ${result.error.message}\n`);
          process.exitCode = 1;
          return;
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
        } else {
          const r = result.data;
          process.stdout.write(`ID:      ${r.id}\n`);
          process.stdout.write(`Type:    ${r.type}\n`);
          process.stdout.write(`Project: ${r.project}\n`);
          process.stdout.write(`Status:  ${r.status}\n`);
          process.stdout.write(`Data:    ${JSON.stringify(r.data)}\n`);
          process.stdout.write(`Updated: ${r.updatedAt}\n`);
        }
      });
    });

  cmd
    .command('release')
    .description('Release a workflow resource')
    .argument('<id>', 'Resource display ID')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const result = await releaseResource(svc.db, svc.config, svc.embedder, id);
        if (!result.ok) {
          process.stderr.write(`Error: ${result.error.message}\n`);
          process.exitCode = 1;
          return;
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
        } else {
          process.stdout.write(`Released resource ${result.data.id}\n`);
        }
      });
    });

  return cmd;
}
