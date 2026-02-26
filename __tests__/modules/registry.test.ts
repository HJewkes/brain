import { describe, it, expect, beforeEach } from 'vitest';
import { ModuleRegistry } from '../../src/modules/registry.js';
import type {
  BrainModule,
  ModuleNoteType,
  ModuleRelationType,
  ModuleExtractionStrategy,
  FilterProvider,
  ModuleMigration,
} from '../../src/modules/types.js';

function makeMockModule(name = 'test-module'): BrainModule {
  return {
    name,
    version: '1.0.0',
    description: `The ${name} module`,
    register: () => {},
  };
}

function makeMockNoteType(name = 'epic', overrides?: Partial<ModuleNoteType>): ModuleNoteType {
  return {
    name,
    description: 'An epic note type',
    tier: 'slow',
    ...overrides,
  };
}

describe('ModuleRegistry', () => {
  let registry: ModuleRegistry;

  beforeEach(() => {
    registry = new ModuleRegistry();
  });

  // --- Module registration ---

  describe('registerModule', () => {
    it('registers a module and retrieves it by name', () => {
      const mod = makeMockModule('pm');
      registry.registerModule(mod);

      expect(registry.getModule('pm')).toBe(mod);
      expect(registry.getModuleNames()).toEqual(['pm']);
    });

    it('throws on duplicate module registration', () => {
      registry.registerModule(makeMockModule('pm'));

      expect(() => registry.registerModule(makeMockModule('pm'))).toThrow(
        'Module "pm" is already registered'
      );
    });

    it('returns undefined for unknown module', () => {
      expect(registry.getModule('nonexistent')).toBeUndefined();
    });

    it('lists multiple module names', () => {
      registry.registerModule(makeMockModule('pm'));
      registry.registerModule(makeMockModule('eng'));

      expect(registry.getModuleNames()).toEqual(['pm', 'eng']);
    });
  });

  // --- Note Types ---

  describe('note types', () => {
    it('registers and retrieves a note type', () => {
      const noteType = makeMockNoteType('epic');
      registry.registerNoteType('pm', noteType);

      expect(registry.getNoteType('epic')).toBe(noteType);
      expect(registry.getNoteTypeModule('epic')).toBe('pm');
    });

    it('returns all registered note types', () => {
      const epic = makeMockNoteType('epic');
      const story = makeMockNoteType('story');
      registry.registerNoteType('pm', epic);
      registry.registerNoteType('pm', story);

      const all = registry.getAllNoteTypes();
      expect(all).toHaveLength(2);
      expect(all[0]).toEqual({ module: 'pm', noteType: epic });
      expect(all[1]).toEqual({ module: 'pm', noteType: story });
    });

    it('throws on duplicate note type', () => {
      registry.registerNoteType('pm', makeMockNoteType('epic'));

      expect(() => registry.registerNoteType('eng', makeMockNoteType('epic'))).toThrow(
        'Note type "epic" already registered by module "pm"'
      );
    });

    it('returns undefined for unknown note type', () => {
      expect(registry.getNoteType('nonexistent')).toBeUndefined();
      expect(registry.getNoteTypeModule('nonexistent')).toBeUndefined();
    });
  });

  // --- Relation Types ---

  describe('relation types', () => {
    it('registers and retrieves a relation type', () => {
      const rel: ModuleRelationType = {
        name: 'blocks',
        description: 'This item blocks another',
        inverse: 'blocked-by',
      };
      registry.registerRelationType('pm', rel);

      expect(registry.getRelationType('blocks')).toBe(rel);
    });

    it('throws on duplicate relation type', () => {
      const rel: ModuleRelationType = { name: 'blocks', description: 'Blocks' };
      registry.registerRelationType('pm', rel);

      expect(() => registry.registerRelationType('eng', rel)).toThrow(
        'Relation type "blocks" already registered by module "pm"'
      );
    });

    it('returns undefined for unknown relation type', () => {
      expect(registry.getRelationType('nonexistent')).toBeUndefined();
    });
  });

  // --- Commands ---

  describe('commands', () => {
    it('registers and retrieves commands', () => {
      const cmd = {} as any;
      registry.registerCommand('pm', cmd);

      const commands = registry.getCommands();
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({ module: 'pm', command: cmd });
    });

    it('returns empty array when no commands registered', () => {
      expect(registry.getCommands()).toEqual([]);
    });
  });

  // --- Directory Schemas ---

  describe('directory schemas', () => {
    it('returns directory schema from a note type', () => {
      const dirSchema = {
        description: 'Epic directory',
        files: [{ pattern: 'README.md', description: 'Overview', required: true }],
      };
      const noteType = makeMockNoteType('epic', { directorySchema: dirSchema });
      registry.registerNoteType('pm', noteType);

      expect(registry.getDirectorySchema('epic')).toBe(dirSchema);
    });

    it('returns undefined when note type has no directory schema', () => {
      registry.registerNoteType('pm', makeMockNoteType('epic'));

      expect(registry.getDirectorySchema('epic')).toBeUndefined();
    });

    it('returns undefined for unknown note type', () => {
      expect(registry.getDirectorySchema('nonexistent')).toBeUndefined();
    });
  });

  // --- Extraction Strategies ---

  describe('extraction strategies', () => {
    it('registers and retrieves an extraction strategy', () => {
      const strategy: ModuleExtractionStrategy = {
        shouldExtract: () => true,
        extractionPrompt: 'Extract PM facts',
      };
      registry.registerExtractionStrategy('pm', strategy);

      expect(registry.getExtractionStrategy('pm')).toBe(strategy);
    });

    it('returns undefined for unknown module', () => {
      expect(registry.getExtractionStrategy('nonexistent')).toBeUndefined();
    });
  });

  // --- Filters ---

  describe('filters', () => {
    it('registers and retrieves filters', () => {
      const filter: FilterProvider = { visibility: 'public' };
      registry.registerFilter('pm', filter);

      const all = registry.getFilters();
      expect(all).toHaveLength(1);
      expect(all[0]).toEqual({ module: 'pm', filter });
    });

    it('retrieves filter for a specific module', () => {
      const pmFilter: FilterProvider = { visibility: 'public' };
      const engFilter: FilterProvider = { visibility: 'contextual' };
      registry.registerFilter('pm', pmFilter);
      registry.registerFilter('eng', engFilter);

      expect(registry.getFilterForModule('pm')).toBe(pmFilter);
      expect(registry.getFilterForModule('eng')).toBe(engFilter);
    });

    it('returns undefined for unknown module filter', () => {
      expect(registry.getFilterForModule('nonexistent')).toBeUndefined();
    });
  });

  // --- Migrations ---

  describe('migrations', () => {
    it('registers and retrieves all migrations', () => {
      const m1: ModuleMigration = { version: 1, description: 'Init', up: () => {} };
      const m2: ModuleMigration = { version: 2, description: 'Add field', up: () => {} };
      registry.registerMigration('pm', m1);
      registry.registerMigration('eng', m2);

      const all = registry.getMigrations();
      expect(all).toHaveLength(2);
    });

    it('retrieves migrations filtered by module', () => {
      const m1: ModuleMigration = { version: 1, description: 'Init', up: () => {} };
      const m2: ModuleMigration = { version: 2, description: 'Add field', up: () => {} };
      registry.registerMigration('pm', m1);
      registry.registerMigration('eng', m2);

      const pmMigrations = registry.getMigrations('pm');
      expect(pmMigrations).toHaveLength(1);
      expect(pmMigrations[0]).toEqual({ module: 'pm', migration: m1 });
    });

    it('returns empty array when no migrations for module', () => {
      expect(registry.getMigrations('nonexistent')).toEqual([]);
    });
  });
});
