import { describe, it, expect, vi } from 'vitest';
import { loadModules, discoverModules, runModuleMigrations } from '../../src/modules/loader.js';
import { createModuleContext } from '../../src/modules/context.js';
import { ModuleRegistry } from '../../src/modules/registry.js';
import type { BrainModule, ModuleContext } from '../../src/modules/types.js';

function makeMockModule(name: string, registerFn?: (ctx: ModuleContext) => void): BrainModule {
  return {
    name,
    version: '1.0.0',
    description: `Mock ${name} module`,
    register: registerFn ?? (() => {}),
  };
}

describe('discoverModules', () => {
  it('returns empty array when directory does not exist', () => {
    const result = discoverModules('/tmp/nonexistent-brain-modules-dir');
    expect(result).toEqual([]);
  });
});

describe('loadModules', () => {
  it('returns empty registry with no modules', async () => {
    const { registry, errors } = await loadModules({ modules: [], modulesDir: '/tmp/nonexistent' });

    expect(registry.getModuleNames()).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('registers a valid module and its note types', async () => {
    const mod = makeMockModule('pm', (ctx) => {
      ctx.registerNoteType({
        name: 'epic',
        description: 'An epic',
        tier: 'slow',
      });
    });

    const { registry, errors } = await loadModules({
      modules: [mod],
      modulesDir: '/tmp/nonexistent',
    });

    expect(errors).toEqual([]);
    expect(registry.getModuleNames()).toEqual(['pm']);
    expect(registry.getNoteType('epic')).toEqual({
      name: 'epic',
      description: 'An epic',
      tier: 'slow',
    });
  });

  it('catches errors from bad modules without affecting others', async () => {
    const good = makeMockModule('good');
    const bad = makeMockModule('bad', () => {
      throw new Error('Registration exploded');
    });
    const alsoGood = makeMockModule('also-good');

    const { registry, errors } = await loadModules({
      modules: [good, bad, alsoGood],
      modulesDir: '/tmp/nonexistent',
    });

    expect(registry.getModuleNames()).toContain('good');
    expect(registry.getModuleNames()).toContain('also-good');
    expect(errors).toHaveLength(1);
    expect(errors[0].module).toBe('bad');
    expect(errors[0].error.message).toBe('Registration exploded');
  });

  it('catches non-Error throws and wraps them', async () => {
    const bad = makeMockModule('throws-string', () => {
      throw 'string error';
    });

    const { errors } = await loadModules({
      modules: [bad],
      modulesDir: '/tmp/nonexistent',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBeInstanceOf(Error);
    expect(errors[0].error.message).toBe('string error');
  });
});

describe('createModuleContext', () => {
  it('delegates registerNoteType to registry', () => {
    const registry = new ModuleRegistry();
    registry.registerModule(makeMockModule('pm'));
    const ctx = createModuleContext(registry, 'pm');

    ctx.registerNoteType({ name: 'epic', description: 'An epic', tier: 'slow' });

    expect(registry.getNoteType('epic')).toBeDefined();
    expect(registry.getNoteTypeModule('epic')).toBe('pm');
  });

  it('delegates registerRelationType to registry', () => {
    const registry = new ModuleRegistry();
    registry.registerModule(makeMockModule('pm'));
    const ctx = createModuleContext(registry, 'pm');

    ctx.registerRelationType({ name: 'blocks', description: 'Blocks another' });

    expect(registry.getRelationType('blocks')).toBeDefined();
  });

  it('delegates registerCommand to registry', () => {
    const registry = new ModuleRegistry();
    registry.registerModule(makeMockModule('pm'));
    const ctx = createModuleContext(registry, 'pm');

    const fakeCmd = {} as unknown;
    ctx.registerCommand(fakeCmd);

    expect(registry.getCommands()).toHaveLength(1);
  });

  it('delegates registerExtractionStrategy to registry', () => {
    const registry = new ModuleRegistry();
    registry.registerModule(makeMockModule('pm'));
    const ctx = createModuleContext(registry, 'pm');

    ctx.registerExtractionStrategy({ shouldExtract: () => true });

    expect(registry.getExtractionStrategy('pm')).toBeDefined();
  });

  it('delegates registerFilter to registry', () => {
    const registry = new ModuleRegistry();
    registry.registerModule(makeMockModule('pm'));
    const ctx = createModuleContext(registry, 'pm');

    ctx.registerFilter({ visibility: 'public' });

    expect(registry.getFilterForModule('pm')).toBeDefined();
  });

  it('delegates registerMigration to registry', () => {
    const registry = new ModuleRegistry();
    registry.registerModule(makeMockModule('pm'));
    const ctx = createModuleContext(registry, 'pm');

    ctx.registerMigration({ version: 1, description: 'Init', up: () => {} });

    expect(registry.getMigrations('pm')).toHaveLength(1);
  });
});

describe('runModuleMigrations', () => {
  it('runs pending migrations in version order', () => {
    const registry = new ModuleRegistry();
    const calls: number[] = [];

    registry.registerMigration('pm', { version: 2, description: 'Second', up: () => calls.push(2) });
    registry.registerMigration('pm', { version: 1, description: 'First', up: () => calls.push(1) });
    registry.registerMigration('pm', { version: 3, description: 'Third', up: () => calls.push(3) });

    const applied = runModuleMigrations(registry, {}, new Map());

    expect(calls).toEqual([1, 2, 3]);
    expect(applied).toEqual([
      { module: 'pm', version: 1 },
      { module: 'pm', version: 2 },
      { module: 'pm', version: 3 },
    ]);
  });

  it('skips already-applied versions', () => {
    const registry = new ModuleRegistry();
    const calls: number[] = [];

    registry.registerMigration('pm', { version: 1, description: 'First', up: () => calls.push(1) });
    registry.registerMigration('pm', { version: 2, description: 'Second', up: () => calls.push(2) });
    registry.registerMigration('pm', { version: 3, description: 'Third', up: () => calls.push(3) });

    const applied = runModuleMigrations(registry, {}, new Map([['pm', 2]]));

    expect(calls).toEqual([3]);
    expect(applied).toEqual([{ module: 'pm', version: 3 }]);
  });

  it('handles multiple modules independently', () => {
    const registry = new ModuleRegistry();
    const calls: string[] = [];

    registry.registerMigration('pm', { version: 1, description: 'PM init', up: () => calls.push('pm-1') });
    registry.registerMigration('eng', { version: 1, description: 'Eng init', up: () => calls.push('eng-1') });
    registry.registerMigration('eng', { version: 2, description: 'Eng v2', up: () => calls.push('eng-2') });

    const applied = runModuleMigrations(registry, {}, new Map([['eng', 1]]));

    expect(calls).toContain('pm-1');
    expect(calls).toContain('eng-2');
    expect(calls).not.toContain('eng-1');
    expect(applied).toHaveLength(2);
  });

  it('returns empty array when no migrations are pending', () => {
    const registry = new ModuleRegistry();
    registry.registerMigration('pm', { version: 1, description: 'Init', up: () => {} });

    const applied = runModuleMigrations(registry, {}, new Map([['pm', 1]]));

    expect(applied).toEqual([]);
  });

  it('passes db argument to migration up function', () => {
    const registry = new ModuleRegistry();
    const mockDb = { execute: vi.fn() };
    let receivedDb: unknown;

    registry.registerMigration('pm', {
      version: 1,
      description: 'Init',
      up: (db) => { receivedDb = db; },
    });

    runModuleMigrations(registry, mockDb, new Map());

    expect(receivedDb).toBe(mockDb);
  });
});
