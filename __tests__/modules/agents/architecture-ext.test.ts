import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb, createTestTask, makeNote } from '../../helpers.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import type { BrainConfig } from '../../../src/types.js';
import {
  extractModuleReferences,
  architectureExtension,
} from '../../../src/modules/agents/extensions/architecture-ext.js';
import type { ArchitectureContext } from '../../../src/modules/agents/extensions/architecture-ext.js';

const embedder = createMockEmbedder();

function seedArchitectureNote(
  db: BrainDB,
  modulePath: string,
  opts?: { l1Overview?: string }
): void {
  const slug = modulePath.replace(/\//g, '-');
  db.upsertNote(
    makeNote({
      id: `arch-${slug}`,
      title: `Architecture: ${modulePath}`,
      type: 'architecture',
      tier: 'slow',
      module: 'codebase',
      metadata: JSON.stringify({
        'module-path': modulePath,
        language: 'typescript',
        'exports-hash': 'abc123',
      }),
      l1Overview:
        opts?.l1Overview ??
        [
          '## Purpose',
          '',
          'Hybrid search orchestration combining BM25 and vector search.',
          '',
          '## Public API',
          '',
          '| Export | Kind | Signature |',
          '|--------|------|-----------|',
          '| search | function | export function search(db: BrainDB): Promise<Result[]> |',
          '| rerank | function | export function rerank(results: Result[]): Result[] |',
          '',
          '## Dependencies',
          '',
          '### Internal',
          '',
          '- `../services/brain-db.js` — BrainDB',
          '- `../types.js` — SearchResult',
          '',
          '### External',
          '',
          '- `better-sqlite3` — Database',
          '',
          '## Invariants',
          '',
          'Search always returns results sorted by score descending.',
        ].join('\n'),
    })
  );
}

describe('extractModuleReferences', () => {
  it('extracts src/ paths from text', () => {
    const text = 'Modify src/services/search.ts and src/modules/agents/dispatch-context.ts';
    const refs = extractModuleReferences(text);
    expect(refs).toContain('src/services/search.ts');
    expect(refs).toContain('src/modules/agents/dispatch-context.ts');
  });

  it('extracts __tests__/ paths', () => {
    const text = 'Add test at __tests__/modules/agents/foo.test.ts';
    const refs = extractModuleReferences(text);
    expect(refs).toContain('__tests__/modules/agents/foo.test.ts');
  });

  it('extracts directory paths', () => {
    const text = 'Files in src/modules/agents/ directory';
    const refs = extractModuleReferences(text);
    expect(refs).toContain('src/modules/agents');
  });

  it('deduplicates repeated paths', () => {
    const text = 'src/foo.ts and src/foo.ts again';
    const refs = extractModuleReferences(text);
    expect(refs).toEqual(['src/foo.ts']);
  });

  it('returns empty for text without module references', () => {
    const refs = extractModuleReferences('No file paths here at all');
    expect(refs).toEqual([]);
  });

  it('extracts paths from backtick code spans', () => {
    const text = 'Update `src/cli.ts` to add the new command';
    const refs = extractModuleReferences(text);
    expect(refs).toContain('src/cli.ts');
  });
});

describe('architectureExtension.compute', () => {
  let db: BrainDB;
  let config: BrainConfig;

  beforeEach(async () => {
    ({ db } = createTestDb());
    config = {
      notesDir: '/tmp/test-arch',
      dbPath: ':memory:',
      embedder: 'local',
    };

    await createProject(db, config, embedder, { name: 'Test', prefix: 'ARC' });
    await createWorkstream(db, config, embedder, { project: 'ARC', name: 'Alpha' });
  });

  afterEach(() => {
    db.close();
  });

  it('returns undefined when task not found', () => {
    const result = architectureExtension.compute({
      db,
      taskDisplayId: 'NOPE-99.99',
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when task has no module references', async () => {
    await createTestTask(db, config, embedder, {
      project: 'ARC',
      workstream: 1,
      name: 'Generic task',
      description: 'This task mentions no file paths',
    });

    const result = architectureExtension.compute({
      db,
      taskDisplayId: 'ARC-01.01',
    });
    expect(result).toBeUndefined();
  });

  it('finds matching architecture notes for task with module references', async () => {
    seedArchitectureNote(db, 'src/services/search.ts');

    await createTestTask(db, config, embedder, {
      project: 'ARC',
      workstream: 1,
      name: 'Improve search',
      description: 'Update src/services/search.ts to add fuzzy matching',
    });

    const result = architectureExtension.compute({
      db,
      taskDisplayId: 'ARC-01.01',
    }) as ArchitectureContext | undefined;

    expect(result).toBeDefined();
    expect(result!.relevantModules).toHaveLength(1);
    expect(result!.relevantModules[0].modulePath).toBe('src/services/search.ts');
    expect(result!.relevantModules[0].purpose).toContain('Hybrid search');
    expect(result!.relevantModules[0].exports).toContain('search');
    expect(result!.relevantModules[0].exports).toContain('rerank');
    expect(result!.relevantModules[0].dependencies).toContain('../services/brain-db.js');
    expect(result!.relevantModules[0].invariants).toContain(
      'Search always returns results sorted by score descending.'
    );
  });

  it('returns undefined when no architecture notes exist', async () => {
    await createTestTask(db, config, embedder, {
      project: 'ARC',
      workstream: 1,
      name: 'Improve search',
      description: 'Update src/services/search.ts to add fuzzy matching',
    });

    const result = architectureExtension.compute({
      db,
      taskDisplayId: 'ARC-01.01',
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when architecture notes exist but none match', async () => {
    seedArchitectureNote(db, 'src/services/graph.ts');

    await createTestTask(db, config, embedder, {
      project: 'ARC',
      workstream: 1,
      name: 'Improve search',
      description: 'Update src/services/search.ts to add fuzzy matching',
    });

    const result = architectureExtension.compute({
      db,
      taskDisplayId: 'ARC-01.01',
    });
    expect(result).toBeUndefined();
  });

  it('matches multiple architecture notes', async () => {
    seedArchitectureNote(db, 'src/services/search.ts');
    seedArchitectureNote(db, 'src/services/graph.ts', {
      l1Overview: [
        '## Purpose',
        '',
        'Note relation traversal with batch queries.',
        '',
        '## Public API',
        '',
        '| Export | Kind | Signature |',
        '|--------|------|-----------|',
        '| traverse | function | export function traverse(db: BrainDB): Graph |',
        '',
        '## Dependencies',
        '',
        '*(none)*',
        '',
        '## Invariants',
        '',
        '*(none yet)*',
      ].join('\n'),
    });

    await createTestTask(db, config, embedder, {
      project: 'ARC',
      workstream: 1,
      name: 'Combine search and graph',
      description: 'Update src/services/search.ts and src/services/graph.ts for combined results',
    });

    const result = architectureExtension.compute({
      db,
      taskDisplayId: 'ARC-01.01',
    }) as ArchitectureContext | undefined;

    expect(result).toBeDefined();
    expect(result!.relevantModules).toHaveLength(2);
    const paths = result!.relevantModules.map((m) => m.modulePath).sort();
    expect(paths).toEqual(['src/services/graph.ts', 'src/services/search.ts']);
  });
});

describe('architectureExtension.format', () => {
  it('returns null for falsy data', () => {
    expect(architectureExtension.format(undefined, 'X-01.01')).toBeNull();
    expect(architectureExtension.format(null, 'X-01.01')).toBeNull();
  });

  it('returns null when no relevant modules', () => {
    const data: ArchitectureContext = { relevantModules: [], relatedPatterns: [] };
    expect(architectureExtension.format(data, 'X-01.01')).toBeNull();
  });

  it('formats architecture context as markdown', () => {
    const data: ArchitectureContext = {
      relevantModules: [
        {
          modulePath: 'src/services/search.ts',
          purpose: 'Hybrid search orchestration.',
          exports: ['search', 'rerank'],
          dependencies: ['brain-db.js', 'types.js'],
          invariants: ['Results sorted by score'],
        },
      ],
      relatedPatterns: ['Always use RRF for fusion'],
    };

    const result = architectureExtension.format(data, 'X-01.01')!;
    expect(result).toContain('## Relevant Architecture');
    expect(result).toContain('### src/services/search.ts');
    expect(result).toContain('**Purpose:** Hybrid search orchestration.');
    expect(result).toContain('**Key Exports:** search, rerank');
    expect(result).toContain('**Dependencies:** brain-db.js, types.js');
    expect(result).toContain('**Invariants:** Results sorted by score');
    expect(result).toContain('### Related Patterns');
    expect(result).toContain('- Always use RRF for fusion');
  });

  it('omits empty optional fields', () => {
    const data: ArchitectureContext = {
      relevantModules: [
        {
          modulePath: 'src/cli.ts',
          purpose: 'Entry point.',
          exports: [],
          dependencies: [],
          invariants: [],
        },
      ],
      relatedPatterns: [],
    };

    const result = architectureExtension.format(data, 'X-01.01')!;
    expect(result).toContain('### src/cli.ts');
    expect(result).toContain('**Purpose:** Entry point.');
    expect(result).not.toContain('**Key Exports:**');
    expect(result).not.toContain('**Dependencies:**');
    expect(result).not.toContain('**Invariants:**');
    expect(result).not.toContain('### Related Patterns');
  });

  it('formats multiple modules', () => {
    const data: ArchitectureContext = {
      relevantModules: [
        {
          modulePath: 'src/a.ts',
          purpose: 'Module A.',
          exports: ['foo'],
          dependencies: [],
          invariants: [],
        },
        {
          modulePath: 'src/b.ts',
          purpose: 'Module B.',
          exports: ['bar'],
          dependencies: [],
          invariants: [],
        },
      ],
      relatedPatterns: [],
    };

    const result = architectureExtension.format(data, 'X-01.01')!;
    expect(result).toContain('### src/a.ts');
    expect(result).toContain('### src/b.ts');
  });
});
