import { describe, it, expect, vi } from 'vitest';
import {
  crossRefResearchToWorkstreams,
  extractRecommendations,
  findSynthesisNotes,
} from '../../../src/modules/autoloop/engine/cross-ref.js';
import type { NoteRecord } from '../../../src/types.js';

function makeNote(overrides: Partial<NoteRecord>): NoteRecord {
  return {
    id: 'test-note',
    filePath: '/tmp/test.md',
    title: 'Test Note',
    type: 'research',
    tier: 'slow',
    category: null,
    tags: null,
    summary: null,
    confidence: null,
    status: 'active',
    sources: null,
    createdAt: null,
    modifiedAt: null,
    lastReviewed: null,
    reviewInterval: null,
    expires: null,
    metadata: null,
    module: null,
    moduleInstance: null,
    contentDir: null,
    ...overrides,
  } as NoteRecord;
}

describe('extractRecommendations', () => {
  it('extracts actionable lines from summary', () => {
    const note = makeNote({
      summary: '- Add temporal memory invalidation\n- Implement sleep-time consolidation',
      tags: 'synthesis',
    });

    const recs = extractRecommendations(note);

    expect(recs).toHaveLength(2);
    expect(recs[0].text).toContain('temporal memory invalidation');
    expect(recs[1].text).toContain('sleep-time consolidation');
  });

  it('marks competitive notes with higher priority', () => {
    const note = makeNote({
      summary: '- Add real-time sync — gap identified vs competitor',
      tags: 'synthesis,competitive',
    });

    const recs = extractRecommendations(note);

    expect(recs).toHaveLength(1);
    expect(recs[0].isCompetitive).toBe(true);
    expect(recs[0].priority).toBe('high');
  });

  it('infers critical priority from keywords', () => {
    const note = makeNote({
      summary: '- Implement critical security patch for auth module',
      tags: 'synthesis',
    });

    const recs = extractRecommendations(note);

    expect(recs[0].priority).toBe('critical');
  });

  it('falls back to full summary when no actionable lines found', () => {
    const note = makeNote({
      summary: 'This is a general observation about the architecture.',
      tags: 'synthesis',
    });

    const recs = extractRecommendations(note);

    expect(recs).toHaveLength(1);
    expect(recs[0].text).toContain('general observation');
    expect(recs[0].priority).toBe('medium');
  });

  it('handles null summary gracefully', () => {
    const note = makeNote({ summary: null, tags: 'synthesis' });

    const recs = extractRecommendations(note);

    expect(recs).toHaveLength(0);
  });

  it('detects gap/missing keywords in competitive context', () => {
    const note = makeNote({
      summary: '- Support is missing for multi-tenant deployments',
      tags: 'synthesis,competitive,comparison',
    });

    const recs = extractRecommendations(note);

    expect(recs[0].isCompetitive).toBe(true);
    expect(recs[0].priority).toBe('high');
  });
});

describe('findSynthesisNotes', () => {
  it('returns notes matching category:synthesis', () => {
    const noteId = 'synth-1';
    const noteMap = new Map([[noteId, makeNote({ id: noteId, category: 'synthesis' })]]);

    const db = {
      getFilteredNoteIds: vi.fn().mockReturnValue(new Set([noteId])),
      getNotesByIds: vi.fn().mockReturnValue(noteMap),
    } as unknown as Parameters<typeof findSynthesisNotes>[0];

    const notes = findSynthesisNotes(db);

    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(noteId);
  });

  it('falls back to tag-based search when no category match', () => {
    const noteId = 'synth-tag';
    const noteMap = new Map([[noteId, makeNote({ id: noteId, tags: 'synthesis' })]]);

    const db = {
      getFilteredNoteIds: vi
        .fn()
        .mockReturnValueOnce(null) // category returns null
        .mockReturnValueOnce(new Set([noteId])), // tags returns match
      getNotesByIds: vi.fn().mockReturnValue(noteMap),
    } as unknown as Parameters<typeof findSynthesisNotes>[0];

    const notes = findSynthesisNotes(db);

    expect(notes).toHaveLength(1);
  });

  it('returns empty when no synthesis notes exist', () => {
    const db = {
      getFilteredNoteIds: vi.fn().mockReturnValue(null),
      getNotesByIds: vi.fn().mockReturnValue(new Map()),
    } as unknown as Parameters<typeof findSynthesisNotes>[0];

    const notes = findSynthesisNotes(db);

    expect(notes).toHaveLength(0);
  });
});

