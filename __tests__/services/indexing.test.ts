import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'node:fs';
import { BrainDB } from '../../src/services/brain-db.js';
import {
  slugify,
  frontmatterToRecord,
  rawChunksToChunks,
  chunkId,
  inboxItemToMarkdown,
  indexSingleFile,
} from '../../src/services/indexing.js';
import { parseMarkdown } from '../../src/services/markdown-parser.js';
import { createMockEmbedder, makeInboxItem, createTestDb } from '../helpers.js';
import type { RawChunk } from '../../src/types.js';

describe('slugify', () => {
  it('lowercases and replaces non-alphanumeric with hyphens', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello');
  });

  it('collapses multiple separators', () => {
    expect(slugify('a   b___c')).toBe('a-b-c');
  });

  it('returns empty string for non-alphanumeric input', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('chunkId', () => {
  it('produces deterministic id from noteId + content', () => {
    const id1 = chunkId('note-1', 'some content');
    const id2 = chunkId('note-1', 'some content');
    expect(id1).toBe(id2);
  });

  it('produces different ids for different content', () => {
    const id1 = chunkId('note-1', 'content a');
    const id2 = chunkId('note-1', 'content b');
    expect(id1).not.toBe(id2);
  });

  it('includes noteId prefix', () => {
    const id = chunkId('my-note', 'data');
    expect(id).toMatch(/^my-note::/);
  });
});

describe('frontmatterToRecord', () => {
  it('converts parsed markdown frontmatter to NoteRecord', () => {
    const markdown = [
      '---',
      'id: test-note',
      'title: Test Note',
      'type: note',
      'tier: slow',
      'category: dev',
      'tags: [typescript, testing]',
      'summary: A test note',
      'confidence: high',
      'status: current',
      'created: 2026-01-15',
      'modified: 2026-02-01',
      'last-reviewed: 2026-01-20',
      'review-interval: 90d',
      '---',
      '',
      '## Content',
      '',
      'Some text here.',
    ].join('\n');

    const parsed = parseMarkdown('/notes/test-note.md', markdown);
    const record = frontmatterToRecord(parsed);

    expect(record.id).toBe('test-note');
    expect(record.title).toBe('Test Note');
    expect(record.type).toBe('note');
    expect(record.tier).toBe('slow');
    expect(record.category).toBe('dev');
    expect(record.tags).toBe('typescript,testing');
    expect(record.summary).toBe('A test note');
    expect(record.confidence).toBe('high');
    expect(record.status).toBe('current');
    expect(record.createdAt).toContain('2026-01-15');
    expect(record.modifiedAt).toContain('2026-02-01');
    expect(record.lastReviewed).toContain('2026-01-20');
    expect(record.reviewInterval).toBe('90d');
  });

  it('handles missing optional fields', () => {
    const markdown = [
      '---',
      'id: minimal',
      'title: Minimal',
      'type: note',
      'tier: fast',
      '---',
      '',
      'Content.',
    ].join('\n');

    const parsed = parseMarkdown('/notes/minimal.md', markdown);
    const record = frontmatterToRecord(parsed);

    expect(record.id).toBe('minimal');
    expect(record.category).toBeNull();
    expect(record.tags).toBeNull();
    expect(record.summary).toBeNull();
    expect(record.confidence).toBeNull();
    expect(record.status).toBe('current');
  });

  it('frontmatterToRecord stores raw frontmatter as metadata for non-module notes', () => {
    const parsed = {
      id: 'test-note',
      filePath: '/tmp/test.md',
      frontmatter: {
        title: 'Test Note',
        type: 'insight' as const,
        tier: 'fast' as const,
      },
      rawFrontmatter: {
        title: 'Test Note',
        type: 'insight',
        tier: 'fast',
        'architecture-layer': [1, 3],
        'enforcement-strength': 'deterministic',
      },
      chunks: [],
      links: [],
    };

    const record = frontmatterToRecord(parsed);
    expect(record.metadata).not.toBeNull();
    const meta = JSON.parse(record.metadata!);
    expect(meta['architecture-layer']).toEqual([1, 3]);
    expect(meta['enforcement-strength']).toBe('deterministic');
  });
});

describe('rawChunksToChunks', () => {
  it('converts RawChunks to Chunks with generated ids', () => {
    const rawChunks: RawChunk[] = [
      {
        heading: 'Introduction',
        headingAncestry: null,
        text: 'This is the intro section.',
        tokenCount: 5,
        chunkType: 'section',
        cutType: 'heading_boundary',
        position: 0,
      },
      {
        heading: 'Details',
        headingAncestry: 'Introduction',
        text: 'These are the details.',
        tokenCount: 4,
        chunkType: 'section',
        cutType: 'heading_boundary',
        position: 1,
      },
    ];

    const chunks = rawChunksToChunks('my-note', rawChunks);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].noteId).toBe('my-note');
    expect(chunks[0].heading).toBe('Introduction');
    expect(chunks[0].content).toBe('This is the intro section.');
    expect(chunks[0].position).toBe(0);
    expect(chunks[0].id).toMatch(/^my-note::/);

    expect(chunks[1].heading).toBe('Details');
    expect(chunks[1].headingAncestry).toBe('Introduction');
    expect(chunks[1].position).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(rawChunksToChunks('note', [])).toEqual([]);
  });
});

