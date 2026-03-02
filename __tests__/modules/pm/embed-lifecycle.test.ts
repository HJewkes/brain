import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath } from '../../helpers.js';

let db: BrainDB;

beforeEach(() => {
  db = new BrainDB(tmpDbPath('embed-lifecycle'));
});

afterEach(() => {
  db.close();
});

describe('embed_status generated columns', () => {
  it('notes table has embed_status generated column', () => {
    const info = (db as any).db.prepare("PRAGMA table_xinfo(notes)").all();
    const col = info.find((c: any) => c.name === 'embed_status');
    expect(col).toBeDefined();
    expect(col.type).toBe('TEXT');
  });

  it('notes table has activity_type generated column', () => {
    const info = (db as any).db.prepare("PRAGMA table_xinfo(notes)").all();
    const col = info.find((c: any) => c.name === 'activity_type');
    expect(col).toBeDefined();
    expect(col.type).toBe('TEXT');
  });

  it('generated column reflects metadata JSON', () => {
    const metadata = JSON.stringify({ embed_status: 'queued', activity_type: 'complete' });
    (db as any).db.prepare(
      "INSERT INTO notes (id, file_path, title, type, tier, metadata) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('test-note', '/tmp/test.md', 'Test', 'task', 'slow', metadata);

    const row = (db as any).db.prepare("SELECT embed_status, activity_type FROM notes WHERE id = ?").get('test-note');
    expect(row.embed_status).toBe('queued');
    expect(row.activity_type).toBe('complete');
  });

  it('idx_notes_embed_status index exists', () => {
    const indexes = (db as any).db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_notes_embed_status'").all();
    expect(indexes.length).toBe(1);
  });

  it('idx_notes_activity_type index exists', () => {
    const indexes = (db as any).db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_notes_activity_type'").all();
    expect(indexes.length).toBe(1);
  });
});