describe('crossRefResearchToWorkstreams', () => {
  function makeMockDb(opts: {
    filteredNoteIds?: Set<string> | null;
    notes?: Map<string, NoteRecord>;
  }) {
    const notes = opts.notes ?? new Map();
    return {
      getFilteredNoteIds: vi.fn().mockReturnValue(opts.filteredNoteIds ?? null),
      getNotesByIds: vi.fn().mockReturnValue(notes),
      getModuleNoteIds: vi.fn().mockReturnValue([]),
      getRelationsFrom: vi.fn().mockReturnValue([]),
      getRelationsTo: vi.fn().mockReturnValue([]),
      getMetaValue: vi.fn().mockReturnValue('VNM'),
    } as unknown as Parameters<typeof crossRefResearchToWorkstreams>[0];
  }

  function makeMockEmbedder() {
    return {
      embed: vi.fn().mockResolvedValue(new Float32Array(768)),
      embedBatch: vi.fn().mockResolvedValue([new Float32Array(768)]),
      dimensions: 768,
    } as unknown as Parameters<typeof crossRefResearchToWorkstreams>[1];
  }

  it('returns empty report when no synthesis notes exist', async () => {
    const db = makeMockDb({});
    const embedder = makeMockEmbedder();

    const report = await crossRefResearchToWorkstreams(db, embedder, { project: 'VNM' });

    expect(report.synthesisNotesScanned).toBe(0);
    expect(report.suggestedNewTasks).toHaveLength(0);
    expect(report.taskUpdates).toHaveLength(0);
    expect(report.priorityChanges).toHaveLength(0);
    expect(report.errors).toContainEqual(expect.stringContaining('No synthesis'));
  });

  it('generates new task suggestions from synthesis notes', async () => {
    const noteId = 'synthesis-note-1';
    const notes = new Map([
      [
        noteId,
        makeNote({
          id: noteId,
          title: 'Competitive Analysis: Agent Memory Systems',
          summary: '- Add temporal memory invalidation\n- Implement sleep-time consolidation',
          tags: 'synthesis,competitive',
          category: 'synthesis',
        }),
      ],
    ]);

    const db = makeMockDb({ filteredNoteIds: new Set([noteId]), notes });
    const embedder = makeMockEmbedder();

    const report = await crossRefResearchToWorkstreams(db, embedder, { project: 'VNM' });

    expect(report.synthesisNotesScanned).toBe(1);
    expect(report.suggestedNewTasks.length).toBeGreaterThanOrEqual(1);
    expect(report.suggestedNewTasks[0].sourceNoteId).toBe(noteId);
  });

  it('respects maxSuggestedTasks limit', async () => {
    const noteId = 'synthesis-note-2';
    const notes = new Map([
      [
        noteId,
        makeNote({
          id: noteId,
          title: 'Feature Gap Analysis',
          summary: [
            '- Add feature A for gap coverage',
            '- Implement feature B for parity',
            '- Build feature C for competitive edge',
            '- Create feature D for user retention',
            '- Enable feature E for performance',
          ].join('\n'),
          tags: 'synthesis',
          category: 'synthesis',
        }),
      ],
    ]);

    const db = makeMockDb({ filteredNoteIds: new Set([noteId]), notes });
    const embedder = makeMockEmbedder();

    const report = await crossRefResearchToWorkstreams(db, embedder, {
      project: 'VNM',
      maxSuggestedTasks: 2,
    });

    expect(report.suggestedNewTasks.length).toBeLessThanOrEqual(2);
  });

  it('marks competitive gap suggestions as high priority', async () => {
    const noteId = 'competitive-synthesis';
    const notes = new Map([
      [
        noteId,
        makeNote({
          id: noteId,
          title: 'Competitor Analysis: Missing Features',
          summary: '- Add real-time sync — gap identified vs competitor X',
          tags: 'synthesis,competitive,comparison',
          category: 'synthesis',
        }),
      ],
    ]);

    const db = makeMockDb({ filteredNoteIds: new Set([noteId]), notes });
    const embedder = makeMockEmbedder();

    const report = await crossRefResearchToWorkstreams(db, embedder, { project: 'VNM' });

    expect(report.suggestedNewTasks.length).toBeGreaterThanOrEqual(1);
    const task = report.suggestedNewTasks.find((t) => t.rationale.includes('Competitive gap'));
    expect(task).toBeDefined();
    expect(task!.suggestedPriority).toBe('high');
  });

  it('report has correct shape', async () => {
    const db = makeMockDb({});
    const embedder = makeMockEmbedder();

    const report = await crossRefResearchToWorkstreams(db, embedder);

    expect(report).toHaveProperty('synthesisNotesScanned');
    expect(report).toHaveProperty('tasksScanned');
    expect(report).toHaveProperty('workstreamsScanned');
    expect(Array.isArray(report.suggestedNewTasks)).toBe(true);
    expect(Array.isArray(report.taskUpdates)).toBe(true);
    expect(Array.isArray(report.priorityChanges)).toBe(true);
    expect(Array.isArray(report.errors)).toBe(true);
  });
});
