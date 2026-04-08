import { describe, test, beforeAll, afterAll, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EvalCorpus } from '../fixtures/corpus-types.js';
import { setupEvalEnvironment } from './harness.js';
import { expandResults, traverseGraph, getDirectRelations } from '../../src/services/graph.js';

const corpus: EvalCorpus = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/eval-corpus.json'), 'utf-8')
);

describe('graph expansion', () => {
  let env: Awaited<ReturnType<typeof setupEvalEnvironment>>;

  beforeAll(async () => {
    env = await setupEvalEnvironment(corpus);
  }, 120_000);

  afterAll(async () => {
    await env?.cleanup();
  });

  describe('VBT cluster traversal', () => {
    test('direct relations from VBT overview pull related notes', () => {
      // The VBT cluster has ~5 notes linked via related arrays
      const vbtNotes = corpus.notes.filter(
        (n) => n.id.includes('vbt') || n.id.includes('velocity') || n.id.includes('rpe')
      );
      expect(vbtNotes.length).toBeGreaterThanOrEqual(3);

      // Pick the central VBT note and check its relations
      const centralNote = vbtNotes[0];
      const relations = getDirectRelations(env.db, centralNote.id);
      console.log(`VBT cluster: ${centralNote.id} has ${relations.length} direct relations`);
      expect(relations.length).toBeGreaterThan(0);
    });

    test('expandResults pulls connected notes with decayed scores', () => {
      const vbtNotes = corpus.notes.filter(
        (n) => n.id.includes('vbt') || n.id.includes('velocity') || n.id.includes('rpe')
      );
      const centralId = vbtNotes[0].id;
      const expanded = expandResults(env.db, [centralId], 2);

      console.log(`Expanded from ${centralId}:`);
      for (const item of expanded) {
        console.log(`  ${item.noteId}: score=${item.decayedScore.toFixed(3)}`);
      }

      expect(expanded.length).toBeGreaterThan(0);
    });
  });

  describe('score decay', () => {
    test('depth-1 nodes score higher than depth-2 nodes', () => {
      const vbtNotes = corpus.notes.filter(
        (n) => n.id.includes('vbt') || n.id.includes('velocity')
      );
      if (vbtNotes.length === 0) return;

      const centralId = vbtNotes[0].id;
      const graph = traverseGraph(env.db, centralId, 2);

      const depth1 = graph.nodes.filter((n) => n.depth === 1);
      const depth2 = graph.nodes.filter((n) => n.depth === 2);

      if (depth1.length > 0 && depth2.length > 0) {
        // expandResults uses 0.5^depth for decay
        // depth1 = 0.5, depth2 = 0.25
        console.log(`depth-1 nodes: ${depth1.length}, depth-2 nodes: ${depth2.length}`);
        const expanded = expandResults(env.db, [centralId], 2);
        const d1Scores = expanded.filter((e) => depth1.some((n) => n.id === e.noteId));
        const d2Scores = expanded.filter((e) => depth2.some((n) => n.id === e.noteId));

        if (d1Scores.length > 0 && d2Scores.length > 0) {
          const d1Max = Math.max(...d1Scores.map((s) => s.decayedScore));
          const d2Max = Math.max(...d2Scores.map((s) => s.decayedScore));
          console.log(`  depth-1 max: ${d1Max}, depth-2 max: ${d2Max}`);
          expect(d1Max).toBeGreaterThan(d2Max);
        }
      }
    });
  });

  describe('supersession chain', () => {
    test('traversal follows supersedes relations', () => {
      // Find the supersession chain notes (v1 -> v2 -> v3)
      const v3Notes = corpus.notes.filter((n) => n.id.includes('v3'));
      if (v3Notes.length === 0) return;

      const v3Id = v3Notes[0].id;
      const graph = traverseGraph(env.db, v3Id, 3);

      console.log(`Supersession chain from ${v3Id}:`);
      for (const node of graph.nodes) {
        console.log(`  ${node.id} (depth=${node.depth})`);
      }
      for (const edge of graph.edges) {
        console.log(`  ${edge.sourceId} --${edge.type}--> ${edge.targetId}`);
      }

      // Should reach at least v2 (v3 supersedes v2)
      expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('edge cases', () => {
    test('non-existent note ID does not crash', () => {
      const relations = getDirectRelations(env.db, 'non-existent-note-id');
      expect(relations).toEqual([]);
    });

    test('expandResults with empty input returns empty', () => {
      const expanded = expandResults(env.db, [], 2);
      expect(expanded).toEqual([]);
    });

    test('circular relations do not infinite loop', () => {
      // traverseGraph uses a visited set, so circular refs are safe
      // Find any note with bidirectional related-to links
      const noteWithRelations = corpus.notes.find(
        (n) => n.frontmatter.related && n.frontmatter.related.length > 0
      );
      if (!noteWithRelations) return;

      // This should complete without hanging
      const graph = traverseGraph(env.db, noteWithRelations.id, 3);
      expect(graph.nodes.length).toBeGreaterThan(0);
    });
  });
});
