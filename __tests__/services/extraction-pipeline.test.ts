import { describe, it, expect, vi } from 'vitest';
import { runExtractionPipeline } from '../../src/services/extraction-pipeline.js';
import type { Embedder, BrainConfig } from '../../src/types.js';
import type { ModuleRegistry } from '../../src/modules/registry.js';
import type { BrainDB } from '../../src/services/brain-db.js';

function makeRegistry(overrides: Partial<Record<string, unknown>> = {}): ModuleRegistry {
  return {
    getNoteType: vi.fn().mockReturnValue(undefined),
    matchColumnHeaders: vi.fn().mockReturnValue(null),
    getArchetypeTexts: vi.fn().mockReturnValue(new Map()),
    getContentHandlers: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as ModuleRegistry;
}

function makeEmbedder(): Embedder {
  return { embed: vi.fn().mockResolvedValue([]), model: 'test', dimensions: 3 };
}

function makeDb(): BrainDB {
  return {} as unknown as BrainDB;
}

function makeConfig(): BrainConfig {
  return {
    notesDir: '/tmp/notes',
    dbPath: '/tmp/brain.db',
    embedder: 'local',
    fusionWeights: { bm25: 0.5, vector: 0.5 },
  } as BrainConfig;
}

describe('runExtractionPipeline', () => {
  it('returns extracted items from tier 1', async () => {
    const csv = `Name,Status,Priority\nFix bug,Open,High`;
    const registry = makeRegistry({
      matchColumnHeaders: vi.fn().mockReturnValue({
        module: 'pm',
        noteType: 'task',
        columnMapping: { name: 'name', status: 'status', priority: 'priority' },
      }),
    });

    const result = await runExtractionPipeline(
      csv, 'tasks.csv', registry, makeEmbedder(), makeDb(), makeConfig(), 'src-1'
    );

    expect(result.extracted).toHaveLength(1);
    expect(result.extracted[0].noteType).toBe('task');
    expect(result.extracted[0].title).toBe('Fix bug');
  });

  it('creates fallback note for remainder when maxTier >= 2', async () => {
    const content = 'This is some unstructured content that does not match any pattern at all.';
    const registry = makeRegistry();

    const result = await runExtractionPipeline(
      content, 'notes.txt', registry, makeEmbedder(), makeDb(), makeConfig(), 'src-1'
    );

    expect(result.extracted).toHaveLength(1);
    expect(result.extracted[0].noteType).toBe('note');
    expect(result.extracted[0].content).toBe(content);
  });

  it('does not create fallback note when maxTier is 1', async () => {
    const content = 'Unstructured content that matches nothing.';
    const registry = makeRegistry();

    const result = await runExtractionPipeline(
      content, 'notes.txt', registry, makeEmbedder(), makeDb(), makeConfig(), 'src-1',
      { maxTier: 1 }
    );

    expect(result.extracted).toHaveLength(0);
  });

  it('dispatches items to V2 content handlers', async () => {
    const materializeFn = vi.fn().mockResolvedValue(['note-abc']);
    const registry = makeRegistry({
      matchColumnHeaders: vi.fn().mockReturnValue({
        module: 'pm',
        noteType: 'task',
        columnMapping: { name: 'name', status: 'status' },
      }),
      getContentHandlers: vi.fn().mockReturnValue([
        {
          module: 'pm',
          handler: {
            noteTypes: ['task'],
            canHandle: () => true,
            materialize: materializeFn,
          },
        },
      ]),
    });

    const result = await runExtractionPipeline(
      `Name,Status\nBuild API,Open`, 'tasks.csv', registry, makeEmbedder(), makeDb(), makeConfig(), 'src-1'
    );

    expect(materializeFn).toHaveBeenCalledOnce();
    expect(result.materializedNoteIds).toEqual(['note-abc']);
  });

  it('does not fail when no handler matches', async () => {
    const csv = `Name,Status\nTask A,Open`;
    const registry = makeRegistry({
      matchColumnHeaders: vi.fn().mockReturnValue({
        module: 'pm',
        noteType: 'task',
        columnMapping: { name: 'name', status: 'status' },
      }),
      getContentHandlers: vi.fn().mockReturnValue([]),
    });

    const result = await runExtractionPipeline(
      csv, 'tasks.csv', registry, makeEmbedder(), makeDb(), makeConfig(), 'src-1'
    );

    expect(result.extracted).toHaveLength(1);
    expect(result.materializedNoteIds).toHaveLength(0);
  });

  it('skips very short remainder', async () => {
    const content = 'Short';
    const registry = makeRegistry();

    const result = await runExtractionPipeline(
      content, 'x.txt', registry, makeEmbedder(), makeDb(), makeConfig(), 'src-1'
    );

    expect(result.extracted).toHaveLength(0);
  });
});
