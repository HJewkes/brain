import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'node:fs';
import { extractNoteLinks } from '../../src/services/markdown-parser.js';
import { indexSingleFile } from '../../src/services/indexing.js';
import { BrainDB } from '../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb } from '../helpers.js';

describe('extractNoteLinks', () => {
  it('extracts internal markdown links', () => {
    const content = 'Check [see this](other-note) for details.';
    expect(extractNoteLinks(content)).toEqual(['other-note']);
  });

  it('skips external URLs', () => {
    const content = '[Google](https://google.com) and [HTTP](http://example.com)';
    expect(extractNoteLinks(content)).toEqual([]);
  });

  it('skips anchors', () => {
    const content = 'Jump to [section](#heading) above.';
    expect(extractNoteLinks(content)).toEqual([]);
  });

  it('strips .md extension', () => {
    const content = 'See [doc](architecture.md) for more.';
    expect(extractNoteLinks(content)).toEqual(['architecture']);
  });

  it('extracts slug from path', () => {
    const content = 'Read [doc](../docs/architecture.md) first.';
    expect(extractNoteLinks(content)).toEqual(['architecture']);
  });

  it('deduplicates links', () => {
    const content = '[a](note-one) and [b](note-one) again.';
    expect(extractNoteLinks(content)).toEqual(['note-one']);
  });

  it('skips mailto links', () => {
    const content = '[Email](mailto:test@example.com)';
    expect(extractNoteLinks(content)).toEqual([]);
  });

  it('extracts multiple distinct links', () => {
    const content = '[a](note-one) and [b](note-two) here.';
    expect(extractNoteLinks(content)).toEqual(['note-one', 'note-two']);
  });
});

describe('indexSingleFile creates related-to relations for links', () => {
  let dbPath: string;
  let db: BrainDB;
  const embedder = createMockEmbedder();

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

  it('creates related-to relations for valid links', async () => {
    const targetContent = [
      '---',
      'id: target-note',
      'title: Target Note',
      'type: note',
      'tier: slow',
      '---',
      '',
      'Target content here.',
    ].join('\n');

    const sourceContent = [
      '---',
      'id: source-note',
      'title: Source Note',
      'type: note',
      'tier: slow',
      '---',
      '',
      'See [target](target-note) for details.',
    ].join('\n');

    await indexSingleFile(
      db,
      embedder,
      '/notes/target-note.md',
      targetContent,
      'hash1',
      Date.now()
    );
    await indexSingleFile(
      db,
      embedder,
      '/notes/source-note.md',
      sourceContent,
      'hash2',
      Date.now()
    );

    const relations = db.getRelationsFrom('source-note');
    const relatedTo = relations.filter(
      (r) => r.type === 'related-to' && r.sourceId === 'source-note' && r.targetId === 'target-note'
    );
    expect(relatedTo.length).toBe(1);
  });

  it('skips links to non-existent notes', async () => {
    const content = [
      '---',
      'id: lonely-note',
      'title: Lonely Note',
      'type: note',
      'tier: slow',
      '---',
      '',
      'Links to [missing](nonexistent-note) which does not exist.',
    ].join('\n');

    await indexSingleFile(db, embedder, '/notes/lonely-note.md', content, 'hash1', Date.now());

    const relations = db.getRelationsFrom('lonely-note');
    const linkRelations = relations.filter(
      (r) => r.type === 'related-to' && r.targetId === 'nonexistent-note'
    );
    expect(linkRelations.length).toBe(0);
  });
});
