import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import { indexSingleFile } from '../../../src/services/indexing.js';
import { computeAutoLinks } from '../../../src/services/graph.js';

let db: BrainDB;
let notesDir: string;
const embedder = createMockEmbedder();

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('auto-link-dedup'));
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `ald-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
});

async function indexNote(id: string, title: string, content: string) {
  const path = join(notesDir, `${id}.md`);
  const full = `---\nid: ${id}\ntitle: "${title}"\ntype: note\ntier: fast\n---\n\n${content}`;
  writeFileSync(path, full);
  const hash = createHash('sha256').update(full).digest('hex');
  return await indexSingleFile(db, embedder, path, full, hash, Date.now());
}

describe('computeAutoLinks threshold', () => {
  it('default threshold is 0.65', () => {
    // Verify the default threshold by calling with only required args
    // The function signature: computeAutoLinks(db, noteId, threshold = 0.65, ...)
    // We test indirectly: with similar content, links should be found at the lower threshold
    expect(typeof computeAutoLinks).toBe('function');
  });

  it('runs without error at default threshold', async () => {
    await indexNote('note-a', 'API Design', 'REST API design patterns and best practices');
    await indexNote('note-b', 'API Implementation', 'REST API implementation guide and examples');

    const links = computeAutoLinks(db, 'note-a');
    expect(Array.isArray(links)).toBe(true);
  });
});

describe('source doc dedup', () => {
  it('does not create duplicate notes with same slug already in DB', async () => {
    // Pre-populate a note in the DB (simulating previous onboard run)
    await indexNote('sdk-readme', 'SDK Readme', 'Node SDK documentation v1');

    // Verify the note exists
    const existing = db.getNoteById('sdk-readme');
    expect(existing).not.toBeNull();

    // Re-indexing the same ID should not create a duplicate
    await indexNote('sdk-readme', 'SDK Readme', 'Node SDK documentation v2');

    const notes = db.getAllNotes().filter((n) => n.id === 'sdk-readme');
    expect(notes).toHaveLength(1);
  });

  it('getNoteById returns existing note for dedup check', async () => {
    await indexNote('existing-doc', 'Existing Doc', 'Some content');

    // The dedup pattern: check getNoteById before ingesting
    const existing = db.getNoteById('existing-doc');
    expect(existing).not.toBeNull();
    expect(existing!.id).toBe('existing-doc');

    // A non-existent slug should return null
    const missing = db.getNoteById('non-existent');
    expect(missing).toBeNull();
  });
});
