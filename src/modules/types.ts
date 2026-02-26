import type { Command } from '@commander-js/extra-typings';
import type { NoteRecord } from '../types.js';

/** Schema for validating module note frontmatter (JSON Schema subset) */
export interface ModuleConfigSchema {
  type: 'object';
  properties: Record<string, { type: string; enum?: string[]; description?: string }>;
  required?: string[];
}

/** Describes a directory structure for directory-backed notes */
export interface DirectorySchema {
  description: string;
  files: Array<{
    pattern: string;
    description: string;
    required?: boolean;
  }>;
}

/** A note type registered by a module */
export interface ModuleNoteType {
  name: string;
  description: string;
  tier: 'slow' | 'fast';
  schema?: ModuleConfigSchema;
  directorySchema?: DirectorySchema;
}

/** A relation type registered by a module */
export interface ModuleRelationType {
  name: string;
  description: string;
  inverse?: string;
}

/** Module-specific extraction strategy override */
export interface ModuleExtractionStrategy {
  shouldExtract: (note: NoteRecord) => boolean;
  extractionPrompt?: string;
}

/** Visibility level for module notes in search */
export type ModuleVisibility = 'public' | 'contextual' | 'private';

/** Filter provider for module-scoped queries */
export interface FilterProvider {
  visibility: ModuleVisibility;
  shouldIncludeInSearch?: (note: NoteRecord, query: string) => boolean;
}

/** A migration step for module schema changes */
export interface ModuleMigration {
  version: number;
  description: string;
  up: (db: unknown) => void;
}

/** Context object passed to module register() */
export interface ModuleContext {
  registerNoteType(noteType: ModuleNoteType): void;
  registerRelationType(relationType: ModuleRelationType): void;
  registerCommand(command: Command): void;
  registerExtractionStrategy(strategy: ModuleExtractionStrategy): void;
  registerFilter(filter: FilterProvider): void;
  registerMigration(migration: ModuleMigration): void;
}

/** The interface every brain module must implement */
export interface BrainModule {
  name: string;
  version: string;
  description: string;
  register(ctx: ModuleContext): void;
}
