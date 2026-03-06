import { Command } from '@commander-js/extra-typings';

const DEPRECATION_MESSAGE =
  'DEPRECATED: "brain pm install-hooks" has been replaced by "ao hook install".\n' +
  'Install ao-cli and run: ao hook install\n' +
  'To remove existing hooks: ao hook remove\n';

export function createInstallHooksCommand(): Command {
  return new Command('install-hooks')
    .description('[DEPRECATED] Use "ao hook install" instead')
    .option('--remove', 'Remove installed hooks and skill')
    .option('--dry-run', 'Preview changes without writing files')
    .action(() => {
      process.stderr.write(DEPRECATION_MESSAGE);
      process.exitCode = 1;
    }) as unknown as Command;
}
