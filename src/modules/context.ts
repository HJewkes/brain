import type { Command } from '@commander-js/extra-typings';
import type {
  ModuleContext,
  ModuleNoteType,
  ModuleRelationType,
  ModuleExtractionStrategy,
  FilterProvider,
  ModuleMigration,
} from './types.js';
import type { ModuleRegistry } from './registry.js';

export function createModuleContext(registry: ModuleRegistry, moduleName: string): ModuleContext {
  return {
    registerNoteType(noteType: ModuleNoteType): void {
      registry.registerNoteType(moduleName, noteType);
    },
    registerRelationType(relationType: ModuleRelationType): void {
      registry.registerRelationType(moduleName, relationType);
    },
    registerCommand(command: Command): void {
      registry.registerCommand(moduleName, command);
    },
    registerExtractionStrategy(strategy: ModuleExtractionStrategy): void {
      registry.registerExtractionStrategy(moduleName, strategy);
    },
    registerFilter(filter: FilterProvider): void {
      registry.registerFilter(moduleName, filter);
    },
    registerMigration(migration: ModuleMigration): void {
      registry.registerMigration(moduleName, migration);
    },
  };
}
