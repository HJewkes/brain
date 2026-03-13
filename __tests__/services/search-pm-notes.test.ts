import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'node:fs';
import { BrainDB } from '../../src/services/brain-db.js';
import { search } from '../../src/services/search.js';
import { ModuleRegistry } from '../../src/modules/registry.js';
import { createMockEmbedder, makeNote, createTestDb } from '../helpers.js';
import type { Chunk, Embedder } from '../../src/types.js';

describe('PM notes in search', () => {
  let db: BrainDB;
  let dbPath: string;
  let embedder: Embedder;
  let registry: ModuleRegistry;

  beforeEach(() => {
    ({ dbPath, db } = createTestDb());
    embedder = createMockEmbedder();
    registry = new ModuleRegistry();
    registry.registerFilter('pm', { visibility: 'private' });

    db.upsertNote(
      makeNote({
        id: 'kb-note',
        filePath: '/notes/kb.md',
        title: 'Authentication patterns in Node.js',
        tier: 'slow',
        summary: 'JWT tokens, OAuth2, session-based auth',
        modifiedAt: new Date().toISOString(),
      })
    );
    db.upsertNoteFTS(
      'kb-note',
      'Authentication patterns in Node.js',
      'JWT tokens, OAuth2, session-based auth',
      'JWT tokens, OAuth2, session-based auth.'
    );

    db.upsertNote(
      makeNote({
        id: 'pm-task',
        filePath: '/notes/pm/auth-task.md',
        title: 'Build authentication module',
        tier: 'slow',
        summary: 'Implement JWT-based authentication',
        module: 'pm',
        modifiedAt: new Date().toISOString(),
      })
    );
    db.upsertNoteFTS(
      'pm-task',
      'Build authentication module',
      'Implement JWT-based authentication',
      'Implement JWT-based authentication.'
    );

    const chunkData = [
      { id: 'kb-note', content: 'JWT tokens, OAuth2, session-based auth.' },
      { id: 'pm-task', content: 'Implement JWT-based authentication.' },
    ];

    for (const { id, content } of chunkData) {
      const chunk: Chunk = {
        id: `${id}:chunk:0`,
        noteId: id,
        heading: null,
        headingAncestry: null,
        content,
        tokenCount: content.split(/\s+/).length,
        chunkType: 'section',
        cutType: 'heading_boundary',
        position: 0,
      };

      const vec = new Array<number>(384).fill(0);
      for (let i = 0; i < content.length; i++) {
        vec[i % 384] += content.charCodeAt(i) / 1000;
      }
      const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
      if (magnitude > 0) {
        for (let i = 0; i < vec.length; i++) {
          vec[i] /= magnitude;
        }
      }
      db.upsertChunks(id, [chunk], [new Float32Array(vec)]);
    }
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it('default search includes PM notes', async () => {
    const results = await search(
      db,
      embedder,
      'authentication',
      { limit: 10 },
      { bm25: 0.5, vector: 0.5 },
      registry
    );

    const noteIds = results.map((r) => r.noteId);
    expect(noteIds).toContain('kb-note');
    expect(noteIds).toContain('pm-task');
  });

  it('excludePm option filters out PM notes', async () => {
    const results = await search(
      db,
      embedder,
      'authentication',
      { limit: 10, excludePm: true },
      { bm25: 0.5, vector: 0.5 },
      registry
    );

    const noteIds = results.map((r) => r.noteId);
    expect(noteIds).toContain('kb-note');
    expect(noteIds).not.toContain('pm-task');
  });

  it('includePm false acts as excludePm for backward compat', async () => {
    const results = await search(
      db,
      embedder,
      'authentication',
      { limit: 10, includePm: false },
      { bm25: 0.5, vector: 0.5 },
      registry
    );

    const noteIds = results.map((r) => r.noteId);
    expect(noteIds).toContain('kb-note');
    expect(noteIds).not.toContain('pm-task');
  });

  it('includePm true still works', async () => {
    const results = await search(
      db,
      embedder,
      'authentication',
      { limit: 10, includePm: true },
      { bm25: 0.5, vector: 0.5 },
      registry
    );

    const noteIds = results.map((r) => r.noteId);
    expect(noteIds).toContain('kb-note');
    expect(noteIds).toContain('pm-task');
  });

  it('includes PM notes when no moduleRegistry is provided', async () => {
    const results = await search(db, embedder, 'authentication', { limit: 10 });

    const noteIds = results.map((r) => r.noteId);
    expect(noteIds).toContain('pm-task');
  });
});
