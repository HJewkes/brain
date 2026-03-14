import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { unlinkSync } from 'node:fs';
import { makeNote, createTestDb } from '../../helpers.js';

describe('NoteRepo trigram FTS', () => {
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

  it('finds partial matches via trigram search', () => {
    const note = makeNote({ id: 'react-hooks' });
    db.upsertNote(note);
    db.upsertNoteFTSTrigram('react-hooks', 'React Hooks Guide', 'How to useEffect properly');

    const results = db.searchFTSTrigram('useEff', 10);
    expect(results).toHaveLength(1);
    expect(results[0].noteId).toBe('react-hooks');
  });

  it('finds camelCase identifiers', () => {
    const note = makeNote({ id: 'api-ref' });
    db.upsertNote(note);
    db.upsertNoteFTSTrigram('api-ref', 'API Reference', 'The handleSubmitForm function');

    const results = db.searchFTSTrigram('handleSubmit', 10);
    expect(results).toHaveLength(1);
    expect(results[0].noteId).toBe('api-ref');
  });

  it('returns empty for queries shorter than 3 chars', () => {
    const note = makeNote({ id: 'short' });
    db.upsertNote(note);
    db.upsertNoteFTSTrigram('short', 'Short', 'Some content here');

    expect(db.searchFTSTrigram('ab', 10)).toEqual([]);
    expect(db.searchFTSTrigram('a', 10)).toEqual([]);
    expect(db.searchFTSTrigram('', 10)).toEqual([]);
  });

  it('returns empty for whitespace-only queries', () => {
    expect(db.searchFTSTrigram('   ', 10)).toEqual([]);
  });

  it('upsert replaces previous trigram entry', () => {
    const note = makeNote({ id: 'evolving' });
    db.upsertNote(note);
    db.upsertNoteFTSTrigram('evolving', 'Original', 'useCallback is great');

    let results = db.searchFTSTrigram('useCallback', 10);
    expect(results).toHaveLength(1);

    db.upsertNoteFTSTrigram('evolving', 'Updated', 'useState instead');

    results = db.searchFTSTrigram('useCallback', 10);
    expect(results).toHaveLength(0);

    results = db.searchFTSTrigram('useState', 10);
    expect(results).toHaveLength(1);
  });

  it('deleteNote removes trigram entry', () => {
    const note = makeNote({ id: 'doomed' });
    db.upsertNote(note);
    db.upsertNoteFTSTrigram('doomed', 'Doomed Note', 'findByIdentifier function');

    let results = db.searchFTSTrigram('findByIdentifier', 10);
    expect(results).toHaveLength(1);

    db.deleteNote('doomed');

    results = db.searchFTSTrigram('findByIdentifier', 10);
    expect(results).toHaveLength(0);
  });

  it('matches in title column', () => {
    const note = makeNote({ id: 'title-match' });
    db.upsertNote(note);
    db.upsertNoteFTSTrigram('title-match', 'useReducer Guide', 'plain body text');

    const results = db.searchFTSTrigram('useReducer', 10);
    expect(results).toHaveLength(1);
    expect(results[0].noteId).toBe('title-match');
  });

  it('respects limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      const note = makeNote({ id: `note-${i}` });
      db.upsertNote(note);
      db.upsertNoteFTSTrigram(`note-${i}`, `Note ${i}`, `The useEffect hook example ${i}`);
    }

    const results = db.searchFTSTrigram('useEffect', 2);
    expect(results).toHaveLength(2);
  });
});
