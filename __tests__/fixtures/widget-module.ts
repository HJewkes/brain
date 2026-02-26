import type { BrainModule } from '../../src/modules/types.js';

export const widgetModule: BrainModule = {
  name: 'widget',
  version: '1.0.0',
  description: 'Test fixture module for integration tests',

  register(ctx) {
    ctx.registerNoteType({
      name: 'widget',
      description: 'A widget note type for testing',
      tier: 'slow',
      schema: {
        type: 'object',
        properties: {
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          assignee: { type: 'string' },
        },
        required: ['priority'],
      },
    });

    ctx.registerRelationType({
      name: 'depends-on',
      description: 'Widget dependency relationship',
      inverse: 'blocks',
    });

    ctx.registerFilter({
      visibility: 'private',
    });

    ctx.registerExtractionStrategy({
      shouldExtract: () => false,
    });

    ctx.registerMigration({
      version: 1,
      description: 'Initial widget migration (no-op)',
      up: () => {},
    });
  },
};
