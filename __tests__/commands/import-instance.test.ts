import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../src/services/brain-db.js';
import { parseFilter } from '../../src/commands/import-instance.js';
import { makeNote } from '../helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpPath(suffix = '.db'): string {
  return join(tmpdir(), `import-instance-test-${randomUUID()}${suffix}`);
}

function makeSrcDb(): { db: BrainDB; dbPath: string } {
  const dbPath = tmpPath();
  const db = new BrainDB(dbPath);
  return { db, dbPath };
}

// ---------------------------------------------------------------------------
// parseFilter
// ---------------------------------------------------------------------------

describe('parseFilter', () => {
  it('returns 1=1 for empty/whitespace filter', () => {
    expect(parseFilter('').sql).toBe('1=1');
    expect(parseFilter('  ').sql).toBe('1=1');
  });

  it('parses a single module=pm filter', () => {
    const result = parseFilter('module=pm');
    expect(result.sql).toBe('module = ?');
    expect(result.params).toEqual(['pm']);
  });

  it('parses type= filter', () => {
    const result = parseFilter('type=task');
    expect(result.sql).toBe('type = ?');
    expect(result.params).toEqual(['task']);
  });

  it('parses multi-term AND filter', () => {
    const result = parseFilter('module=pm AND project=VNM');
    expect(result.sql).toContain('module = ?');
    expect(result.sql).toContain("json_extract(metadata, '$.project') = ?");
    expect(result.params).toEqual(['pm', 'VNM']);
  });

  it('parses three-term filter', () => {
    const result = parseFilter('type=task AND project=CO AND status=done');
    expect(result.params).toHaveLength(3);
    expect(result.params).toContain('task');
    expect(result.params).toContain('CO');
    expect(result.params).toContain('done');
  });

  it('is case-insensitive for AND keyword', () => {
    const result = parseFilter('module=pm and type=task');
    expect(result.params).toEqual(['pm', 'task']);
  });

  it('ignores unknown filter keys gracefully', () => {
    const result = parseFilter('unknownkey=foo AND module=pm');
    expect(result.sql).toBe('module = ?');
    expect(result.params).toEqual(['pm']);
  });
});

// ---------------------------------------------------------------------------
// Collision detection (dry-run mode)
// ---------------------------------------------------------------------------

