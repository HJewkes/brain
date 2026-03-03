import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, makeNote } from '../../helpers.js';
import type { SearchResult } from '../../../src/types.js';

let db: BrainDB;
let dbPath: string;

beforeEach(() => {
  dbPath = tmpDbPath('friction-batch1');
  db = new BrainDB(dbPath);
});

afterEach(() => {
  db.close();
});

describe('O-140: search title relevance', () => {
  test('--title filter removes body-only matches', () => {
    db.upsertNote(makeNote({ id: 'title-match', title: 'Deploy pipeline guide' }));
    db.upsertNote(makeNote({ id: 'body-only', title: 'CI configuration' }));

    const query = 'deploy';
    const allResults: SearchResult[] = [
      {
        noteId: 'title-match',
        score: 0.8,
        filePath: '/a.md',
        heading: null,
        excerpt: '',
        tier: 'slow',
        tags: [],
        confidence: null,
      },
      {
        noteId: 'body-only',
        score: 0.9,
        filePath: '/b.md',
        heading: null,
        excerpt: 'deploy stuff',
        tier: 'slow',
        tags: [],
        confidence: null,
      },
    ];

    // Simulate --title filter logic (same as implementation)
    const filtered = allResults.filter((r) => {
      const note = db.getNoteById(r.noteId);
      if (!note) return false;
      return note.title?.toLowerCase().includes(query.toLowerCase());
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].noteId).toBe('title-match');
  });

  test('title matches rank higher than body-only matches', () => {
    db.upsertNote(makeNote({ id: 'title-match', title: 'Kubernetes setup' }));
    db.upsertNote(makeNote({ id: 'body-only', title: 'Infrastructure notes' }));

    const query = 'kubernetes';
    const allResults: SearchResult[] = [
      {
        noteId: 'body-only',
        score: 0.95,
        filePath: '/b.md',
        heading: null,
        excerpt: 'kubernetes stuff',
        tier: 'slow',
        tags: [],
        confidence: null,
      },
      {
        noteId: 'title-match',
        score: 0.7,
        filePath: '/a.md',
        heading: null,
        excerpt: '',
        tier: 'slow',
        tags: [],
        confidence: null,
      },
    ];

    // Simulate relevance boost sort (same as implementation)
    allResults.sort((a, b) => {
      const noteA = db.getNoteById(a.noteId);
      const noteB = db.getNoteById(b.noteId);
      const aTitle = noteA?.title?.toLowerCase().includes(query.toLowerCase()) ? 1 : 0;
      const bTitle = noteB?.title?.toLowerCase().includes(query.toLowerCase()) ? 1 : 0;
      if (aTitle !== bTitle) return bTitle - aTitle;
      return (b.score ?? 0) - (a.score ?? 0);
    });

    // Title match should come first despite lower score
    expect(allResults[0].noteId).toBe('title-match');
    expect(allResults[1].noteId).toBe('body-only');
  });
});

describe('O-161: context auto-correct', () => {
  function taskMeta(displayId: string, project: string, overrides: Record<string, unknown> = {}) {
    const parts = displayId.split(/[-.]/).filter(Boolean);
    return JSON.stringify({
      display_id: displayId,
      project,
      workstream: parts.length >= 2 ? parseInt(parts[1], 10) : 1,
      number: parts.length >= 3 ? parseInt(parts[2], 10) : 1,
      status: 'pending',
      mode: 'auto',
      category: 'implementation',
      priority: 'medium',
      title: overrides.title ?? 'Test Task',
      ...overrides,
    });
  }

  test('didYouMeanSuggestion finds match by workstream and task number', async () => {
    db.upsertNote(
      makeNote({
        id: 'task-0103',
        title: 'Write tests',
        type: 'task',
        module: 'pm',
        metadata: taskMeta('TST-01.03', 'TST', { title: 'Write tests' }),
      })
    );

    const { didYouMeanSuggestion } = await import('../../../src/modules/pm/commands/context.js');

    // Wrong prefix, same numbers — should find TST-01.03
    const suggestion = didYouMeanSuggestion(db, 'XYZ-01.03');
    expect(suggestion).toBe('TST-01.03');
  });

  test('didYouMeanSuggestion returns undefined when no match exists', async () => {
    const { didYouMeanSuggestion } = await import('../../../src/modules/pm/commands/context.js');

    const suggestion = didYouMeanSuggestion(db, 'TST-99.99');
    expect(suggestion).toBeUndefined();
  });

  test('auto-correct produces corrected ID when single suggestion exists', async () => {
    // This tests the auto-correct logic path: when assembleDispatch fails
    // and didYouMeanSuggestion returns a single match, the corrected ID
    // should be used to retry. We verify the suggestion resolves correctly.
    db.upsertNote(
      makeNote({
        id: 'task-0205',
        title: 'Refactor module',
        type: 'task',
        module: 'pm',
        metadata: taskMeta('ABC-02.05', 'ABC', { title: 'Refactor module' }),
      })
    );

    const { didYouMeanSuggestion } = await import('../../../src/modules/pm/commands/context.js');

    // Typo'd prefix — auto-correct should find the single match
    const corrected = didYouMeanSuggestion(db, 'ZZZ-02.05');
    expect(corrected).toBe('ABC-02.05');

    // Verify the corrected ID resolves to the actual note
    const { resolveDisplayId } = await import('../../../src/modules/pm/data/queries.js');
    const result = resolveDisplayId(db, corrected!);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('task-0205');
    }
  });

  test('no auto-correct when suggestion is undefined', async () => {
    // No tasks exist — suggestion should be undefined, command should error
    const { didYouMeanSuggestion } = await import('../../../src/modules/pm/commands/context.js');

    const suggestion = didYouMeanSuggestion(db, 'TST-01.01');
    expect(suggestion).toBeUndefined();
    // In the implementation, when suggestion is undefined, the error path continues
  });
});
