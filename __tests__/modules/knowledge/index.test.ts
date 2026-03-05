import { describe, it, expect } from 'vitest';
import { knowledgeModule } from '../../../src/modules/knowledge/index.js';
import { ModuleRegistry } from '../../../src/modules/registry.js';
import { createModuleContext } from '../../../src/modules/context.js';

describe('knowledge module', () => {
  function setupRegistry(): ModuleRegistry {
    const registry = new ModuleRegistry();
    registry.registerModule(knowledgeModule);
    const ctx = createModuleContext(registry, 'knowledge');
    knowledgeModule.register(ctx);
    return registry;
  }

  it('registers all core knowledge note types', () => {
    const registry = setupRegistry();
    const types = registry.getAllNoteTypes();
    const names = types.map((t) => t.noteType.name);

    expect(names).toContain('note');
    expect(names).toContain('research');
    expect(names).toContain('meeting');
    expect(names).toContain('guide');
    expect(names).toContain('pattern');
    expect(names).toContain('session-log');
    expect(names).toHaveLength(6);
  });

  it('does not register decision (owned by PM module)', () => {
    const registry = setupRegistry();
    const types = registry.getAllNoteTypes();
    const names = types.map((t) => t.noteType.name);

    expect(names).not.toContain('decision');
  });

  it('assigns correct tiers to each type', () => {
    const registry = setupRegistry();

    expect(registry.getNoteType('note')?.tier).toBe('slow');
    expect(registry.getNoteType('research')?.tier).toBe('slow');
    expect(registry.getNoteType('meeting')?.tier).toBe('fast');
    expect(registry.getNoteType('guide')?.tier).toBe('slow');
    expect(registry.getNoteType('pattern')?.tier).toBe('slow');
    expect(registry.getNoteType('session-log')?.tier).toBe('fast');
  });

  it('sets module name to knowledge for all types', () => {
    const registry = setupRegistry();
    const types = registry.getAllNoteTypes();

    for (const entry of types) {
      expect(entry.module).toBe('knowledge');
    }
  });

  it('has descriptive text for each note type', () => {
    const registry = setupRegistry();
    const types = registry.getAllNoteTypes();

    for (const entry of types) {
      expect(entry.noteType.description).toBeTruthy();
      expect(entry.noteType.description.length).toBeGreaterThan(10);
    }
  });
});
