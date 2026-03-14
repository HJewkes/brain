import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'node:fs';
import { BrainDB } from '../../src/services/brain-db.js';
import { parseBrainUri, buildBrainUri, resolveBrainUri } from '../../src/services/brain-uri.js';

import { createTestDb, makeNote, makeMemoryEntry } from '../helpers.js';

describe('parseBrainUri', () => {
  it('parses a note URI', () => {
    const result = parseBrainUri('brain://notes/abc-123');
    expect(result).toEqual({
      scheme: 'brain',
      type: 'notes',
      id: 'abc-123',
    });
  });

  it('parses a note URI with heading fragment', () => {
    const result = parseBrainUri('brain://notes/abc-123#introduction');
    expect(result).toEqual({
      scheme: 'brain',
      type: 'notes',
      id: 'abc-123',
      fragment: 'introduction',
    });
  });

  it('parses a memory URI', () => {
    const result = parseBrainUri('brain://memories/mem-xyz');
    expect(result).toEqual({
      scheme: 'brain',
      type: 'memories',
      id: 'mem-xyz',
    });
  });

  it('parses a search URI with query params', () => {
    const result = parseBrainUri('brain://search?q=typescript%20patterns');
    expect(result).toEqual({
      scheme: 'brain',
      type: 'search',
      id: '',
      query: { q: 'typescript patterns' },
    });
  });

  it('parses a task URI', () => {
    const result = parseBrainUri('brain://tasks/VNM-05.13');
    expect(result).toEqual({
      scheme: 'brain',
      type: 'tasks',
      id: 'VNM-05.13',
    });
  });

  it('parses a workstream URI', () => {
    const result = parseBrainUri('brain://workstreams/VNM-05');
    expect(result).toEqual({
      scheme: 'brain',
      type: 'workstreams',
      id: 'VNM-05',
    });
  });

  it('throws on non-brain scheme', () => {
    expect(() => parseBrainUri('http://notes/abc')).toThrow('must start with "brain://"');
  });

  it('throws on missing resource type', () => {
    expect(() => parseBrainUri('brain://')).toThrow('missing resource type');
  });

  it('throws on invalid resource type', () => {
    expect(() => parseBrainUri('brain://invalid/abc')).toThrow('Invalid brain URI type "invalid"');
  });

  it('throws on missing id for non-search type', () => {
    expect(() => parseBrainUri('brain://notes')).toThrow('missing resource id');
  });

  it('allows search without id', () => {
    const result = parseBrainUri('brain://search?q=test');
    expect(result.type).toBe('search');
    expect(result.id).toBe('');
  });

  it('parses search with multiple query params', () => {
    const result = parseBrainUri('brain://search?q=test&limit=10&tier=slow');
    expect(result.query).toEqual({
      q: 'test',
      limit: '10',
      tier: 'slow',
    });
  });
});

describe('buildBrainUri', () => {
  it('builds a note URI', () => {
    expect(buildBrainUri('notes', 'abc-123')).toBe('brain://notes/abc-123');
  });

  it('builds a note URI with fragment', () => {
    expect(buildBrainUri('notes', 'abc-123', { fragment: 'setup' })).toBe(
      'brain://notes/abc-123#setup'
    );
  });

  it('builds a memory URI', () => {
    expect(buildBrainUri('memories', 'mem-1')).toBe('brain://memories/mem-1');
  });

  it('builds a search URI with query', () => {
    expect(buildBrainUri('search', '', { query: { q: 'hello world' } })).toBe(
      'brain://search?q=hello%20world'
    );
  });

  it('builds a task URI', () => {
    expect(buildBrainUri('tasks', 'VNM-05.13')).toBe('brain://tasks/VNM-05.13');
  });

  it('builds a workstream URI', () => {
    expect(buildBrainUri('workstreams', 'VNM-05')).toBe('brain://workstreams/VNM-05');
  });
});

describe('round-trip: build then parse', () => {
  const cases: Array<{
    type: Parameters<typeof buildBrainUri>[0];
    id: string;
    options?: Parameters<typeof buildBrainUri>[2];
  }> = [
    { type: 'notes', id: 'my-note-id' },
    { type: 'notes', id: 'my-note-id', options: { fragment: 'heading' } },
    { type: 'memories', id: 'mem-abc' },
    { type: 'tasks', id: 'VNM-01.5' },
    { type: 'workstreams', id: 'VNM-01' },
  ];

  for (const { type, id, options } of cases) {
    const label = options ? `${type}/${id} with options` : `${type}/${id}`;

    it(`round-trips ${label}`, () => {
      const uri = buildBrainUri(type, id, options);
      const parsed = parseBrainUri(uri);
      expect(parsed.type).toBe(type);
      expect(parsed.id).toBe(id);
      if (options?.fragment) {
        expect(parsed.fragment).toBe(options.fragment);
      }
    });
  }
});

describe('resolveBrainUri', () => {
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
      /* ignore */
    }
  });

  it('resolves a note URI', () => {
    const note = makeNote({ id: 'test-note-1', title: 'Test Note' });
    db.upsertNote(note);

    const result = resolveBrainUri(db, 'brain://notes/test-note-1');
    expect(result.type).toBe('note');
    if (result.type === 'note') {
      expect(result.note.id).toBe('test-note-1');
      expect(result.note.title).toBe('Test Note');
    }
  });

  it('resolves a note URI with fragment', () => {
    const note = makeNote({ id: 'test-note-2' });
    db.upsertNote(note);

    const result = resolveBrainUri(db, 'brain://notes/test-note-2#setup');
    expect(result.type).toBe('note');
    if (result.type === 'note') {
      expect(result.note.id).toBe('test-note-2');
      expect(result.section).toBe('setup');
    }
  });

  it('throws when resolving a nonexistent note', () => {
    expect(() => resolveBrainUri(db, 'brain://notes/does-not-exist')).toThrow('Note not found');
  });

  it('resolves a memory URI', () => {
    const note = makeNote({ id: 'src-note' });
    db.upsertNote(note);
    const mem = makeMemoryEntry({
      id: 'mem-1',
      sourceNoteId: 'src-note',
    });
    db.addMemory(mem);

    const result = resolveBrainUri(db, 'brain://memories/mem-1');
    expect(result.type).toBe('memory');
    if (result.type === 'memory') {
      expect(result.memory.id).toBe('mem-1');
    }
  });

  it('throws when resolving a nonexistent memory', () => {
    expect(() => resolveBrainUri(db, 'brain://memories/no-such-mem')).toThrow('Memory not found');
  });

  it('resolves a search URI', () => {
    const result = resolveBrainUri(db, 'brain://search?q=typescript&limit=5');
    expect(result.type).toBe('search');
    if (result.type === 'search') {
      expect(result.query).toBe('typescript');
      expect(result.params).toEqual({ limit: '5' });
    }
  });

  it('throws when resolving a nonexistent task', () => {
    expect(() => resolveBrainUri(db, 'brain://tasks/VNM-99.1')).toThrow('task not found');
  });

  it('throws when resolving a nonexistent workstream', () => {
    expect(() => resolveBrainUri(db, 'brain://workstreams/VNM-99')).toThrow('workstream not found');
  });
});
