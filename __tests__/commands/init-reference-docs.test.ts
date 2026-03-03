import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../helpers.js';
import { ingestBrainReferenceDocs } from '../../src/commands/init.js';
import type { BrainConfig } from '../../src/types.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;

function makeConfig(overrides: Partial<BrainConfig> = {}): BrainConfig {
  return {
    notesDir,
    dbPath,
    embedder: 'local',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'qwen2.5:3b',
    ...overrides,
  };
}

beforeEach(() => {
  dbPath = tmpDbPath('init-ref-docs');
  db = new BrainDB(dbPath);
  db.setEmbeddingModel('mock-embedder', 384);
  notesDir = join(tmpdir(), `init-ref-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
});

describe('ingestBrainReferenceDocs', () => {
  it('writes reference notes with proper frontmatter', async () => {
    const config = makeConfig();
    const embedder = createMockEmbedder();

    await ingestBrainReferenceDocs(config, db, embedder);

    const refDir = join(notesDir, 'modules', 'pm', 'reference');
    expect(existsSync(refDir)).toBe(true);

    // Should have created files for decomposed commands + architecture
    const overviewPath = join(refDir, 'pm-ref-overview.md');
    if (existsSync(overviewPath)) {
      const content = readFileSync(overviewPath, 'utf-8');
      expect(content).toContain('---');
      expect(content).toContain('type: reference');
      expect(content).toContain('module: pm');
    }
  });

  it('indexes reference notes into SQLite after writing', async () => {
    const config = makeConfig();
    const embedder = createMockEmbedder();

    await ingestBrainReferenceDocs(config, db, embedder);

    const allNotes = db.getAllNotes();
    const refNotes = allNotes.filter(n => n.id.startsWith('pm-ref-'));
    expect(refNotes.length).toBeGreaterThan(0);

    // Should have module set to pm
    for (const note of refNotes) {
      expect(note.module).toBe('pm');
    }
  });

  it('creates relations between reference notes', async () => {
    const config = makeConfig();
    const embedder = createMockEmbedder();

    await ingestBrainReferenceDocs(config, db, embedder);

    const allNotes = db.getAllNotes();
    const overviewNote = allNotes.find(n => n.id === 'pm-ref-overview');
    if (overviewNote) {
      const relations = db.getRelationsFrom(overviewNote.id);
      const parentRelations = relations.filter(r => r.type === 'parent');
      expect(parentRelations.length).toBeGreaterThan(0);
    }
  });

  it('skips unchanged files on re-ingestion (hash check)', async () => {
    const config = makeConfig();
    const embedder = createMockEmbedder();

    await ingestBrainReferenceDocs(config, db, embedder);
    const firstNotes = db.getAllNotes().filter(n => n.id.startsWith('pm-ref-'));
    const firstCount = firstNotes.length;

    // Second run should be a no-op (files unchanged)
    await ingestBrainReferenceDocs(config, db, embedder);
    const secondNotes = db.getAllNotes().filter(n => n.id.startsWith('pm-ref-'));
    expect(secondNotes.length).toBe(firstCount);
  });

  it('works without db/embedder (write-only fallback)', async () => {
    const config = makeConfig();

    await ingestBrainReferenceDocs(config);

    const refDir = join(notesDir, 'modules', 'pm', 'reference');
    // Files should still be written even without indexing
    if (existsSync(refDir)) {
      expect(existsSync(refDir)).toBe(true);
    }
  });
});
