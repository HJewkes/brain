import { describe, it, expect, vi } from 'vitest';
import {
  classifyWithLlm,
  prepareContent,
} from '../../../src/services/extraction-tiers/llm-classifier.js';
import type { OllamaClient } from '../../../src/services/ollama.js';
import type { ModuleRegistry } from '../../../src/modules/registry.js';

function makeClient(response: string | Error): OllamaClient {
  const generate =
    response instanceof Error
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue(response);
  return { generate, model: 'qwen2.5:3b' };
}

function makeRegistry(
  noteTypes: Array<{
    module: string;
    noteType: {
      name: string;
      description: string;
      tier: 'slow' | 'fast';
      schema?: {
        type: 'object';
        properties: Record<string, { type: string; description?: string }>;
      };
      importHints?: unknown;
    };
  }> = []
): ModuleRegistry {
  return {
    getAllNoteTypes: vi.fn().mockReturnValue(noteTypes),
    getImportableNoteTypes: vi
      .fn()
      .mockReturnValue(noteTypes.filter((t) => t.noteType.importHints)),
    matchColumnHeaders: vi.fn().mockReturnValue(null),
    getArchetypeTexts: vi.fn().mockReturnValue(new Map()),
    getNoteType: vi.fn(),
  } as unknown as ModuleRegistry;
}

const defaultNoteTypes = [
  {
    module: 'core',
    noteType: {
      name: 'task',
      description: 'A task or action item',
      tier: 'fast' as const,
      schema: {
        type: 'object' as const,
        properties: {
          status: { type: 'string', description: 'Task status' },
          priority: { type: 'string', description: 'Priority level' },
        },
      },
    },
  },
  {
    module: 'core',
    noteType: {
      name: 'note',
      description: 'A general note',
      tier: 'slow' as const,
    },
  },
];

