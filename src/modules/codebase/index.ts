import { Command } from '@commander-js/extra-typings';
import type { BrainModule, ModuleNoteType } from '../types.js';
import { createCodebaseIndexCommand } from './commands/index-cmd.js';

const ARCHITECTURE_NOTE_TYPE: ModuleNoteType = {
  name: 'architecture',
  description: 'Module-level architecture documentation',
  tier: 'slow',
  schema: {
    type: 'object',
    properties: {
      'module-path': { type: 'string', description: 'Relative path to the module root' },
      language: { type: 'string', description: 'Primary programming language' },
      'exports-hash': { type: 'string', description: 'Hash of public API surface' },
      framework: { type: 'string', description: 'Framework or runtime (optional)' },
      dependencies: { type: 'array', description: 'Direct dependency module paths' },
      'last-analyzed': { type: 'string', description: 'ISO 8601 timestamp of last analysis' },
    },
    required: ['module-path', 'language', 'exports-hash'],
  },
};

export const codebaseModule: BrainModule = {
  name: 'codebase',
  version: '1.0.0',
  description: 'Codebase architecture documentation and module tracking',
  register(ctx) {
    ctx.registerNoteType(ARCHITECTURE_NOTE_TYPE);

    ctx.registerRelationType({
      name: 'describes',
      description: 'Architecture note documents this project or module',
    });

    ctx.registerExtractionStrategy({ shouldExtract: () => false });

    ctx.registerFilter({
      visibility: 'contextual',
      shouldIncludeInSearch(note, query) {
        const q = query.toLowerCase();
        return (
          q.includes('architecture') ||
          q.includes('module') ||
          q.includes('codebase') ||
          q.includes('exports')
        );
      },
    });

    const codebaseCmd = new Command('codebase').description(
      'Codebase architecture scanning and indexing'
    );
    codebaseCmd.addCommand(createCodebaseIndexCommand());
    ctx.registerCommand(codebaseCmd);
  },
};

export default codebaseModule;
