import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'node:fs';
import { BrainDB } from '../../src/services/brain-db.js';
import { enrichSearchResults } from '../../src/services/relational-enrichment.js';
import type { SearchResult } from '../../src/types.js';
import { makeNote, createTestDb } from '../helpers.js';

function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    score: overrides.score ?? 0.9,
    filePath: overrides.filePath ?? '/notes/test.md',
    noteId: overrides.noteId ?? 'note-1',
    heading: overrides.heading ?? null,
    excerpt: overrides.excerpt ?? 'test excerpt',
    tier: overrides.tier ?? 'slow',
    tags: overrides.tags ?? [],
    confidence: overrides.confidence ?? null,
    matchSource: overrides.matchSource ?? 'both',
  };
}

describe('relational enrichment', () => {
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

  function seedRelatedNotes(): void {
    db.upsertNote(makeNote({ id: 'A', title: 'Note A', summary: 'Summary of A' }));
    db.upsertNote(makeNote({ id: 'B', title: 'Note B', l0Abstract: 'Abstract of B' }));
    db.upsertNote(makeNote({ id: 'C', title: 'Note C', summary: 'Summary of C' }));
    db.upsertNote(makeNote({ id: 'D', title: 'Note D' }));
    db.upsertNote(makeNote({ id: 'E', title: 'Note E', summary: 'Summary of E' }));

    db.upsertRelations('A', [
      { sourceId: 'A', targetId: 'B', type: 'related-to' },
      { sourceId: 'A', targetId: 'C', type: 'informs' },
    ]);
    db.upsertRelations('D', [{ sourceId: 'D', targetId: 'A', type: 'supersedes' }]);
  }

  it('attaches related notes with abstracts to search results', () => {
    seedRelatedNotes();

    const results = [makeSearchResult({ noteId: 'A' })];
    const enriched = enrichSearchResults(db, results);

    expect(enriched).toHaveLength(1);
    expect(enriched[0].relatedNotes).toHaveLength(3);

    const titles = enriched[0].relatedNotes.map((r) => r.title);
    expect(titles).toContain('Note B');
    expect(titles).toContain('Note C');
    expect(titles).toContain('Note D');
  });

  it('prefers l0Abstract over summary', () => {
    seedRelatedNotes();

    const results = [makeSearchResult({ noteId: 'A' })];
    const enriched = enrichSearchResults(db, results);

    const noteB = enriched[0].relatedNotes.find((r) => r.noteId === 'B');
    expect(noteB?.abstract).toBe('Abstract of B');

    const noteC = enriched[0].relatedNotes.find((r) => r.noteId === 'C');
    expect(noteC?.abstract).toBe('Summary of C');
  });

  it('returns empty relatedNotes for notes with no relations', () => {
    db.upsertNote(makeNote({ id: 'lonely', title: 'Lonely Note' }));

    const results = [makeSearchResult({ noteId: 'lonely' })];
    const enriched = enrichSearchResults(db, results);

    expect(enriched).toHaveLength(1);
    expect(enriched[0].relatedNotes).toHaveLength(0);
  });

  it('respects maxRelated limit', () => {
    db.upsertNote(makeNote({ id: 'hub', title: 'Hub' }));
    for (let i = 0; i < 8; i++) {
      const id = `spoke-${i}`;
      db.upsertNote(makeNote({ id, title: `Spoke ${i}` }));
    }
    db.upsertRelations(
      'hub',
      Array.from({ length: 8 }, (_, i) => ({
        sourceId: 'hub',
        targetId: `spoke-${i}`,
        type: 'related-to' as const,
      }))
    );

    const results = [makeSearchResult({ noteId: 'hub' })];
    const enriched = enrichSearchResults(db, results, { maxRelated: 3 });

    expect(enriched[0].relatedNotes).toHaveLength(3);
  });

  it('respects maxResults limit', () => {
    db.upsertNote(makeNote({ id: 'n1', title: 'N1' }));
    db.upsertNote(makeNote({ id: 'n2', title: 'N2' }));
    db.upsertNote(makeNote({ id: 'n3', title: 'N3' }));
    db.upsertNote(makeNote({ id: 'r1', title: 'R1' }));
    db.upsertNote(makeNote({ id: 'r2', title: 'R2' }));
    db.upsertNote(makeNote({ id: 'r3', title: 'R3' }));

    db.upsertRelations('n1', [{ sourceId: 'n1', targetId: 'r1', type: 'related-to' }]);
    db.upsertRelations('n2', [{ sourceId: 'n2', targetId: 'r2', type: 'related-to' }]);
    db.upsertRelations('n3', [{ sourceId: 'n3', targetId: 'r3', type: 'related-to' }]);

    const results = [
      makeSearchResult({ noteId: 'n1', score: 0.9 }),
      makeSearchResult({ noteId: 'n2', score: 0.8 }),
      makeSearchResult({ noteId: 'n3', score: 0.7 }),
    ];

    const enriched = enrichSearchResults(db, results, { maxResults: 2 });

    expect(enriched[0].relatedNotes).toHaveLength(1);
    expect(enriched[1].relatedNotes).toHaveLength(1);
    expect(enriched[2].relatedNotes).toHaveLength(0);
  });

  it('includes relation type in summaries', () => {
    seedRelatedNotes();

    const results = [makeSearchResult({ noteId: 'A' })];
    const enriched = enrichSearchResults(db, results);

    const noteB = enriched[0].relatedNotes.find((r) => r.noteId === 'B');
    expect(noteB?.relationType).toBe('related-to');

    const noteC = enriched[0].relatedNotes.find((r) => r.noteId === 'C');
    expect(noteC?.relationType).toBe('informs');
  });

  it('returns null abstract when note has neither l0Abstract nor summary', () => {
    seedRelatedNotes();

    const results = [makeSearchResult({ noteId: 'A' })];
    const enriched = enrichSearchResults(db, results);

    const noteD = enriched[0].relatedNotes.find((r) => r.noteId === 'D');
    expect(noteD?.abstract).toBeNull();
  });

  it('defaults to maxRelated=5 and maxResults=3', () => {
    db.upsertNote(makeNote({ id: 'hub', title: 'Hub' }));
    for (let i = 0; i < 7; i++) {
      db.upsertNote(makeNote({ id: `s-${i}`, title: `S${i}` }));
    }
    db.upsertRelations(
      'hub',
      Array.from({ length: 7 }, (_, i) => ({
        sourceId: 'hub',
        targetId: `s-${i}`,
        type: 'related-to' as const,
      }))
    );

    const results = [makeSearchResult({ noteId: 'hub' })];
    const enriched = enrichSearchResults(db, results);

    expect(enriched[0].relatedNotes).toHaveLength(5);
  });
});
