#!/usr/bin/env node
import { Command } from '@commander-js/extra-typings'
import { initCommand } from './commands/init.js'
import { indexCommand } from './commands/index-cmd.js'
import { searchCommand } from './commands/search.js'
import { statusCommand } from './commands/status.js'

const program = new Command()
  .name('brain')
  .description('Developer second brain with hybrid RAG search')
  .version('0.1.0')

program.addCommand(initCommand)
program.addCommand(indexCommand)
program.addCommand(searchCommand)
program.addCommand(statusCommand)

program.parseAsync()
