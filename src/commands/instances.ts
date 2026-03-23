import { Command } from '@commander-js/extra-typings';
import { resolve } from 'node:path';
import {
  listInstances,
  pruneStaleInstances,
  registerInstance,
  unregisterInstance,
  queryInstanceStatus,
  discoverInstances,
} from '../services/instance-registry.js';
import { GLOBAL_BRAIN_DIR } from '../services/config.js';
import { isJsonFormat } from './format.js';

const listSubcommand = new Command('list')
  .description('List all registered brain instances with auto-discovery')
  .option('--json', 'output as JSON')
  .option('--prune', 'remove stale entries (paths that no longer exist)')
  .action((opts, cmd) => {
    const globalDir = GLOBAL_BRAIN_DIR;

    if (opts.prune) {
      const pruned = pruneStaleInstances(globalDir);
      if (pruned > 0) {
        process.stderr.write(`Pruned ${pruned} stale instance(s)\n`);
      }
    }

    const instances = listInstances(globalDir);
    const discovered = discoverInstances(globalDir);

    if (isJsonFormat(opts, cmd)) {
      process.stdout.write(
        JSON.stringify({
          global: { path: globalDir, name: 'global' },
          instances,
          discovered,
        }) + '\n'
      );
    } else {
      process.stderr.write(`Global: ${globalDir}\n`);
      if (instances.length === 0) {
        process.stderr.write('No local instances registered.\n');
      } else {
        process.stderr.write(`\nRegistered instances (${instances.length}):\n`);
        for (const inst of instances) {
          const projects = inst.projects?.length ? `  [${inst.projects.join(', ')}]` : '';
          const primary = inst.primary ? ' (primary)' : '';
          process.stderr.write(`  ${inst.name}${primary}: ${inst.path}${projects}\n`);
        }
      }

      if (discovered.length > 0) {
        process.stderr.write(`\nDiscovered (not registered): ${discovered.length}\n`);
        for (const path of discovered) {
          process.stderr.write(`  ${path}\n`);
        }
        process.stderr.write(`  Run: brain instances register <path> <name>  to register\n`);
      }
    }
  });

const registerSubcommand = new Command('register')
  .description('Register a brain instance')
  .argument('<path>', 'path to the .brain directory')
  .argument('<name>', 'short name for the instance')
  .option('--projects <prefixes>', 'comma-separated PM project prefixes (e.g. VNM,BKM)')
  .option('--repo <path>', 'path to the git repository containing this brain')
  .option('--primary', 'mark this as the primary instance')
  .action((instancePath, name, opts) => {
    const globalDir = GLOBAL_BRAIN_DIR;
    const absPath = resolve(instancePath);

    const projects = opts.projects
      ? opts.projects
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
      : undefined;
    const repo = opts.repo ? resolve(opts.repo) : undefined;

    registerInstance(globalDir, absPath, name, {
      projects,
      repo,
      primary: opts.primary,
    });

    process.stderr.write(`Registered: ${name} → ${absPath}\n`);
    if (projects?.length) {
      process.stderr.write(`  Projects: ${projects.join(', ')}\n`);
    }
    if (repo) {
      process.stderr.write(`  Repo: ${repo}\n`);
    }
  });

const removeSubcommand = new Command('remove')
  .description('Unregister a brain instance by name or path')
  .argument('<name-or-path>', 'instance name or path to remove')
  .action((nameOrPath) => {
    const globalDir = GLOBAL_BRAIN_DIR;
    const removed = unregisterInstance(globalDir, nameOrPath);
    if (removed) {
      process.stderr.write(`Removed: ${nameOrPath}\n`);
    } else {
      process.stderr.write(`Not found: ${nameOrPath}\n`);
      process.exitCode = 1;
    }
  });

const statusSubcommand = new Command('status')
  .description('Show health and note counts for all registered instances')
  .option('--json', 'output as JSON')
  .action((opts, cmd) => {
    const globalDir = GLOBAL_BRAIN_DIR;
    const instances = listInstances(globalDir);

    if (instances.length === 0) {
      if (isJsonFormat(opts, cmd)) {
        process.stdout.write(JSON.stringify({ instances: [] }) + '\n');
      } else {
        process.stderr.write(
          'No instances registered. Run: brain instances register <path> <name>\n'
        );
      }
      return;
    }

    const statuses = instances.map(queryInstanceStatus);

    if (isJsonFormat(opts, cmd)) {
      process.stdout.write(JSON.stringify({ instances: statuses }) + '\n');
    } else {
      process.stderr.write(`Instance status (${statuses.length}):\n\n`);
      for (const s of statuses) {
        const primary = s.entry.primary ? ' [primary]' : '';
        process.stderr.write(`  ${s.entry.name}${primary}\n`);
        process.stderr.write(`    Path:         ${s.entry.path}\n`);
        if (s.error) {
          process.stderr.write(`    Status:       ERROR — ${s.error}\n`);
        } else {
          process.stderr.write(`    Notes:        ${s.noteCount}\n`);
          process.stderr.write(`    Last indexed: ${s.lastIndexed ?? 'never'}\n`);
          const projectList = s.projects.length ? s.projects.join(', ') : 'none';
          process.stderr.write(`    PM projects:  ${projectList}\n`);
        }
        if (s.entry.repo) {
          process.stderr.write(`    Repo:         ${s.entry.repo}\n`);
        }
        process.stderr.write('\n');
      }
    }
  });

export const instancesCommand = new Command('instances')
  .description('Manage brain instances')
  .addCommand(listSubcommand)
  .addCommand(registerSubcommand)
  .addCommand(removeSubcommand)
  .addCommand(statusSubcommand);
