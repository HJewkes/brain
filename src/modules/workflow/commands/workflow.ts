import { Command } from '@commander-js/extra-typings';

export function createWorkflowCommand(): Command {
  const cmd = new Command('workflow').description('Workflow definition management');

  cmd
    .command('register')
    .description('Register a workflow definition')
    .action(() => {
      process.stderr.write('Not yet implemented\n');
      process.exitCode = 1;
    });

  cmd
    .command('list')
    .description('List registered workflows')
    .action(() => {
      process.stderr.write('Not yet implemented\n');
      process.exitCode = 1;
    });

  cmd
    .command('show')
    .description('Show workflow definition details')
    .action(() => {
      process.stderr.write('Not yet implemented\n');
      process.exitCode = 1;
    });

  cmd
    .command('status')
    .description('Show workflow status')
    .action(() => {
      process.stderr.write('Not yet implemented\n');
      process.exitCode = 1;
    });

  return cmd;
}
