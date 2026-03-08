import { Command } from '@commander-js/extra-typings';

export function createCollapseCommand(): Command {
  return new Command('collapse')
    .description('Collapse a workflow expansion')
    .action(() => {
      process.stderr.write('Not yet implemented\n');
      process.exitCode = 1;
    });
}