describe('inboxItemToMarkdown', () => {
  it('generates markdown with frontmatter from inbox item', () => {
    const item = makeInboxItem({
      title: 'Quick thought',
      content: 'Remember to refactor the auth module.',
    });

    const md = inboxItemToMarkdown(item);

    expect(md).toContain('title: "Quick thought"');
    expect(md).toContain('type: note');
    expect(md).toContain('tier: fast');
    expect(md).toContain('Remember to refactor the auth module.');
  });

  it('produces sources frontmatter when sourceUrl is present', () => {
    const item = makeInboxItem({
      content: 'Interesting article',
      sourceUrl: 'https://example.com/article',
    });

    const md = inboxItemToMarkdown(item);

    expect(md).toContain('sources:');
    expect(md).toContain('url: "https://example.com/article"');
    expect(md).toContain('type: "web"');
    expect(md).not.toContain('Source: https://example.com/article');
  });

  it('omits sources frontmatter when no sourceUrl', () => {
    const item = makeInboxItem({
      content: 'Just a note',
      title: 'Plain Item',
      sourceUrl: null,
    });

    const md = inboxItemToMarkdown(item);

    expect(md).not.toContain('sources:');
    expect(md).not.toContain('Source:');
  });

  it('uses item id prefix when title is null', () => {
    const item = makeInboxItem({ title: null });
    const md = inboxItemToMarkdown(item);
    expect(md).toContain('title: "Inbox capture"');
  });
});

describe('indexSingleFile', () => {
  let db: BrainDB;
  let dbPath: string;

  beforeEach(() => {
    ({ dbPath, db } = createTestDb());
    db.ensureVectorTable(384);
    db.setEmbeddingModel('mock-embedder', 384);
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  it('indexes a file and creates note, FTS, chunks, and file record', async () => {
    const embedder = createMockEmbedder();
    const content = [
      '---',
      'id: idx-test',
      'title: Index Test',
      'type: note',
      'tier: slow',
      '---',
      '',
      '## Section One',
      '',
      'Some content about TypeScript patterns.',
      '',
      '## Section Two',
      '',
      'More content about React hooks.',
    ].join('\n');

    const noteId = await indexSingleFile(
      db,
      embedder,
      '/notes/idx-test.md',
      content,
      'hash123',
      Date.now()
    );

    expect(noteId).toBe('idx-test');

    const note = db.getNoteById('idx-test');
    expect(note).not.toBeNull();
    expect(note!.title).toBe('Index Test');

    const chunks = db.getChunksForNote('idx-test');
    expect(chunks.length).toBeGreaterThanOrEqual(1);

    const file = db.getFile('/notes/idx-test.md');
    expect(file).not.toBeNull();
    expect(file!.hash).toBe('hash123');

    const ftsResults = db.searchFTS('TypeScript patterns', 5);
    expect(ftsResults.some((r) => r.noteId === 'idx-test')).toBe(true);
  });

  it('handles file with no sections gracefully', async () => {
    const embedder = createMockEmbedder();
    const content = [
      '---',
      'id: no-sections',
      'title: No Sections',
      'type: note',
      'tier: fast',
      '---',
      '',
      'Just a paragraph with no headings.',
    ].join('\n');

    const noteId = await indexSingleFile(
      db,
      embedder,
      '/notes/no-sections.md',
      content,
      'hash456',
      Date.now()
    );

    expect(noteId).toBe('no-sections');
    expect(db.getNoteById('no-sections')).not.toBeNull();
  });
});
