import { Command } from '@commander-js/extra-typings';
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';

const HOOK_FILENAME = 'post-merge';

export function getHookScript(): string {
  const templatePath = resolve(
    import.meta.dirname,
    '..',
    '..',
    '..',
    '..',
    'templates',
    'hooks',
    HOOK_FILENAME
  );
  return readFileSync(templatePath, 'utf-8');
}

export function resolveHookPath(gitDir: string): string {
  return join(gitDir, 'hooks', HOOK_FILENAME);
}

export interface InstallHookResult {
  installed: boolean;
  path: string;
  skipped?: boolean;
  overwritten?: boolean;
}

export function installHook(gitDir: string, opts: { force?: boolean }): InstallHookResult {
  const hooksDir = join(gitDir, 'hooks');
  const hookPath = resolveHookPath(gitDir);

  if (existsSync(hookPath) && !opts.force) {
    return { installed: false, path: hookPath, skipped: true };
  }

  mkdirSync(hooksDir, { recursive: true });
  const overwritten = existsSync(hookPath);
  writeFileSync(hookPath, getHookScript(), 'utf-8');
  chmodSync(hookPath, 0o755);

  return { installed: true, path: hookPath, overwritten };
}

export function createInstallHookCommand(): Command {
  const cmd = new Command('install-hook')
    .description('Install git post-merge hook for automatic reindexing')
    .option('--force', 'Overwrite existing hook')
    .action((opts) => {
      const gitDir = resolve(process.cwd(), '.git');
      if (!existsSync(gitDir)) {
        process.stderr.write('Error: not a git repository\n');
        process.exitCode = 1;
        return;
      }

      const result = installHook(gitDir, { force: opts.force });

      if (result.skipped) {
        process.stderr.write(`Warning: ${result.path} already exists. Use --force to overwrite.\n`);
        return;
      }

      const verb = result.overwritten ? 'Overwritten' : 'Installed';
      process.stderr.write(`${verb} post-merge hook: ${result.path}\n`);
    });

  return cmd;
}