describe('classifyWithLlm', () => {
  it('parses valid JSON response into ExtractedItems', async () => {
    const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
    const llmResponse = JSON.stringify([
      {
        type: 'task',
        title: 'Fix bug',
        startLine: 1,
        endLine: 3,
        confidence: 0.9,
        fields: { status: 'open' },
      },
    ]);

    const result = await classifyWithLlm(
      content,
      'doc.md',
      makeRegistry(defaultNoteTypes),
      makeClient(llmResponse)
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].noteType).toBe('task');
    expect(result.items[0].title).toBe('Fix bug');
    expect(result.items[0].content).toBe('Line 1\nLine 2\nLine 3');
    expect(result.items[0].fields.status).toBe('open');
    expect(result.items[0].sourceRegion).toEqual({ startLine: 1, endLine: 3 });
    expect(result.remainder).toBe('Line 4\nLine 5');
  });

  it('filters out items below confidence threshold (0.6)', async () => {
    const content = 'Line 1\nLine 2\nLine 3';
    const llmResponse = JSON.stringify([
      { type: 'task', title: 'High conf', startLine: 1, endLine: 1, confidence: 0.8 },
      { type: 'note', title: 'Low conf', startLine: 2, endLine: 3, confidence: 0.4 },
    ]);

    const result = await classifyWithLlm(
      content,
      'doc.md',
      makeRegistry(defaultNoteTypes),
      makeClient(llmResponse)
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('High conf');
    expect(result.remainder).toBe('Line 2\nLine 3');
  });

  it('returns empty items with full remainder on JSON parse failure', async () => {
    const content = 'Some content here';
    const result = await classifyWithLlm(
      content,
      'doc.md',
      makeRegistry(defaultNoteTypes),
      makeClient('not valid json at all')
    );

    expect(result.items).toHaveLength(0);
    expect(result.remainder).toBe(content);
  });

  it('returns empty items with full remainder when LLM throws', async () => {
    const content = 'Some content here';
    const result = await classifyWithLlm(
      content,
      'doc.md',
      makeRegistry(defaultNoteTypes),
      makeClient(new Error('connection refused'))
    );

    expect(result.items).toHaveLength(0);
    expect(result.remainder).toBe(content);
  });

  it('handles LLM response with extra text around JSON', async () => {
    const content = 'Line 1\nLine 2';
    const llmResponse =
      'Here is the classification:\n' +
      JSON.stringify([
        { type: 'note', title: 'A note', startLine: 1, endLine: 2, confidence: 0.7 },
      ]) +
      '\nDone!';

    const result = await classifyWithLlm(
      content,
      'doc.md',
      makeRegistry(defaultNoteTypes),
      makeClient(llmResponse)
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].noteType).toBe('note');
  });

  it('extracts table rows deterministically when LLM provides columnMapping', async () => {
    const content = [
      '| Name | Status | Priority |',
      '| --- | --- | --- |',
      '| Fix login | Open | High |',
      '| Update docs | Done | Low |',
      '| Add tests | Open | Medium |',
    ].join('\n');

    const llmResponse = JSON.stringify([
      {
        type: 'task',
        title: 'Tasks table',
        startLine: 1,
        endLine: 5,
        confidence: 0.85,
        columnMapping: { name: 'name', status: 'status', priority: 'priority' },
      },
    ]);

    const result = await classifyWithLlm(
      content,
      'tasks.md',
      makeRegistry(defaultNoteTypes),
      makeClient(llmResponse)
    );

    expect(result.items).toHaveLength(3);
    expect(result.items[0].noteType).toBe('task');
    expect(result.items[0].title).toBe('Fix login');
    expect(result.items[0].fields.status).toBe('Open');
    expect(result.items[0].fields.priority).toBe('High');
    expect(result.items[1].title).toBe('Update docs');
    expect(result.items[2].title).toBe('Add tests');
    expect(result.remainder).toBeNull();
  });

  it('passes note type descriptions in the prompt to the LLM', async () => {
    const client = makeClient('[]');
    const registry = makeRegistry(defaultNoteTypes);

    await classifyWithLlm('test content', 'doc.md', registry, client);

    expect(client.generate).toHaveBeenCalledTimes(1);
    const [, system] = (client.generate as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(system).toContain('"task"');
    expect(system).toContain('A task or action item');
    expect(system).toContain('"note"');
    expect(system).toContain('A general note');
  });

  it('returns null remainder when all lines are covered', async () => {
    const content = 'Line 1\nLine 2';
    const llmResponse = JSON.stringify([
      { type: 'note', title: 'Full doc', startLine: 1, endLine: 2, confidence: 0.9 },
    ]);

    const result = await classifyWithLlm(
      content,
      'doc.md',
      makeRegistry(defaultNoteTypes),
      makeClient(llmResponse)
    );

    expect(result.items).toHaveLength(1);
    expect(result.remainder).toBeNull();
  });

  it('handles empty LLM response array', async () => {
    const content = 'Some content';
    const result = await classifyWithLlm(
      content,
      'doc.md',
      makeRegistry(defaultNoteTypes),
      makeClient('[]')
    );

    expect(result.items).toHaveLength(0);
    expect(result.remainder).toBe(content);
  });

  it('filters invalid regions missing required fields', async () => {
    const content = 'Line 1\nLine 2';
    const llmResponse = JSON.stringify([
      { type: 'task', title: 'Valid', startLine: 1, endLine: 1, confidence: 0.9 },
      { type: 'task' }, // missing fields
      { title: 'No type', startLine: 1, endLine: 1, confidence: 0.8 }, // missing type
    ]);

    const result = await classifyWithLlm(
      content,
      'doc.md',
      makeRegistry(defaultNoteTypes),
      makeClient(llmResponse)
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('Valid');
  });
});

describe('prepareContent', () => {
  it('returns short content unchanged', () => {
    const content = 'Short document content';
    expect(prepareContent(content)).toBe(content);
  });

  it('truncates long prose content', () => {
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) {
      lines.push(`Line ${i + 1} with some padding to make it longer ${'x'.repeat(20)}`);
    }
    const content = lines.join('\n');

    const result = prepareContent(content);

    expect(result).toContain('lines truncated');
    expect(result.length).toBeLessThan(content.length);
  });

  it('sends only sample rows for tables', () => {
    const lines = ['| Name | Status |', '| --- | --- |'];
    for (let i = 0; i < 20; i++) {
      lines.push(`| Task ${i + 1} | Open |`);
    }
    const content = lines.join('\n');

    const result = prepareContent(content);

    expect(result).toContain('| Name | Status |');
    expect(result).toContain('| --- | --- |');
    expect(result).toContain('| Task 1 | Open |');
    expect(result).toContain('more rows');
    expect(result).not.toContain('| Task 20 | Open |');
  });
});
