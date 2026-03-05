import type { BrainModule } from '../types.js';

// TODO: Add importHints (archetypeText, tableColumnAliases) to each note type
// once Task 1 adds the importHints field to ModuleNoteType. The archetype texts
// are documented in the task-03 briefing and sourced from content-archetypes.ts.

export const knowledgeModule: BrainModule = {
  name: 'knowledge',
  version: '1.0.0',
  description: 'Core knowledge note types and content handling',
  register(ctx) {
    ctx.registerNoteType({
      name: 'note',
      description: 'General knowledge note',
      tier: 'slow',
    });

    ctx.registerNoteType({
      name: 'research',
      description: 'In-depth research or analysis',
      tier: 'slow',
    });

    ctx.registerNoteType({
      name: 'meeting',
      description: 'Meeting notes with attendees and action items',
      tier: 'fast',
    });

    ctx.registerNoteType({
      name: 'guide',
      description: 'How-to guide or tutorial',
      tier: 'slow',
    });

    ctx.registerNoteType({
      name: 'pattern',
      description: 'Recurring pattern or best practice',
      tier: 'slow',
    });

    ctx.registerNoteType({
      name: 'session-log',
      description: 'Work session log entry',
      tier: 'fast',
    });
  },
};

export default knowledgeModule;
