import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvalCorpus } from '../fixtures/corpus-types.js';
import { setupEvalEnvironment, runEvalSuite } from './harness.js';
import { aggregateMetrics } from '../utils/metrics.js';

function loadCorpus(): EvalCorpus {
  const raw = readFileSync(join(__dirname, '..', 'fixtures', 'eval-corpus.json'), 'utf-8');
  return JSON.parse(raw) as EvalCorpus;
}

describe('eval harness', () => {
  it('indexes corpus and finds a known note', async () => {
    const corpus = loadCorpus();
    const env = await setupEvalEnvironment(corpus);

    try {
      const results = await env.search('velocity-based training fundamentals', 5);
      const noteIds = results.map((r) => r.noteId);
      expect(noteIds).toContain('vbt-fundamentals');
    } finally {
      env.cleanup();
    }
  }, 120_000);

  it('runs full eval suite and produces numeric metrics', async () => {
    const corpus = loadCorpus();
    const env = await setupEvalEnvironment(corpus);

    try {
      const evalResults = await runEvalSuite(corpus, env);
      expect(evalResults.length).toBeGreaterThan(0);

      for (const result of evalResults) {
        expect(result.queryId).toBeTruthy();
        expect(result.queryType).toBeTruthy();
        expect(Array.isArray(result.retrieved)).toBe(true);
        expect(result.relevant).toBeInstanceOf(Set);
        expect(Array.isArray(result.scores)).toBe(true);
      }

      const metrics = aggregateMetrics(
        evalResults.map((r) => ({
          retrieved: r.retrieved,
          relevant: r.relevant,
        })),
        5
      );

      expect(typeof metrics.hitRate).toBe('number');
      expect(typeof metrics.mrr).toBe('number');
      expect(typeof metrics.precisionAtK).toBe('number');
      expect(typeof metrics.recallAtK).toBe('number');
      expect(typeof metrics.ndcgAtK).toBe('number');

      // Log for visibility, no assertions on values (that's Task 04)
      console.log('Eval metrics:', metrics);
    } finally {
      env.cleanup();
    }
  }, 120_000);
});
