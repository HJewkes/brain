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

/** @deprecated Use ModuleNoteType.importHints directly — ImportHints is now in types.ts */
export type ImportableNoteType = ModuleNoteType;

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

  // --- Import Hints ---

  /** Returns all note types that have importHints configured */
  getImportableNoteTypes(): Array<{ module: string; noteType: ImportableNoteType }> {
    return (this.getAllNoteTypes() as Array<{ module: string; noteType: ImportableNoteType }>).filter(
      ({ noteType }) => noteType.importHints
    );
  }

  /** Match CSV/table column headers against registered tableColumnAliases.
   *  Returns the best-matching note type if 2+ columns match, else null. */
  matchColumnHeaders(
    headers: string[]
  ): { module: string; noteType: string; columnMapping: Record<string, string> } | null {
    const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
    let bestMatch: {
      module: string;
      noteType: string;
      columnMapping: Record<string, string>;
      hits: number;
    } | null = null;

    for (const { module, noteType } of this.getImportableNoteTypes()) {
      const aliases = noteType.importHints?.tableColumnAliases;
      if (!aliases) continue;

      const mapping: Record<string, string> = {};
      let hits = 0;

      for (const [schemaField, columnNames] of Object.entries(aliases)) {
        const matched = lowerHeaders.find((h) =>
          columnNames.map((c) => c.toLowerCase()).includes(h)
        );
        if (matched) {
          mapping[matched] = schemaField;
          hits++;
        }
      }

      if (hits >= 2 && (!bestMatch || hits > bestMatch.hits)) {
        bestMatch = { module, noteType: noteType.name, columnMapping: mapping, hits };
      }
    }

    return bestMatch
      ? { module: bestMatch.module, noteType: bestMatch.noteType, columnMapping: bestMatch.columnMapping }
      : null;
  }

  /** Returns archetype texts for embedding-based classification */
  getArchetypeTexts(): Map<string, string> {
    const result = new Map<string, string>();
    for (const { noteType } of this.getImportableNoteTypes()) {
      if (noteType.importHints?.archetypeText) {
        result.set(noteType.name, noteType.importHints.archetypeText);
      }
    }
    return result;
  }
}
