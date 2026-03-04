import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath } from '../../helpers.js';

let db: BrainDB;

function rawDb(): Database.Database {
  return (db as unknown as { db: Database.Database }).db;
}

beforeEach(() => {
  db = new BrainDB(tmpDbPath('embed-lifecycle'));
});

afterEach(() => {
  db.close();
});

describe('embed_status generated columns', () => {
  it('notes table has embed_status generated column', () => {
    const info = rawDb().prepare("PRAGMA table_xinfo(notes)").all() as Array<{ name: string; type: string }>;
    const col = info.find((c) => c.name === 'embed_status');
    expect(col).toBeDefined();
    expect(col!.type).toBe('TEXT');
  });

  it('notes table has activity_type generated column', () => {
    const info = rawDb().prepare("PRAGMA table_xinfo(notes)").all() as Array<{ name: string; type: string }>;
    const col = info.find((c) => c.name === 'activity_type');
    expect(col).toBeDefined();
    expect(col!.type).toBe('TEXT');
  });

  it('generated column reflects metadata JSON', () => {
    const metadata = JSON.stringify({ embed_status: 'queued', activity_type: 'complete' });
    rawDb().prepare(
      "INSERT INTO notes (id, file_path, title, type, tier, metadata) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('test-note', '/tmp/test.md', 'Test', 'task', 'slow', metadata);

    const row = rawDb().prepare("SELECT embed_status, activity_type FROM notes WHERE id = ?").get('test-note') as { embed_status: string; activity_type: string };
    expect(row.embed_status).toBe('queued');
    expect(row.activity_type).toBe('complete');
  });

  it('idx_notes_embed_status index exists', () => {
    const indexes = rawDb().prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_notes_embed_status'").all() as Array<{ name: string }>;
    expect(indexes.length).toBe(1);
  });

  it('idx_notes_activity_type index exists', () => {
    const indexes = rawDb().prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_notes_activity_type'").all() as Array<{ name: string }>;
    expect(indexes.length).toBe(1);
  });
});
