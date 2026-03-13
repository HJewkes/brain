#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from '@commander-js/extra-typings';
import { initCommand } from './commands/init.js';
import { indexCommand } from './commands/index-cmd.js';
import { searchCommand } from './commands/search.js';
import { statusCommand } from './commands/status.js';
import { addCommand } from './commands/add.js';
import { staleCommand } from './commands/stale.js';
import { graphCommand } from './commands/graph.js';
import { templateCommand } from './commands/template.js';
import { archiveCommand } from './commands/archive.js';
import { configCommand } from './commands/config.js';
import { quickCommand } from './commands/quick.js';
import { inboxCommand } from './commands/inbox.js';
import { importCommand } from './commands/import.js';
import { feedCommand } from './commands/feed.js';
import { extractCommand } from './commands/extract.js';
import { memoriesCommand } from './commands/memories.js';
import { contextCommand } from './commands/context.js';
import { profileCommand } from './commands/profile.js';
import { tidyCommand } from './commands/tidy.js';
import { installHooksCommand } from './commands/install-hooks.js';
import { doctorCommand } from './commands/doctor.js';
import { lineageCommand } from './commands/lineage.js';
import { resetCommand } from './commands/reset.js';
import { notesCommand } from './commands/notes.js';
import { loadModules } from './modules/loader.js';
import { pmModule } from './modules/pm/index.js';
import { workflowModule } from './modules/workflow/index.js';
import { sessionsModule } from './modules/sessions/index.js';
import { instancesCommand } from './commands/instances.js';

const program = new Command()
  .name('brain')
  .description('Developer second brain with hybrid RAG search')
  .version((createRequire(import.meta.url)('../package.json') as { version: string }).version)
  .option('--global', 'Force use of global brain instance')
  .option('--instance <path>', 'Use specific brain instance at path');

program.addCommand(initCommand);
program.addCommand(indexCommand);
program.addCommand(searchCommand);
program.addCommand(statusCommand);
program.addCommand(addCommand);
program.addCommand(staleCommand);
program.addCommand(graphCommand);
program.addCommand(templateCommand);
program.addCommand(archiveCommand);
program.addCommand(configCommand);
program.addCommand(quickCommand);
program.addCommand(inboxCommand);
program.addCommand(importCommand);
program.addCommand(feedCommand);
program.addCommand(extractCommand);
program.addCommand(memoriesCommand);
program.addCommand(contextCommand);
program.addCommand(profileCommand);
program.addCommand(tidyCommand);
program.addCommand(installHooksCommand);
program.addCommand(doctorCommand);
program.addCommand(lineageCommand);
program.addCommand(resetCommand);
program.addCommand(notesCommand);
program.addCommand(instancesCommand);

async function main(): Promise<void> {
  const { registry } = await loadModules({ modules: [pmModule, workflowModule, sessionsModule] });
  for (const { command } of registry.getCommands()) {
    program.addCommand(command);
  }
  await program.parseAsync();
}

main().catch((err: Error) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exitCode = 1;
});