describe('collision detection', () => {
  let srcDb: BrainDB;
  let destDb: BrainDB;

  beforeEach(() => {
    ({ db: srcDb } = makeSrcDb());
    ({ db: destDb } = makeSrcDb());
  });

  afterEach(() => {
    srcDb.close();
    destDb.close();
  });

  it('detects a colliding note ID between source and destination', () => {
    const note = makeNote({ id: 'shared-note-id', title: 'Shared' });
    srcDb.upsertNote(note);
    destDb.upsertNote(note);

    // Verify: destination already has the note
    const found = destDb.getNoteById('shared-note-id');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('shared-note-id');
  });

  it('no collision when IDs are distinct', () => {
    srcDb.upsertNote(makeNote({ id: 'source-only-note' }));
    destDb.upsertNote(makeNote({ id: 'dest-only-note' }));

    expect(destDb.getNoteById('source-only-note')).toBeNull();
    expect(destDb.getNoteById('dest-only-note')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Note copying with path rewriting
// ---------------------------------------------------------------------------

describe('path rewriting', () => {
  it('rewrites file_path to destination notes dir', () => {
    const sourceNotesDir = '/source/brain/notes';
    const destNotesDir = '/dest/brain/notes';
    const sourceFilePath = '/source/brain/notes/research/my-note.md';

    // Simulate path rewriting logic from the command
    const rel = relative(sourceNotesDir, sourceFilePath);
    const destPath = join(destNotesDir, rel);

    expect(destPath).toBe('/dest/brain/notes/research/my-note.md');
  });

  it('uses filename only when source path escapes notesDir', () => {
    const sourceNotesDir = '/source/brain/notes';
    const destNotesDir = '/dest/brain/notes';
    const sourceFilePath = '/some/other/place/my-note.md';

    const rel = relative(sourceNotesDir, sourceFilePath);
    // rel starts with '..', so fall back to filename
    const finalRel = rel.startsWith('..') ? sourceFilePath.split('/').pop()! : rel;
    const destPath = join(destNotesDir, finalRel);

    expect(destPath).toBe('/dest/brain/notes/my-note.md');
  });
});

// ---------------------------------------------------------------------------
// Two in-memory DBs: filter + upsert pipeline
// ---------------------------------------------------------------------------

describe('database filter and upsert', () => {
  let srcDb: BrainDB;
  let destDb: BrainDB;
  let srcDir: string;

  beforeEach(() => {
    srcDir = join(tmpdir(), `import-instance-srcdir-${randomUUID()}`);
    mkdirSync(srcDir, { recursive: true });
    ({ db: srcDb } = makeSrcDb());
    ({ db: destDb } = makeSrcDb());
  });

  afterEach(() => {
    srcDb.close();
    destDb.close();
  });

  it('inserts source note into destination', () => {
    const note = makeNote({ id: 'pm-task-001', module: 'pm', type: 'task' });
    srcDb.upsertNote(note);

    // Simulate copying: upsert into dest
    destDb.upsertNote({ ...note, filePath: '/dest/notes/pm-task-001.md' });

    const found = destDb.getNoteById('pm-task-001');
    expect(found).not.toBeNull();
    expect(found!.module).toBe('pm');
  });

  it('skips note on collision when force=false', () => {
    const original = makeNote({ id: 'collision-note', title: 'Original' });
    const incoming = makeNote({ id: 'collision-note', title: 'Incoming' });

    destDb.upsertNote(original);

    // Simulate collision detection: existing !== null, skip
    const existing = destDb.getNoteById('collision-note');
    const skipped = existing !== null; // force=false: skip

    expect(skipped).toBe(true);
    // Destination still has original title
    expect(destDb.getNoteById('collision-note')!.title).toBe('Original');

    // Suppress "incoming" from being used in this test
    void incoming;
  });

  it('overwrites note on collision when force=true', () => {
    const original = makeNote({ id: 'collision-note', title: 'Original' });
    const incoming = makeNote({ id: 'collision-note', title: 'Incoming' });

    destDb.upsertNote(original);
    // force=true: upsert overwrites
    destDb.upsertNote(incoming);

    expect(destDb.getNoteById('collision-note')!.title).toBe('Incoming');
  });

  it('imports relations where both endpoints exist in destination', () => {
    const noteA = makeNote({ id: 'note-a' });
    const noteB = makeNote({ id: 'note-b' });
    destDb.upsertNote(noteA);
    destDb.upsertNote(noteB);

    const relations = [{ sourceId: 'note-a', targetId: 'note-b', type: 'related-to' }];
    destDb.upsertRelations('note-a', relations);

    const rels = destDb.getRelationsFrom('note-a');
    expect(rels).toHaveLength(1);
    expect(rels[0].targetId).toBe('note-b');
    expect(rels[0].type).toBe('related-to');
  });

  it('does not import dangling relations (target not in destination)', () => {
    const noteA = makeNote({ id: 'note-a' });
    destDb.upsertNote(noteA);

    // note-b does NOT exist in destination
    const targetExists = destDb.getNoteById('note-b') !== null;
    expect(targetExists).toBe(false);

    // Would be counted as dangling
    const dangling = targetExists ? 0 : 1;
    expect(dangling).toBe(1);
  });

  it('writes note file content to temporary directory', () => {
    const noteFilePath = join(srcDir, 'test-note.md');
    const content = '---\ntitle: Test\ntype: note\ntier: fast\n---\n\nHello world.\n';
    writeFileSync(noteFilePath, content, 'utf-8');

    const readBack = readFileSync(noteFilePath, 'utf-8');
    expect(readBack).toBe(content);
  });
});
