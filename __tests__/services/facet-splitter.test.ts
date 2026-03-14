import { describe, it, expect } from 'vitest';
import {
  isCompoundMemory,
  splitCompound,
  splitMemoryFacets,
} from '../../src/services/facet-splitter.js';
import type { ExtractedFact } from '../../src/types.js';

describe('isCompoundMemory', () => {
  it('returns false for a single-fact sentence', () => {
    expect(isCompoundMemory('Prefers dark mode in all editors')).toBe(false);
  });

  it('detects bullet-list compound memories', () => {
    const content = '- Uses TypeScript for all projects\n- Prefers Vim keybindings';
    expect(isCompoundMemory(content)).toBe(true);
  });

  it('detects numbered-list compound memories', () => {
    const content = '1. Prefers tabs over spaces\n2. Uses 2-space indent for YAML';
    expect(isCompoundMemory(content)).toBe(true);
  });

  it('detects semicolon-separated facts', () => {
    const content = 'Prefers dark mode for coding; uses light mode for documentation';
    expect(isCompoundMemory(content)).toBe(true);
  });

  it('detects conjunction-separated facts', () => {
    const content = 'Uses PostgreSQL for production databases, and prefers Redis for caching';
    expect(isCompoundMemory(content)).toBe(true);
  });

  it('ignores short semicolon fragments', () => {
    const content = 'Uses vim; ok';
    expect(isCompoundMemory(content)).toBe(false);
  });
});

describe('splitCompound', () => {
  it('splits bullet-list into individual facts', () => {
    const content = '- Uses TypeScript for all projects\n- Prefers Vim keybindings';
    const parts = splitCompound(content);
    expect(parts).toEqual(['Uses TypeScript for all projects', 'Prefers Vim keybindings']);
  });

  it('splits numbered list into individual facts', () => {
    const content = '1) Prefers tabs over spaces\n2) Uses 2-space indent for YAML';
    const parts = splitCompound(content);
    expect(parts).toEqual(['Prefers tabs over spaces', 'Uses 2-space indent for YAML']);
  });

  it('splits semicolon-separated facts', () => {
    const content = 'Prefers dark mode for coding; uses light mode for documentation';
    const parts = splitCompound(content);
    expect(parts).toEqual(['Prefers dark mode for coding', 'uses light mode for documentation']);
  });

  it('splits conjunction-separated facts', () => {
    const content = 'Uses PostgreSQL for production databases, and prefers Redis for caching';
    const parts = splitCompound(content);
    expect(parts).toEqual([
      'Uses PostgreSQL for production databases',
      'prefers Redis for caching',
    ]);
  });

  it('returns original content when not compound', () => {
    const content = 'Prefers dark mode in all editors';
    expect(splitCompound(content)).toEqual(['Prefers dark mode in all editors']);
  });
});

describe('splitMemoryFacets', () => {
  it('passes single-fact memory through unchanged', () => {
    const memories: ExtractedFact[] = [
      { fact: 'Prefers dark mode in all editors', sourceChunkId: 'c1', category: 'preferences' },
    ];
    const result = splitMemoryFacets(memories);
    expect(result).toEqual(memories);
  });

  it('splits bullet-list memory into individual facts', () => {
    const memories: ExtractedFact[] = [
      {
        fact: '- Uses TypeScript for all projects\n- Prefers Vim keybindings',
        sourceChunkId: 'c1',
        category: 'preferences',
      },
    ];
    const result = splitMemoryFacets(memories);
    expect(result).toHaveLength(2);
    expect(result[0].fact).toBe('Uses TypeScript for all projects');
    expect(result[1].fact).toBe('Prefers Vim keybindings');
  });

  it('splits semicolon-separated facts', () => {
    const memories: ExtractedFact[] = [
      {
        fact: 'Prefers dark mode for coding; uses light mode for documentation',
        sourceChunkId: 'c1',
        category: 'tools',
      },
    ];
    const result = splitMemoryFacets(memories);
    expect(result).toHaveLength(2);
    expect(result[0].fact).toBe('Prefers dark mode for coding');
    expect(result[1].fact).toBe('uses light mode for documentation');
  });

  it('splits conjunction-separated facts', () => {
    const memories: ExtractedFact[] = [
      {
        fact: 'Uses PostgreSQL for production databases, and prefers Redis for caching',
        sourceChunkId: 'c1',
        category: 'tools',
      },
    ];
    const result = splitMemoryFacets(memories);
    expect(result).toHaveLength(2);
  });

  it('preserves category from parent on all split facts', () => {
    const memories: ExtractedFact[] = [
      {
        fact: '- Uses TypeScript for all projects\n- Prefers Vim keybindings',
        sourceChunkId: 'c1',
        category: 'preferences',
      },
    ];
    const result = splitMemoryFacets(memories);
    expect(result.every((f) => f.category === 'preferences')).toBe(true);
  });

  it('preserves sourceChunkId from parent on all split facts', () => {
    const memories: ExtractedFact[] = [
      {
        fact: '- Uses TypeScript for all projects\n- Prefers Vim keybindings',
        sourceChunkId: 'chunk-42',
        category: 'tools',
      },
    ];
    const result = splitMemoryFacets(memories);
    expect(result.every((f) => f.sourceChunkId === 'chunk-42')).toBe(true);
  });

  it('does NOT split narrative event memories', () => {
    const memories: ExtractedFact[] = [
      {
        fact: 'Attended the Q4 planning meeting, and discussed the roadmap for next quarter',
        sourceChunkId: 'c1',
        category: 'events',
      },
    ];
    const result = splitMemoryFacets(memories);
    expect(result).toHaveLength(1);
    expect(result[0].fact).toBe(memories[0].fact);
  });

  it('does NOT split narrative case memories', () => {
    const memories: ExtractedFact[] = [
      {
        fact: 'Fixed the database timeout by increasing the pool size, and also added retry logic',
        sourceChunkId: 'c1',
        category: 'cases',
      },
    ];
    const result = splitMemoryFacets(memories);
    expect(result).toHaveLength(1);
    expect(result[0].fact).toBe(memories[0].fact);
  });

  it('handles mixed single and compound memories', () => {
    const memories: ExtractedFact[] = [
      { fact: 'Prefers dark mode', sourceChunkId: 'c1', category: 'preferences' },
      {
        fact: '- Uses ESLint for linting\n- Uses Prettier for formatting',
        sourceChunkId: 'c2',
        category: 'tools',
      },
      { fact: 'Works at Acme Corp', sourceChunkId: 'c3', category: 'profile' },
    ];
    const result = splitMemoryFacets(memories);
    expect(result).toHaveLength(4);
    expect(result[0].fact).toBe('Prefers dark mode');
    expect(result[1].fact).toBe('Uses ESLint for linting');
    expect(result[2].fact).toBe('Uses Prettier for formatting');
    expect(result[3].fact).toBe('Works at Acme Corp');
  });
});
