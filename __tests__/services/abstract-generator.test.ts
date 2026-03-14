import { describe, it, expect, vi } from 'vitest';
import type { OllamaClient } from '../../src/services/ollama.js';
import {
  generateAbstracts,
  generateL0Abstract,
  generateL1Overview,
} from '../../src/services/abstract-generator.js';

function mockOllama(responses: Map<string, string>): OllamaClient {
  return {
    model: 'test-model',
    generate: vi.fn(async (_prompt: string, system?: string) => {
      for (const [key, value] of responses) {
        if (system?.includes(key)) return value;
      }
      return 'default response';
    }),
  };
}

describe('generateAbstracts', () => {
  it('calls ollama with both L0 and L1 prompts in parallel', async () => {
    const ollama = mockOllama(
      new Map([
        ['concise summarizer', 'Short abstract about velocity training.'],
        ['structured summarizer', '# Overview\n\nDetailed overview of VBT concepts.'],
      ])
    );

    const result = await generateAbstracts(ollama, 'VBT Fundamentals', 'Some content about VBT.');

    expect(result.l0Abstract).toBe('Short abstract about velocity training.');
    expect(result.l1Overview).toBe('# Overview\n\nDetailed overview of VBT concepts.');
    expect(ollama.generate).toHaveBeenCalledTimes(2);
  });

  it('passes title and content in the prompt', async () => {
    const ollama = mockOllama(
      new Map([
        ['concise', 'abstract'],
        ['structured', 'overview'],
      ])
    );
    await generateAbstracts(ollama, 'My Title', 'My content here.');

    const calls = (ollama.generate as ReturnType<typeof vi.fn>).mock.calls;
    for (const call of calls) {
      expect(call[0]).toContain('My Title');
      expect(call[0]).toContain('My content here.');
    }
  });
});

describe('generateL0Abstract', () => {
  it('generates only the L0 abstract', async () => {
    const ollama = mockOllama(new Map([['concise summarizer', 'A brief abstract.']]));

    const result = await generateL0Abstract(ollama, 'Title', 'Content');
    expect(result).toBe('A brief abstract.');
    expect(ollama.generate).toHaveBeenCalledTimes(1);
  });
});

describe('generateL1Overview', () => {
  it('generates only the L1 overview', async () => {
    const ollama = mockOllama(
      new Map([['structured summarizer', '# Structured\n\nOverview text.']])
    );

    const result = await generateL1Overview(ollama, 'Title', 'Content');
    expect(result).toBe('# Structured\n\nOverview text.');
    expect(ollama.generate).toHaveBeenCalledTimes(1);
  });
});
