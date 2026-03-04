import type { Command } from '@commander-js/extra-typings';
import type {
  BrainModule,
  ModuleNoteType,
  ModuleRelationType,
  ModuleExtractionStrategy,
  FilterProvider,
  ModuleMigration,
  DirectorySchema,
  ContentHandler,
} from './types.js';

export class ModuleRegistry {
  private modules = new Map<string, BrainModule>();
  private noteTypes = new Map<string, { module: string; noteType: ModuleNoteType }>();
  private relationTypes = new Map<string, { module: string; relationType: ModuleRelationType }>();
  private commands: Array<{ module: string; command: Command }> = [];
  private extractionStrategies: Array<{ module: string; strategy: ModuleExtractionStrategy }> = [];
  private filters: Array<{ module: string; filter: FilterProvider }> = [];
  private migrations: Array<{ module: string; migration: ModuleMigration }> = [];
  private contentHandlers: Array<{ module: string; handler: ContentHandler }> = [];

  registerModule(mod: BrainModule): void {
    if (this.modules.has(mod.name)) {
      throw new Error(`Module "${mod.name}" is already registered`);
    }
    this.modules.set(mod.name, mod);
  }

  getModule(name: string): BrainModule | undefined {
    return this.modules.get(name);
  }

  getModuleNames(): string[] {
    return [...this.modules.keys()];
  }

  // --- Note Types ---

  registerNoteType(moduleName: string, noteType: ModuleNoteType): void {
    const key = noteType.name;
    if (this.noteTypes.has(key)) {
      const existing = this.noteTypes.get(key)!;
      throw new Error(`Note type "${key}" already registered by module "${existing.module}"`);
    }
    this.noteTypes.set(key, { module: moduleName, noteType });
  }

  getNoteType(name: string): ModuleNoteType | undefined {
    return this.noteTypes.get(name)?.noteType;
  }

  getNoteTypeModule(name: string): string | undefined {
    return this.noteTypes.get(name)?.module;
  }

  getAllNoteTypes(): Array<{ module: string; noteType: ModuleNoteType }> {
    return [...this.noteTypes.values()];
  }

  // --- Relation Types ---

  registerRelationType(moduleName: string, relationType: ModuleRelationType): void {
    const key = relationType.name;
    if (this.relationTypes.has(key)) {
      const existing = this.relationTypes.get(key)!;
      throw new Error(`Relation type "${key}" already registered by module "${existing.module}"`);
    }
    this.relationTypes.set(key, { module: moduleName, relationType });
  }

  getRelationType(name: string): ModuleRelationType | undefined {
    return this.relationTypes.get(name)?.relationType;
  }

  // --- Commands ---

  registerCommand(moduleName: string, command: Command): void {
    this.commands.push({ module: moduleName, command });
  }

  getCommands(): Array<{ module: string; command: Command }> {
    return [...this.commands];
  }

  // --- Directory Schemas ---

  getDirectorySchema(noteTypeName: string): DirectorySchema | undefined {
    return this.noteTypes.get(noteTypeName)?.noteType.directorySchema;
  }

  // --- Extraction Strategies ---

  registerExtractionStrategy(moduleName: string, strategy: ModuleExtractionStrategy): void {
    this.extractionStrategies.push({ module: moduleName, strategy });
  }

  getExtractionStrategy(moduleName: string): ModuleExtractionStrategy | undefined {
    return this.extractionStrategies.find((s) => s.module === moduleName)?.strategy;
  }

  // --- Filters ---

  registerFilter(moduleName: string, filter: FilterProvider): void {
    this.filters.push({ module: moduleName, filter });
  }

  getFilters(): Array<{ module: string; filter: FilterProvider }> {
    return [...this.filters];
  }

  getFilterForModule(moduleName: string): FilterProvider | undefined {
    return this.filters.find((f) => f.module === moduleName)?.filter;
  }

  // --- Migrations ---

  registerMigration(moduleName: string, migration: ModuleMigration): void {
    this.migrations.push({ module: moduleName, migration });
  }

  getMigrations(moduleName?: string): Array<{ module: string; migration: ModuleMigration }> {
    if (moduleName) {
      return this.migrations.filter((m) => m.module === moduleName);
    }
    return [...this.migrations];
  }

  // --- Content Handlers ---

  registerContentHandler(moduleName: string, handler: ContentHandler): void {
    this.contentHandlers.push({ module: moduleName, handler });
  }

  getContentHandlers(): Array<{ module: string; handler: ContentHandler }> {
    return [...this.contentHandlers];
  }
}
