import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'node:fs';
import { parseMarkdown } from '../../src/services/markdown-parser.js';
import { frontmatterToRecord, indexSingleFile } from '../../src/services/indexing.js';
import { createMockEmbedder, createTestDb } from '../helpers.js';
import type { BrainDB } from '../../src/services/brain-db.js';

describe('reason field', () => {
  let db: BrainDB;
  let dbPath: string;

  beforeEach(() => {
    ({ db, dbPath } = createTestDb());
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  it('parses reason from frontmatter', () => {
    const md = [
      '---',
      'id: reason-test',
      'title: Reason Test',
      'type: note',
      'tier: fast',
      'reason: "Captures key architecture decisions"',
      '---',
      '',
      'Some content.',
    ].join('\n');

    const parsed = parseMarkdown('reason-test.md', md);
    expect(parsed.frontmatter.reason).toBe('Captures key architecture decisions');
  });

  it('includes reason in NoteRecord metadata via frontmatterToRecord', () => {
    const md = [
      '---',
      'id: reason-record',
      'title: Reason Record',
      'type: note',
      'tier: fast',
      'reason: "Important for onboarding"',
      '---',
      '',
      'Content here.',
    ].join('\n');

    const parsed = parseMarkdown('reason-record.md', md);
    const record = frontmatterToRecord(parsed);
    const meta = JSON.parse(record.metadata ?? '{}');
    expect(meta.reason).toBe('Important for onboarding');
  });

  it('prepends reason to FTS content during indexing', async () => {
    const md = [
      '---',
      'id: reason-fts',
      'title: Reason FTS',
      'type: note',
      'tier: fast',
      'reason: "Reference for API design patterns"',
      '---',
      '',
      'Body text about APIs.',
    ].join('\n');

    const embedder = createMockEmbedder();
    await indexSingleFile(db, embedder, 'reason-fts.md', md, 'abc123', Date.now());

    const results = db.searchFTS('API design patterns', 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].noteId).toBe('reason-fts');
  });

  it('indexes normally when reason is absent', async () => {
    const md = [
      '---',
      'id: no-reason',
      'title: No Reason',
      'type: note',
      'tier: fast',
      '---',
      '',
      'Plain content without reason.',
    ].join('\n');

    const embedder = createMockEmbedder();
    await indexSingleFile(db, embedder, 'no-reason.md', md, 'def456', Date.now());

    const results = db.searchFTS('Plain content without reason', 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].noteId).toBe('no-reason');
  });
});
