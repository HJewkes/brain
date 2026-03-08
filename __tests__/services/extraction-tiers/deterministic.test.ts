import { describe, it, expect, vi } from 'vitest';
import {
  extractDeterministic,
  cosineSimilarity,
} from '../../../src/services/extraction-tiers/deterministic.js';
import type { Embedder } from '../../../src/types.js';
import type { ModuleRegistry } from '../../../src/modules/registry.js';

function makeRegistry(
  overrides: Partial<Record<keyof ModuleRegistry, unknown>> = {}
): ModuleRegistry {
  return {
    getNoteType: vi.fn().mockReturnValue(undefined),
    matchColumnHeaders: vi.fn().mockReturnValue(null),
    getArchetypeTexts: vi.fn().mockReturnValue(new Map()),
    ...overrides,
  } as unknown as ModuleRegistry;
}

function makeEmbedder(embedFn?: (texts: string[]) => Promise<number[][]>): Embedder {
  return {
    embed: embedFn ?? vi.fn().mockResolvedValue([]),
    model: 'test-model',
    dimensions: 3,
  };
}

describe('extractDeterministic', () => {
  describe('CSV column matching', () => {
    it('extracts tasks from CSV with matching columns', async () => {
      const csv = `Name,Status,Priority\nFix login,In Progress,High\nUpdate docs,Done,Low`;
      const registry = makeRegistry({
        matchColumnHeaders: vi.fn().mockReturnValue({
          module: 'pm',
          noteType: 'task',
          columnMapping: { name: 'name', status: 'status', priority: 'priority' },
        }),
      });

      const result = await extractDeterministic(csv, 'tasks.csv', registry, makeEmbedder());

      expect(result.items).toHaveLength(2);
      expect(result.remainder).toBeNull();
      expect(result.items[0].noteType).toBe('task');
      expect(result.items[0].title).toBe('Fix login');
      expect(result.items[0].fields.status).toBe('In Progress');
      expect(result.items[0].fields.priority).toBe('High');
      expect(result.items[1].title).toBe('Update docs');
    });

    it('returns remainder when CSV columns do not match', async () => {
      const csv = `Color,Size\nRed,Large\nBlue,Small`;
      const registry = makeRegistry();

      const result = await extractDeterministic(csv, 'data.csv', registry, makeEmbedder());

      expect(result.items).toHaveLength(0);
      expect(result.remainder).toBe(csv);
    });

    it('sets sourceRegion for each CSV row', async () => {
      const csv = `Name,Status\nTask A,Open\nTask B,Closed`;
      const registry = makeRegistry({
        matchColumnHeaders: vi.fn().mockReturnValue({
          module: 'pm',
          noteType: 'task',
          columnMapping: { name: 'name', status: 'status' },
        }),
      });

      const result = await extractDeterministic(csv, 'tasks.csv', registry, makeEmbedder());

      expect(result.items[0].sourceRegion).toEqual({ startLine: 2, endLine: 2 });
      expect(result.items[1].sourceRegion).toEqual({ startLine: 3, endLine: 3 });
    });
  });

  describe('frontmatter matching', () => {
    it('extracts from markdown with matching frontmatter type', async () => {
      const md = `---\ntype: meeting\ntitle: Sprint Retro\ndate: 2026-03-01\n---\n\nDiscussed velocity improvements.`;
      const registry = makeRegistry({
        getNoteType: vi.fn().mockReturnValue({ name: 'meeting', tier: 'fast' }),
      });

      const result = await extractDeterministic(md, 'retro.md', registry, makeEmbedder());

      expect(result.items).toHaveLength(1);
      expect(result.remainder).toBeNull();
      expect(result.items[0].noteType).toBe('meeting');
      expect(result.items[0].title).toBe('Sprint Retro');
      expect(result.items[0].content).toBe('Discussed velocity improvements.');
      expect(result.items[0].fields.date).toBe('2026-03-01');
      expect(result.items[0].fields.type).toBeUndefined();
      expect(result.items[0].fields.title).toBeUndefined();
    });

    it('returns remainder when frontmatter type is not registered', async () => {
      const md = `---\ntype: unknown-type\ntitle: Test\n---\n\nBody text.`;
      const registry = makeRegistry();

      const result = await extractDeterministic(md, 'test.md', registry, makeEmbedder());

      // Falls through to other strategies, ultimately returns remainder
      expect(result.items).toHaveLength(0);
      expect(result.remainder).toBe(md);
    });

    it('returns remainder when frontmatter has no type field', async () => {
      const md = `---\ntitle: No Type\n---\n\nSome content.`;
      const registry = makeRegistry();

      const result = await extractDeterministic(md, 'test.md', registry, makeEmbedder());

      expect(result.items).toHaveLength(0);
      expect(result.remainder).toBe(md);
    });

    it('skips frontmatter for non-markdown files', async () => {
      const content = `---\ntype: meeting\ntitle: Test\n---\n\nBody.`;
      const registry = makeRegistry({
        getNoteType: vi.fn().mockReturnValue({ name: 'meeting', tier: 'fast' }),
      });

      const result = await extractDeterministic(content, 'data.txt', registry, makeEmbedder());

      // .txt files skip frontmatter strategy
      expect(result.items).toHaveLength(0);
    });

    it('uses Untitled when frontmatter has no title', async () => {
      const md = `---\ntype: note\n---\n\nContent here.`;
      const registry = makeRegistry({
        getNoteType: vi.fn().mockReturnValue({ name: 'note', tier: 'slow' }),
      });

      const result = await extractDeterministic(md, 'test.md', registry, makeEmbedder());

      expect(result.items[0].title).toBe('Untitled');
    });
  });

  describe('markdown table matching', () => {
    it('extracts tasks from markdown pipe table', async () => {
      const md = `# Tasks\n\n| Task | Status | Priority |\n| --- | --- | --- |\n| Fix bug | Open | High |\n| Add tests | Done | Medium |`;
      const registry = makeRegistry({
        matchColumnHeaders: vi.fn().mockReturnValue({
          module: 'pm',
          noteType: 'task',
          columnMapping: { task: 'name', status: 'status', priority: 'priority' },
        }),
      });

      const result = await extractDeterministic(md, 'tasks.md', registry, makeEmbedder());

      expect(result.items).toHaveLength(2);
      expect(result.remainder).toBeNull();
      expect(result.items[0].noteType).toBe('task');
      expect(result.items[0].title).toBe('Fix bug');
      expect(result.items[0].fields.status).toBe('Open');
    });

    it('returns remainder when table columns do not match', async () => {
      const md = `| Animal | Legs |\n| --- | --- |\n| Cat | 4 |`;
      const registry = makeRegistry();

      const result = await extractDeterministic(md, 'data.md', registry, makeEmbedder());

      expect(result.items).toHaveLength(0);
      expect(result.remainder).toBe(md);
    });
  });

  describe('embedding similarity matching', () => {
    it('matches when similarity exceeds threshold', async () => {
      const content =
        'This is a detailed architecture description of the system components and data flow.';
      const registry = makeRegistry({
        getArchetypeTexts: vi.fn().mockReturnValue(
          new Map([
            [
              'architecture',
              'System architecture documentation describing components and data flow.',
            ],
            ['meeting', 'Meeting notes with attendees and action items.'],
          ])
        ),
      });

      // Simulate: doc vector = [1,0,0], arch vector = [0.95,0.3,0], meeting vector = [0,1,0]
      const embedder = makeEmbedder(async (texts: string[]) => {
        return texts.map((t) => {
          if (t === content) return [1, 0, 0];
          if (t.includes('architecture')) return [0.95, 0.3, 0];
          return [0, 1, 0];
        });
      });

      const result = await extractDeterministic(content, 'design.md', registry, embedder);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].noteType).toBe('architecture');
      expect(result.items[0].title).toBe('design');
    });

    it('returns remainder when no archetype exceeds threshold', async () => {
      const content =
        'Some content that does not match anything particularly well at all for testing.';
      const registry = makeRegistry({
        getArchetypeTexts: vi
          .fn()
          .mockReturnValue(new Map([['meeting', 'Meeting notes with attendees.']])),
      });

      const embedder = makeEmbedder(async (texts: string[]) => {
        return texts.map(() => [0.5, 0.5, 0.5]);
      });

      await extractDeterministic(content, 'random.md', registry, embedder);

      // All vectors identical => cosine = 1.0, but that's a degenerate case.
      // Use orthogonal vectors instead:
      const embedder2 = makeEmbedder(async (texts: string[]) => {
        return texts.map((_, i) => (i === 0 ? [1, 0, 0] : [0, 1, 0]));
      });

      const result2 = await extractDeterministic(content, 'random.md', registry, embedder2);

      expect(result2.items).toHaveLength(0);
      expect(result2.remainder).toBe(content);
    });

    it('skips when content is too short', async () => {
      const content = 'Short.';
      const registry = makeRegistry({
        getArchetypeTexts: vi.fn().mockReturnValue(new Map([['note', 'A general note.']])),
      });

      const result = await extractDeterministic(content, 'short.md', registry, makeEmbedder());

      expect(result.items).toHaveLength(0);
      expect(result.remainder).toBe(content);
    });

    it('skips when no archetypes are registered', async () => {
      const content = 'A'.repeat(100);
      const registry = makeRegistry();

      const result = await extractDeterministic(content, 'test.md', registry, makeEmbedder());

      expect(result.items).toHaveLength(0);
      expect(result.remainder).toBe(content);
    });
  });

  describe('empty and edge cases', () => {
    it('returns remainder for empty content', async () => {
      const registry = makeRegistry();
      const result = await extractDeterministic('', 'empty.md', registry, makeEmbedder());

      expect(result.items).toHaveLength(0);
      expect(result.remainder).toBe('');
    });

    it('prefers frontmatter over table match for .md files', async () => {
      const md = `---\ntype: meeting\ntitle: Standup\n---\n\n| Task | Status |\n| --- | --- |\n| A | Done |`;
      const registry = makeRegistry({
        getNoteType: vi.fn().mockReturnValue({ name: 'meeting', tier: 'fast' }),
        matchColumnHeaders: vi.fn().mockReturnValue({
          module: 'pm',
          noteType: 'task',
          columnMapping: { task: 'name', status: 'status' },
        }),
      });

      const result = await extractDeterministic(md, 'standup.md', registry, makeEmbedder());

      // Frontmatter match takes priority
      expect(result.items).toHaveLength(1);
      expect(result.items[0].noteType).toBe('meeting');
    });
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});
