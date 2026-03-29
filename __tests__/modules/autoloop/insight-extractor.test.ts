import { describe, it, expect, vi } from 'vitest';
import { extractInsights } from '../../../src/modules/autoloop/engine/insight-extractor.js';
import { createCounters } from '../../../src/modules/autoloop/engine/bounds.js';
import type { TranscriptTurn } from '../../../src/modules/autoloop/engine/discovery.js';
import type { OllamaClient } from '../../../src/services/ollama.js';

function mockOllama(response: string): OllamaClient {
  return {
    model: 'test-model',
    generate: vi.fn().mockResolvedValue(response),
  };
}

describe('extractInsights', () => {
  const sampleTranscript: TranscriptTurn[] = [
    { role: 'user', content: 'Fix the auth bug in login.ts' },
    { role: 'assistant', content: 'I will read the file and investigate.' },
    { role: 'tool_use', content: '[Read] file_path: src/login.ts', toolName: 'Read' },
    { role: 'assistant', content: 'Found the issue. The token was not being refreshed.' },
  ];

  it('extracts valid insights from LLM response', async () => {
    const ollama = mockOllama(
      JSON.stringify([
        {
          category: 'friction',
          title: 'Token refresh bug',
          content: 'Auth token was not being refreshed on expiry.',
          confidence: 0.9,
        },
        {
          category: 'learning',
          title: 'Token lifecycle pattern',
          content: 'Tokens need proactive refresh, not reactive.',
          confidence: 0.7,
        },
      ])
    );

    const counters = createCounters();
    const result = await extractInsights(
      ollama,
      sampleTranscript,
      'session-123',
      'SNS-001',
      counters
    );

    expect(result.insights).toHaveLength(2);
    expect(result.insights[0].category).toBe('friction');
    expect(result.insights[0].title).toBe('Token refresh bug');
    expect(result.insights[0].confidence).toBe(0.9);
    expect(result.insights[0].sourceSessionIds).toEqual(['session-123']);
    expect(result.insights[0].sourceSessionDisplayIds).toEqual(['SNS-001']);
    expect(counters.llmCalls).toBe(1);
  });

  it('handles malformed LLM response gracefully', async () => {
    const ollama = mockOllama('This is not JSON at all');
    const counters = createCounters();
    const result = await extractInsights(
      ollama,
      sampleTranscript,
      'session-123',
      'SNS-001',
      counters
    );
    expect(result.insights).toHaveLength(0);
  });

  it('filters out invalid categories', async () => {
    const ollama = mockOllama(
      JSON.stringify([
        { category: 'invalid', title: 'Bad', content: 'Should be filtered', confidence: 0.5 },
        { category: 'pattern', title: 'Good', content: 'Should be kept', confidence: 0.8 },
      ])
    );

    const counters = createCounters();
    const result = await extractInsights(
      ollama,
      sampleTranscript,
      'session-123',
      'SNS-001',
      counters
    );
    expect(result.insights).toHaveLength(1);
    expect(result.insights[0].category).toBe('pattern');
  });

  it('clamps confidence to 0-1 range', async () => {
    const ollama = mockOllama(
      JSON.stringify([
        { category: 'pattern', title: 'Over', content: 'Too confident', confidence: 1.5 },
        { category: 'pattern', title: 'Under', content: 'Too uncertain', confidence: -0.3 },
      ])
    );

    const counters = createCounters();
    const result = await extractInsights(
      ollama,
      sampleTranscript,
      'session-123',
      'SNS-001',
      counters
    );
    expect(result.insights[0].confidence).toBe(1);
    expect(result.insights[1].confidence).toBe(0);
  });

  it('returns empty for trivial transcripts', async () => {
    const ollama = mockOllama('[]');
    const counters = createCounters();
    const result = await extractInsights(
      ollama,
      [{ role: 'user', content: 'hi' }],
      'session-123',
      'SNS-001',
      counters
    );
    expect(result.insights).toHaveLength(0);
    expect(counters.llmCalls).toBe(0); // Should skip LLM call for trivial input
  });

  it('extracts JSON embedded in markdown', async () => {
    const ollama = mockOllama(
      'Here are the insights:\n```json\n[{"category": "decision", "title": "Used PM notes", "content": "Stored as notes for consistency.", "confidence": 0.85}]\n```'
    );

    const counters = createCounters();
    const result = await extractInsights(
      ollama,
      sampleTranscript,
      'session-123',
      'SNS-001',
      counters
    );
    expect(result.insights).toHaveLength(1);
    expect(result.insights[0].category).toBe('decision');
  });

  it('truncates long titles to 80 chars', async () => {
    const longTitle = 'A'.repeat(120);
    const ollama = mockOllama(
      JSON.stringify([
        { category: 'pattern', title: longTitle, content: 'Content', confidence: 0.5 },
      ])
    );

    const counters = createCounters();
    const result = await extractInsights(
      ollama,
      sampleTranscript,
      'session-123',
      'SNS-001',
      counters
    );
    expect(result.insights[0].title.length).toBe(80);
  });
});
