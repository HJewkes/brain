import { Command } from '@commander-js/extra-typings';

export function createLifecycleCommands(): Command[] {
  const add = new Command('add')
    .description('Add a workflow instance')
    .action(() => {
      process.stderr.write('Not yet implemented\n');
      process.exitCode = 1;
    });

  const expand = new Command('expand')
    .description('Expand a workflow step')
    .action(() => {
      process.stderr.write('Not yet implemented\n');
      process.exitCode = 1;
    });

  const advance = new Command('advance')
    .description('Advance a workflow to the next step')
    .action(() => {
      process.stderr.write('Not yet implemented\n');
      process.exitCode = 1;
    });

  return [add, expand, advance];
}
