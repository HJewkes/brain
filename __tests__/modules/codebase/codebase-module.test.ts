import { describe, it, expect } from 'vitest';
import { codebaseModule } from '../../../src/modules/codebase/index.js';
import { ModuleRegistry } from '../../../src/modules/registry.js';
import { createModuleContext } from '../../../src/modules/context.js';
import { validateNoteFrontmatter } from '../../../src/modules/validation.js';

function registerCodebaseModule(): ModuleRegistry {
  const registry = new ModuleRegistry();
  registry.registerModule(codebaseModule);
  const ctx = createModuleContext(registry, codebaseModule.name);
  codebaseModule.register(ctx);
  return registry;
}

describe('codebase module', () => {
  it('registers successfully with correct metadata', () => {
    const registry = registerCodebaseModule();

    expect(registry.getModule('codebase')).toBeDefined();
    expect(registry.getModule('codebase')!.version).toBe('1.0.0');
  });

  it('registers the architecture note type', () => {
    const registry = registerCodebaseModule();

    const noteType = registry.getNoteType('architecture');
    expect(noteType).toBeDefined();
    expect(noteType!.tier).toBe('slow');
    expect(noteType!.description).toBe('Module-level architecture documentation');
  });

  it('registers the describes relation type', () => {
    const registry = registerCodebaseModule();

    const relationType = registry.getRelationType('describes');
    expect(relationType).toBeDefined();
    expect(relationType!.description).toContain('documents');
  });

  it('registers an extraction strategy that skips all notes', () => {
    const registry = registerCodebaseModule();

    const strategy = registry.getExtractionStrategy('codebase');
    expect(strategy).toBeDefined();
    expect(strategy!.shouldExtract({ id: 'test' } as never)).toBe(false);
  });

  it('registers a contextual visibility filter', () => {
    const registry = registerCodebaseModule();

    const filter = registry.getFilterForModule('codebase');
    expect(filter).toBeDefined();
    expect(filter!.visibility).toBe('contextual');
  });

  describe('search filter', () => {
    it('includes results for architecture-related queries', () => {
      const registry = registerCodebaseModule();
      const filter = registry.getFilterForModule('codebase')!;

      expect(filter.shouldIncludeInSearch!({} as never, 'architecture overview')).toBe(true);
      expect(filter.shouldIncludeInSearch!({} as never, 'module structure')).toBe(true);
      expect(filter.shouldIncludeInSearch!({} as never, 'codebase map')).toBe(true);
      expect(filter.shouldIncludeInSearch!({} as never, 'public exports')).toBe(true);
    });

    it('excludes results for unrelated queries', () => {
      const registry = registerCodebaseModule();
      const filter = registry.getFilterForModule('codebase')!;

      expect(filter.shouldIncludeInSearch!({} as never, 'meeting notes')).toBe(false);
      expect(filter.shouldIncludeInSearch!({} as never, 'grocery list')).toBe(false);
    });
  });

  describe('frontmatter validation', () => {
    it('accepts valid architecture frontmatter', () => {
      const registry = registerCodebaseModule();
      const schema = registry.getNoteType('architecture')!.schema!;

      const result = validateNoteFrontmatter(
        {
          'module-path': 'src/modules/codebase',
          language: 'typescript',
          'exports-hash': 'abc123',
        },
        schema
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects frontmatter missing module-path', () => {
      const registry = registerCodebaseModule();
      const schema = registry.getNoteType('architecture')!.schema!;

      const result = validateNoteFrontmatter(
        { language: 'typescript', 'exports-hash': 'abc123' },
        schema
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'module-path')).toBe(true);
    });

    it('rejects frontmatter missing language', () => {
      const registry = registerCodebaseModule();
      const schema = registry.getNoteType('architecture')!.schema!;

      const result = validateNoteFrontmatter(
        { 'module-path': 'src/foo', 'exports-hash': 'abc123' },
        schema
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'language')).toBe(true);
    });

    it('rejects frontmatter missing exports-hash', () => {
      const registry = registerCodebaseModule();
      const schema = registry.getNoteType('architecture')!.schema!;

      const result = validateNoteFrontmatter(
        { 'module-path': 'src/foo', language: 'typescript' },
        schema
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'exports-hash')).toBe(true);
    });

    it('rejects frontmatter with wrong field types', () => {
      const registry = registerCodebaseModule();
      const schema = registry.getNoteType('architecture')!.schema!;

      const result = validateNoteFrontmatter(
        {
          'module-path': 123,
          language: 'typescript',
          'exports-hash': 'abc123',
        },
        schema
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'module-path')).toBe(true);
    });

    it('accepts optional fields when present with correct types', () => {
      const registry = registerCodebaseModule();
      const schema = registry.getNoteType('architecture')!.schema!;

      const result = validateNoteFrontmatter(
        {
          'module-path': 'src/modules/codebase',
          language: 'typescript',
          'exports-hash': 'abc123',
          framework: 'vitest',
          dependencies: ['src/modules/types'],
          'last-analyzed': '2026-03-14T00:00:00Z',
        },
        schema
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
