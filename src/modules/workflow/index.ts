import type { BrainModule } from '../types.js';

export {
  resolveTemplate,
  listTemplateNames,
  listTemplates,
  renderTemplate,
  extractVariables,
} from './engine/templates.js';

export const workflowModule: BrainModule = {
  name: 'workflow',
  version: '2.0.0',
  description: 'V2 imperative workflow runtime with template-based agent dispatch',
  register(ctx) {
    ctx.registerExtractionStrategy({ shouldExtract: () => false });
    ctx.registerFilter({ visibility: 'private' });
  },
};
