import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, makeNote, makeChunk } from '../../helpers.js';
import { computeAutoLinks } from '../../../src/services/graph.js';

let db: BrainDB;
let dbPath: string;

beforeEach(() => {
  dbPath = tmpDbPath('graph-autolink');
  db = new BrainDB(dbPath);
});

afterEach(() => {
  db.close();
});

describe('computeAutoLinks', () => {
  test('creates related edges for high-similarity notes', () => {
    const noteA = makeNote({ id: 'note-a', title: 'Note A' });
    const noteB = makeNote({ id: 'note-b', title: 'Note B' });
    db.upsertNote(noteA);
    db.upsertNote(noteB);

    // Create identical embeddings so distance = 0 => cosine sim = 1.0
    const embedding = new Float32Array(4).fill(0.5);
    const chunkA = makeChunk({ id: 'chunk-a', noteId: 'note-a', content: 'similar content' });
    const chunkB = makeChunk({ id: 'chunk-b', noteId: 'note-b', content: 'similar content too' });
    db.upsertChunks('note-a', [chunkA], [embedding]);
    db.upsertChunks('note-b', [chunkB], [embedding]);

    const links = computeAutoLinks(db, 'note-a', 0.85, 5);

    expect(links.length).toBe(1);
    expect(links[0]).toEqual({
      sourceId: 'note-a',
      targetId: 'note-b',
      type: 'related',
    });
  });

  test('skips when similarity is below threshold', () => {
    const noteA = makeNote({ id: 'note-a', title: 'Note A' });
    const noteB = makeNote({ id: 'note-b', title: 'Note B' });
    db.upsertNote(noteA);
    db.upsertNote(noteB);

    // Create orthogonal embeddings so distance is large => low cosine sim
    const embeddingA = new Float32Array([1, 0, 0, 0]);
    const embeddingB = new Float32Array([0, 1, 0, 0]);
    const chunkA = makeChunk({ id: 'chunk-a', noteId: 'note-a', content: 'topic one' });
    const chunkB = makeChunk({ id: 'chunk-b', noteId: 'note-b', content: 'topic two' });
    db.upsertChunks('note-a', [chunkA], [embeddingA]);
    db.upsertChunks('note-b', [chunkB], [embeddingB]);

    const links = computeAutoLinks(db, 'note-a', 0.85, 5);

    expect(links.length).toBe(0);
  });

  test('does not create duplicate edges for existing relations', () => {
    const noteA = makeNote({ id: 'note-a', title: 'Note A' });
    const noteB = makeNote({ id: 'note-b', title: 'Note B' });
    db.upsertNote(noteA);
    db.upsertNote(noteB);

    const embedding = new Float32Array(4).fill(0.5);
    const chunkA = makeChunk({ id: 'chunk-a', noteId: 'note-a', content: 'similar' });
    const chunkB = makeChunk({ id: 'chunk-b', noteId: 'note-b', content: 'similar' });
    db.upsertChunks('note-a', [chunkA], [embedding]);
    db.upsertChunks('note-b', [chunkB], [embedding]);

    // Pre-create a relation
    db.upsertRelations('note-a', [{ sourceId: 'note-a', targetId: 'note-b', type: 'related' }]);

    const links = computeAutoLinks(db, 'note-a', 0.85, 5);

    expect(links.length).toBe(0);
  });

  test('returns empty when note has no chunks', () => {
    const noteA = makeNote({ id: 'note-a', title: 'Note A' });
    db.upsertNote(noteA);

    const links = computeAutoLinks(db, 'note-a', 0.85, 5);

    expect(links.length).toBe(0);
  });
});

describe('relate command', () => {
  test('creates edge between two notes', async () => {
    const { createRelateCommand } = await import('../../../src/modules/pm/commands/relate.js');
    const noteA = makeNote({ id: 'note-a', title: 'Note A' });
    const noteB = makeNote({ id: 'note-b', title: 'Note B' });
    db.upsertNote(noteA);
    db.upsertNote(noteB);

    createRelateCommand();

    // Manually invoke the action logic via the exported handler
    const { relateAction } = await import('../../../src/modules/pm/commands/relate.js');
    await relateAction(db, 'note-a', 'note-b', { type: 'related' });

    const rels = db.getRelationsFrom('note-a');
    expect(rels).toContainEqual({
      sourceId: 'note-a',
      targetId: 'note-b',
      type: 'related',
    });
  });

  test('removes an edge with remove option', async () => {
    const noteA = makeNote({ id: 'note-a', title: 'Note A' });
    const noteB = makeNote({ id: 'note-b', title: 'Note B' });
    db.upsertNote(noteA);
    db.upsertNote(noteB);

    // Create the relation first
    db.upsertRelations('note-a', [{ sourceId: 'note-a', targetId: 'note-b', type: 'related' }]);
    expect(db.getRelationsFrom('note-a').length).toBe(1);

    const { relateAction } = await import('../../../src/modules/pm/commands/relate.js');
    await relateAction(db, 'note-a', 'note-b', { type: 'related', remove: true });

    const rels = db.getRelationsFrom('note-a');
    expect(rels.length).toBe(0);
  });
});
