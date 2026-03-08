import { Command } from '@commander-js/extra-typings';

export function createResourceCommand(): Command {
  const cmd = new Command('resource').description('Workflow resource management');

  cmd
    .command('add')
    .description('Add a resource to a workflow')
    .action(() => {
      process.stderr.write('Not yet implemented\n');
      process.exitCode = 1;
    });

  cmd
    .command('list')
    .description('List workflow resources')
    .action(() => {
      process.stderr.write('Not yet implemented\n');
      process.exitCode = 1;
    });

  cmd
    .command('show')
    .description('Show resource details')
    .action(() => {
      process.stderr.write('Not yet implemented\n');
      process.exitCode = 1;
    });

  cmd
    .command('release')
    .description('Release a workflow resource')
    .action(() => {
      process.stderr.write('Not yet implemented\n');
      process.exitCode = 1;
    });

  return cmd;
}
