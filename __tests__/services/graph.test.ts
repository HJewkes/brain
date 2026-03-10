import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../src/services/brain-db.js';
import { unlinkSync } from 'node:fs';
import { getDirectRelations, traverseGraph, expandResults } from '../../src/services/graph.js';
import { makeNote, createTestDb } from '../helpers.js';

describe('graph service', () => {
  let db: BrainDB;
  let dbPath: string;

  beforeEach(() => {
    ({ dbPath, db } = createTestDb());
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  function seedChain(): void {
    db.upsertNote(makeNote({ id: 'A', title: 'Note A' }));
    db.upsertNote(makeNote({ id: 'B', title: 'Note B' }));
    db.upsertNote(makeNote({ id: 'C', title: 'Note C' }));
    db.upsertNote(makeNote({ id: 'D', title: 'Note D' }));

    db.upsertRelations('A', [{ sourceId: 'A', targetId: 'B', type: 'related-to' }]);
    db.upsertRelations('B', [{ sourceId: 'B', targetId: 'C', type: 'related-to' }]);
    db.upsertRelations('C', [{ sourceId: 'C', targetId: 'D', type: 'related-to' }]);
  }

  describe('getDirectRelations', () => {
    it('returns both outgoing and incoming relations', () => {
      db.upsertNote(makeNote({ id: 'X', title: 'X' }));
      db.upsertNote(makeNote({ id: 'Y', title: 'Y' }));
      db.upsertNote(makeNote({ id: 'Z', title: 'Z' }));

      db.upsertRelations('X', [{ sourceId: 'X', targetId: 'Y', type: 'related-to' }]);
      db.upsertRelations('Z', [{ sourceId: 'Z', targetId: 'Y', type: 'informs' }]);

      const rels = getDirectRelations(db, 'Y');
      expect(rels).toHaveLength(2);

      const sourceIds = rels.map((r) => r.sourceId).sort();
      expect(sourceIds).toEqual(['X', 'Z']);
    });

    it('returns each relation with source/target IDs and type', () => {
      db.upsertNote(makeNote({ id: 'P', title: 'P' }));
      db.upsertNote(makeNote({ id: 'Q', title: 'Q' }));

      db.upsertRelations('P', [{ sourceId: 'P', targetId: 'Q', type: 'supersedes' }]);

      const rels = getDirectRelations(db, 'P');
      expect(rels).toHaveLength(1);
      expect(rels[0]).toEqual({
        sourceId: 'P',
        targetId: 'Q',
        type: 'supersedes',
      });
    });

    it('returns empty array for notes with no relations', () => {
      db.upsertNote(makeNote({ id: 'lonely' }));
      const rels = getDirectRelations(db, 'lonely');
      expect(rels).toHaveLength(0);
    });
  });

  describe('traverseGraph', () => {
    it('depth 1 returns root + direct neighbors', () => {
      seedChain();
      const result = traverseGraph(db, 'A', 1);

      expect(result.root.id).toBe('A');
      expect(result.root.depth).toBe(0);

      const nodeIds = result.nodes.map((n) => n.id).sort();
      expect(nodeIds).toEqual(['A', 'B']);
    });

    it('depth 2 returns root + 2 hops', () => {
      seedChain();
      const result = traverseGraph(db, 'A', 2);
      const nodeIds = result.nodes.map((n) => n.id).sort();
      expect(nodeIds).toEqual(['A', 'B', 'C']);
    });

    it('depth 3 returns entire chain', () => {
      seedChain();
      const result = traverseGraph(db, 'A', 3);
      const nodeIds = result.nodes.map((n) => n.id).sort();
      expect(nodeIds).toEqual(['A', 'B', 'C', 'D']);
    });

    it('handles cycles without infinite loop', () => {
      db.upsertNote(makeNote({ id: 'cyc-A', title: 'Cyc A' }));
      db.upsertNote(makeNote({ id: 'cyc-B', title: 'Cyc B' }));

      db.upsertRelations('cyc-A', [{ sourceId: 'cyc-A', targetId: 'cyc-B', type: 'related-to' }]);
      db.upsertRelations('cyc-B', [{ sourceId: 'cyc-B', targetId: 'cyc-A', type: 'related-to' }]);

      const result = traverseGraph(db, 'cyc-A', 3);
      const nodeIds = result.nodes.map((n) => n.id).sort();
      expect(nodeIds).toEqual(['cyc-A', 'cyc-B']);
    });

    it('returns edges in the result', () => {
      seedChain();
      const result = traverseGraph(db, 'A', 2);

      expect(result.edges.length).toBeGreaterThanOrEqual(2);
      const edgePairs = result.edges.map((e) => `${e.sourceId}->${e.targetId}`);
      expect(edgePairs).toContain('A->B');
      expect(edgePairs).toContain('B->C');
    });

    it('assigns correct depth to each node', () => {
      seedChain();
      const result = traverseGraph(db, 'A', 3);

      const depthMap = new Map(result.nodes.map((n) => [n.id, n.depth]));
      expect(depthMap.get('A')).toBe(0);
      expect(depthMap.get('B')).toBe(1);
      expect(depthMap.get('C')).toBe(2);
      expect(depthMap.get('D')).toBe(3);
    });

    it('caps depth at 3 even if higher is requested', () => {
      seedChain();
      db.upsertNote(makeNote({ id: 'E', title: 'Note E' }));
      db.upsertRelations('D', [{ sourceId: 'D', targetId: 'E', type: 'related-to' }]);

      const result = traverseGraph(db, 'A', 10);
      const nodeIds = result.nodes.map((n) => n.id).sort();
      expect(nodeIds).toEqual(['A', 'B', 'C', 'D']);
      expect(nodeIds).not.toContain('E');
    });

    it('includes node metadata (title, type, tier)', () => {
      db.upsertNote(makeNote({ id: 'meta', title: 'Meta Note', type: 'decision', tier: 'fast' }));
      const result = traverseGraph(db, 'meta', 1);

      expect(result.root.title).toBe('Meta Note');
      expect(result.root.type).toBe('decision');
      expect(result.root.tier).toBe('fast');
    });
  });

  describe('expandResults', () => {
    it('returns connected note IDs with decayed scores', () => {
      seedChain();
      const expanded = expandResults(db, ['A'], 1);

      expect(expanded).toHaveLength(1);
      expect(expanded[0].noteId).toBe('B');
      expect(expanded[0].decayedScore).toBeCloseTo(0.5);
    });

    it('applies score decay of 0.5^depth', () => {
      seedChain();
      const expanded = expandResults(db, ['A'], 2);

      const scoreMap = new Map(expanded.map((e) => [e.noteId, e.decayedScore]));
      expect(scoreMap.get('B')).toBeCloseTo(0.5);
      expect(scoreMap.get('C')).toBeCloseTo(0.25);
    });

    it('excludes original input notes from results', () => {
      seedChain();
      const expanded = expandResults(db, ['A'], 2);
      const ids = expanded.map((e) => e.noteId);
      expect(ids).not.toContain('A');
    });

    it('deduplicates keeping highest score', () => {
      // B is reachable from both A (depth 1) and C (depth 1)
      seedChain();
      const expanded = expandResults(db, ['A', 'C'], 1);

      const bEntries = expanded.filter((e) => e.noteId === 'B');
      expect(bEntries).toHaveLength(1);
      expect(bEntries[0].decayedScore).toBeCloseTo(0.5);
    });

    it('returns empty array when no relations exist', () => {
      db.upsertNote(makeNote({ id: 'solo' }));
      const expanded = expandResults(db, ['solo'], 2);
      expect(expanded).toHaveLength(0);
    });

    it('handles empty input array', () => {
      const expanded = expandResults(db, [], 2);
      expect(expanded).toHaveLength(0);
    });
  });

  describe('mixed relation types', () => {
    it('traverses related-to bidirectionally', () => {
      db.upsertNote(makeNote({ id: 'bi-A', title: 'Bi A' }));
      db.upsertNote(makeNote({ id: 'bi-B', title: 'Bi B' }));

      db.upsertRelations('bi-A', [{ sourceId: 'bi-A', targetId: 'bi-B', type: 'related-to' }]);

      // Starting from B, should reach A via reverse traversal
      const result = traverseGraph(db, 'bi-B', 1);
      const nodeIds = result.nodes.map((n) => n.id).sort();
      expect(nodeIds).toEqual(['bi-A', 'bi-B']);
    });

    it('traverses supersedes only forward (source to target)', () => {
      db.upsertNote(makeNote({ id: 'old', title: 'Old' }));
      db.upsertNote(makeNote({ id: 'new', title: 'New' }));

      db.upsertRelations('new', [{ sourceId: 'new', targetId: 'old', type: 'supersedes' }]);

      // From new -> old is reachable (forward)
      const fromNew = traverseGraph(db, 'new', 1);
      expect(fromNew.nodes.map((n) => n.id).sort()).toEqual(['new', 'old']);

      // From old -> new is NOT reachable (supersedes is directional)
      const fromOld = traverseGraph(db, 'old', 1);
      expect(fromOld.nodes.map((n) => n.id)).toEqual(['old']);
    });

    it('traverses informs only forward', () => {
      db.upsertNote(makeNote({ id: 'inf-src', title: 'Source' }));
      db.upsertNote(makeNote({ id: 'inf-tgt', title: 'Target' }));

      db.upsertRelations('inf-src', [
        { sourceId: 'inf-src', targetId: 'inf-tgt', type: 'informs' },
      ]);

      const fromSrc = traverseGraph(db, 'inf-src', 1);
      expect(fromSrc.nodes.map((n) => n.id).sort()).toEqual(['inf-src', 'inf-tgt']);

      const fromTgt = traverseGraph(db, 'inf-tgt', 1);
      expect(fromTgt.nodes.map((n) => n.id)).toEqual(['inf-tgt']);
    });

    it('traverses parent bidirectionally', () => {
      db.upsertNote(makeNote({ id: 'child', title: 'Child' }));
      db.upsertNote(makeNote({ id: 'par', title: 'Parent' }));

      // parent relation: child -> parent (source is the note declaring its parent)
      db.upsertRelations('child', [{ sourceId: 'child', targetId: 'par', type: 'parent' }]);

      const fromChild = traverseGraph(db, 'child', 1);
      expect(fromChild.nodes.map((n) => n.id).sort()).toEqual(['child', 'par']);

      // Starting from parent should find child via incoming parent edge
      const fromParent = traverseGraph(db, 'par', 1);
      expect(fromParent.nodes.map((n) => n.id).sort()).toEqual(['child', 'par']);
    });

    it('traverses depends_on bidirectionally', () => {
      db.upsertNote(makeNote({ id: 'dep-a', title: 'Task A' }));
      db.upsertNote(makeNote({ id: 'dep-b', title: 'Task B' }));

      // dep-a depends_on dep-b
      db.upsertRelations('dep-a', [{ sourceId: 'dep-a', targetId: 'dep-b', type: 'depends_on' }]);

      // From dep-a (source) should find dep-b via outgoing edge
      const fromA = traverseGraph(db, 'dep-a', 1);
      expect(fromA.nodes.map((n) => n.id).sort()).toEqual(['dep-a', 'dep-b']);

      // From dep-b (target) should find dep-a via incoming depends_on edge
      const fromB = traverseGraph(db, 'dep-b', 1);
      expect(fromB.nodes.map((n) => n.id).sort()).toEqual(['dep-a', 'dep-b']);
    });

    it('handles mixed relation types in a graph', () => {
      db.upsertNote(makeNote({ id: 'hub', title: 'Hub' }));
      db.upsertNote(makeNote({ id: 'rel', title: 'Related' }));
      db.upsertNote(makeNote({ id: 'sup', title: 'Superseded' }));
      db.upsertNote(makeNote({ id: 'inf', title: 'Informed' }));

      db.upsertRelations('hub', [
        { sourceId: 'hub', targetId: 'rel', type: 'related-to' },
        { sourceId: 'hub', targetId: 'sup', type: 'supersedes' },
        { sourceId: 'hub', targetId: 'inf', type: 'informs' },
      ]);

      const result = traverseGraph(db, 'hub', 1);
      const nodeIds = result.nodes.map((n) => n.id).sort();
      expect(nodeIds).toEqual(['hub', 'inf', 'rel', 'sup']);
    });
  });
});
