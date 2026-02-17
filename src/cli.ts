#!/usr/bin/env node
import { createRequire } from 'node:module'
import { Command } from '@commander-js/extra-typings'
import { initCommand } from './commands/init.js'
import { indexCommand } from './commands/index-cmd.js'
import { searchCommand } from './commands/search.js'
import { statusCommand } from './commands/status.js'
import { addCommand } from './commands/add.js'
import { staleCommand } from './commands/stale.js'
import { graphCommand } from './commands/graph.js'
import { templateCommand } from './commands/template.js'
import { archiveCommand } from './commands/archive.js'
import { configCommand } from './commands/config.js'

const program = new Command()
  .name('brain')
  .description('Developer second brain with hybrid RAG search')
  .version((createRequire(import.meta.url)('../package.json') as { version: string }).version)
  .option('--config-dir <path>', 'override config directory')
  .option('--db-path <path>', 'override database path')

program.addCommand(initCommand)
program.addCommand(indexCommand)
program.addCommand(searchCommand)
program.addCommand(statusCommand)
program.addCommand(addCommand)
program.addCommand(staleCommand)
program.addCommand(graphCommand)
program.addCommand(templateCommand)
program.addCommand(archiveCommand)
program.addCommand(configCommand)

program.parseAsync().catch((err: Error) => {
  process.stderr.write(`Error: ${err.message}\n`)
  process.exitCode = 1
})
