import { describe, it, expect } from 'vitest';
import { autoloopModule } from '../../../src/modules/autoloop/index.js';
import { ModuleRegistry } from '../../../src/modules/registry.js';
import { createModuleContext } from '../../../src/modules/context.js';

describe('autoloop module', () => {
  it('has correct metadata', () => {
    expect(autoloopModule.name).toBe('autoloop');
    expect(autoloopModule.version).toBe('0.1.0');
    expect(typeof autoloopModule.register).toBe('function');
  });

  it('registers without errors', () => {
    const registry = new ModuleRegistry();
    registry.registerModule(autoloopModule);
    const ctx = createModuleContext(registry, 'autoloop');
    expect(() => autoloopModule.register(ctx)).not.toThrow();
  });

  it('registers note types', () => {
    const registry = new ModuleRegistry();
    registry.registerModule(autoloopModule);
    const ctx = createModuleContext(registry, 'autoloop');
    autoloopModule.register(ctx);

    const noteTypes = registry.getAllNoteTypes();
    const names = noteTypes.map((nt) => nt.noteType.name);
    expect(names).toContain('autoloop-report');
    expect(names).toContain('autoloop-insight');
  });

  it('registers relation types', () => {
    const registry = new ModuleRegistry();
    registry.registerModule(autoloopModule);
    const ctx = createModuleContext(registry, 'autoloop');
    autoloopModule.register(ctx);

    expect(registry.getRelationType('reviewed-in')).toBeDefined();
    expect(registry.getRelationType('reviewed-session')).toBeDefined();
    expect(registry.getRelationType('enriched-by')).toBeDefined();
    expect(registry.getRelationType('enriched-task')).toBeDefined();
    expect(registry.getRelationType('insight-from')).toBeDefined();
    expect(registry.getRelationType('has-insight')).toBeDefined();
  });

  it('registers commands', () => {
    const registry = new ModuleRegistry();
    registry.registerModule(autoloopModule);
    const ctx = createModuleContext(registry, 'autoloop');
    autoloopModule.register(ctx);

    const commands = registry.getCommands();
    const names = commands.map((c) => c.command.name());
    expect(names).toContain('autoloop');
  });

  it('registers migration', () => {
    const registry = new ModuleRegistry();
    registry.registerModule(autoloopModule);
    const ctx = createModuleContext(registry, 'autoloop');
    autoloopModule.register(ctx);

    const migrations = registry.getMigrations();
    const autoloopMigrations = migrations.filter((m) => m.module === 'autoloop');
    expect(autoloopMigrations.length).toBeGreaterThanOrEqual(1);
    expect(autoloopMigrations[0].migration.version).toBe(1);
  });

  it('sets private visibility', () => {
    const registry = new ModuleRegistry();
    registry.registerModule(autoloopModule);
    const ctx = createModuleContext(registry, 'autoloop');
    autoloopModule.register(ctx);

    const filters = registry.getFilters();
    const autoloopFilter = filters.find((f) => f.module === 'autoloop');
    expect(autoloopFilter?.filter.visibility).toBe('private');
  });
});
