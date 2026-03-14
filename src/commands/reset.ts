import { Command } from '@commander-js/extra-typings';
import { rmSync, existsSync } from 'node:fs';
import {
  loadConfig,
  resolveInstance,
  parentResolveOpts,
  getConfigDir,
  getDataDir,
} from '../services/config.js';
import { isJsonFormat } from './format.js';

export const resetCommand = new Command('reset')
  .description('Remove all brain data and start fresh')
  .option('--confirm', 'required flag to confirm destructive operation')
  .option('--keep-config', 'keep configuration, only remove database and notes')
  .option('--json', 'output result as JSON')
  .action((opts, cmd) => {
    const instance = resolveInstance(parentResolveOpts(cmd));
    if (!opts.confirm) {
      process.stderr.write('This will permanently delete all brain data:\n');
      process.stderr.write(`  Database:  ${getDataDir(instance.root)}\n`);
      process.stderr.write(`  Config:    ${getConfigDir(instance.root)}\n`);
      try {
        const config = loadConfig(instance);
        process.stderr.write(`  Notes:     ${config.notesDir}\n`);
      } catch {
        // config may not exist yet
      }
      process.stderr.write('\nRun with --confirm to proceed.\n');
      process.exitCode = 1;
      return;
    }

    const removed: string[] = [];

    // Remove database and data directory
    const dataDir = getDataDir(instance.root);
    if (existsSync(dataDir)) {
      rmSync(dataDir, { recursive: true });
      removed.push(dataDir);
    }

    // Remove notes directory
    try {
      const config = loadConfig(instance);
      if (existsSync(config.notesDir)) {
        rmSync(config.notesDir, { recursive: true });
        removed.push(config.notesDir);
      }
    } catch {
      // config may not exist
    }

    // Remove config (unless --keep-config)
    if (!opts.keepConfig) {
      const configDir = getConfigDir(instance.root);
      if (existsSync(configDir)) {
        rmSync(configDir, { recursive: true });
        removed.push(configDir);
      }
    }

    if (isJsonFormat(opts, cmd)) {
      process.stdout.write(JSON.stringify({ removed }) + '\n');
    } else {
      if (removed.length === 0) {
        process.stderr.write('Nothing to remove — brain was not initialized.\n');
      } else {
        process.stderr.write('Brain reset complete. Removed:\n');
        for (const dir of removed) {
          process.stderr.write(`  ${dir}\n`);
        }
        process.stderr.write('\nRun "brain init" to start fresh.\n');
      }
    }
  });
