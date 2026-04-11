import type { BrainModule } from './types.js';
import { pmModule } from './pm/index.js';
import { workflowModule } from './workflow/index.js';
import { sessionsModule } from './sessions/index.js';
import { agentsModule } from './agents/index.js';
import { codebaseModule } from './codebase/index.js';
import { autoloopModule } from './autoloop/index.js';

export function getBuiltinModules(): BrainModule[] {
  return [pmModule, workflowModule, sessionsModule, agentsModule, codebaseModule, autoloopModule];
}
