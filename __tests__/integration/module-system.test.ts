import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

import { BrainDB } from '../../src/services/brain-db.js';
import { indexSingleFile } from '../../src/services/indexing.js';
import { search } from '../../src/services/search.js';
import { loadModules, runModuleMigrations } from '../../src/modules/loader.js';
import { validateNoteFrontmatter } from '../../src/modules/validation.js';
import {
  readIndexableContent,
  archiveContentDir,
  deleteContentDir,
} from '../../src/services/content-dir.js';
import { tmpDbPath, createMockEmbedder, makeNote, createTestDb } from '../helpers.js';
import { widgetModule } from '../fixtures/widget-module.js';
import type { ModuleRegistry } from '../../src/modules/registry.js';

function tmpDir(prefix = 'brain-integ'): string {
  const dir = join(tmpdir(), `${prefix}-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeNote(
  dir: string,
  filename: string,
  frontmatter: Record<string, string>,
  body = ''
): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(frontmatter)) {
    lines.push(`${k}: ${v}`);
  }
  lines.push('---', '', body);
  const content = lines.join('\n');
  const filePath = join(dir, filename);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function hashOf(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// --- V1: Module Registration and Indexing ---

describe('V1: Module Registration and Indexing', () => {
  let db: BrainDB;
  let registry: ModuleRegistry;
  let notesDir: string;
  const embedder = createMockEmbedder();

  beforeEach(async () => {
    ({ db } = createTestDb());
    db.setEmbeddingModel(embedder.model, embedder.dimensions);
    notesDir = tmpDir();
    const result = await loadModules({ modules: [widgetModule] });
    registry = result.registry;
  });

  afterEach(() => {
    db.close();
  });

  it('module registers correctly', () => {
    expect(registry.getModule('widget')).toBeDefined();
    expect(registry.getNoteType('widget')).toBeDefined();
    expect(registry.getNoteType('widget')!.schema).toBeDefined();
    expect(registry.getRelationType('depends-on')).toBeDefined();
    expect(registry.getRelationType('depends-on')!.inverse).toBe('blocks');
    expect(registry.getFilterForModule('widget')).toBeDefined();
    expect(registry.getFilterForModule('widget')!.visibility).toBe('private');
    expect(registry.getExtractionStrategy('widget')).toBeDefined();
  });

  it('module note preserves custom type', async () => {
    const filePath = writeNote(
      notesDir,
      'gadget-1.md',
      {
        id: 'gadget-1',
        title: '"Test Gadget"',
        module: 'widget',
        type: 'gadget',
        tier: 'slow',
        priority: 'high',
      },
      'Gadget body text'
    );

    const content = readFileSync(filePath, 'utf-8');
    await indexSingleFile(db, embedder, filePath, content, hashOf(content), Date.now());

    const note = db.getNoteById('gadget-1');
    expect(note).toBeDefined();
    expect(note!.type).toBe('gadget');
    expect(note!.module).toBe('widget');
    expect(note!.metadata).not.toBeNull();
    const meta = JSON.parse(note!.metadata!);
    expect(meta.module).toBe('widget');
    expect(meta.type).toBe('gadget');
  });

  it('module note populates all columns', async () => {
    const filePath = writeNote(
      notesDir,
      'full-widget.md',
      {
        id: 'full-widget',
        title: '"Full Widget"',
        module: 'widget',
        type: 'widget',
        tier: 'slow',
        priority: 'medium',
        'module-instance': 'project-alpha',
        'content-dir': '/tmp/fake-dir',
      },
      'Full widget body'
    );

    const content = readFileSync(filePath, 'utf-8');
    await indexSingleFile(db, embedder, filePath, content, hashOf(content), Date.now());

    const note = db.getNoteById('full-widget');
    expect(note).toBeDefined();
    expect(note!.moduleInstance).toBe('project-alpha');
    expect(note!.contentDir).toBe('/tmp/fake-dir');
  });

  it('schema validation catches missing required fields', () => {
    const schema = registry.getNoteType('widget')!.schema!;
    const result = validateNoteFrontmatter({ assignee: 'alice' }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'priority')).toBe(true);
  });

  it('schema validation passes valid frontmatter', () => {
    const schema = registry.getNoteType('widget')!.schema!;
    const result = validateNoteFrontmatter({ priority: 'high' }, schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('private module notes excluded from search', async () => {
    const widgetPath = writeNote(
      notesDir,
      'private-widget.md',
      {
        id: 'private-widget',
        title: '"Private Widget"',
        module: 'widget',
        type: 'widget',
        tier: 'slow',
        priority: 'low',
      },
      'Secret widget content about rockets'
    );

    const wContent = readFileSync(widgetPath, 'utf-8');
    await indexSingleFile(db, embedder, widgetPath, wContent, hashOf(wContent), Date.now());

    const regularPath = writeNote(
      notesDir,
      'regular-note.md',
      {
        id: 'regular-note',
        title: '"Regular Note"',
        type: 'note',
        tier: 'slow',
      },
      'Regular content about rockets'
    );

    const rContent = readFileSync(regularPath, 'utf-8');
    await indexSingleFile(db, embedder, regularPath, rContent, hashOf(rContent), Date.now());

    const results = await search(
      db,
      embedder,
      'rockets',
      { limit: 10 },
      { bm25: 0.3, vector: 0.7 },
      registry
    );

    const noteIds = results.map((r) => r.noteId);
    expect(noteIds).toContain('regular-note');
    expect(noteIds).not.toContain('private-widget');
  });

  it('extraction strategy respected', () => {
    const strategy = registry.getExtractionStrategy('widget');
    expect(strategy).toBeDefined();
    expect(strategy!.shouldExtract(makeNote({ module: 'widget', type: 'widget' }))).toBe(false);
  });

  it('module migration runs', () => {
    const applied = runModuleMigrations(registry, db, new Map());
    expect(applied).toEqual([{ module: 'widget', version: 1 }]);

    const rerun = runModuleMigrations(registry, db, new Map([['widget', 1]]));
    expect(rerun).toEqual([]);
  });
});

/** Minimal v6 DDL — everything BrainDB expects before the v7 migration. */
function createV6Database(dbPath: string): Database.Database {
  const raw = new Database(dbPath);
  raw.exec(`
    CREATE TABLE files (
      path TEXT PRIMARY KEY, hash TEXT NOT NULL, mtime INTEGER NOT NULL, indexed_at INTEGER NOT NULL
    );
    CREATE TABLE notes (
      id TEXT PRIMARY KEY, file_path TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
      type TEXT NOT NULL, tier TEXT NOT NULL, category TEXT, tags TEXT, summary TEXT,
      confidence TEXT, status TEXT DEFAULT 'current', sources TEXT,
      created_at TEXT, modified_at TEXT, last_reviewed TEXT, review_interval TEXT,
      expires TEXT, metadata TEXT
    );
    CREATE TABLE relations (
      source_id TEXT NOT NULL, target_id TEXT NOT NULL, type TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (source_id, target_id, type)
    );
    CREATE VIRTUAL TABLE notes_fts USING fts5(
      note_id UNINDEXED, title, summary, content, tokenize='unicode61'
    );
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY, note_id TEXT NOT NULL, heading TEXT,
      heading_ancestry TEXT, content TEXT NOT NULL, token_count INTEGER,
      chunk_type TEXT DEFAULT 'section', cut_type TEXT DEFAULT 'heading_boundary',
      position INTEGER DEFAULT 0
    );
    CREATE INDEX idx_chunks_note_id ON chunks(note_id);
    CREATE TABLE db_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE inbox (
      id TEXT PRIMARY KEY, content TEXT NOT NULL, title TEXT,
      source TEXT NOT NULL DEFAULT 'cli', source_url TEXT, source_meta TEXT,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, processed_at TEXT
    );
    CREATE TABLE feeds (
      id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      container_tag TEXT NOT NULL DEFAULT 'default', filter_prompt TEXT,
      last_polled TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE memory_entries (
      id TEXT PRIMARY KEY, memory TEXT NOT NULL, source_note_id TEXT NOT NULL,
      source_chunk_id TEXT, container_tag TEXT NOT NULL DEFAULT 'default',
      is_latest INTEGER NOT NULL DEFAULT 1, parent_memory_id TEXT, root_memory_id TEXT,
      relation_type TEXT, valid_at TEXT, invalid_at TEXT, forget_after TEXT,
      is_forgotten INTEGER NOT NULL DEFAULT 0, is_inference INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE memory_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT NOT NULL, event TEXT NOT NULL,
      old_memory TEXT, new_memory TEXT, actor TEXT NOT NULL DEFAULT 'system', created_at TEXT NOT NULL
    );
    CREATE TABLE note_access (
      note_id TEXT NOT NULL, event TEXT NOT NULL, created_at INTEGER NOT NULL
    );
  `);
  raw.pragma('user_version = 6');
  raw.prepare('INSERT INTO db_meta (key, value) VALUES (?, ?)').run('schema_version', '6');
  return raw;
}

// --- V2: Schema Migration Round-Trip ---

describe('V2: Schema Migration Round-Trip', () => {
  it('fresh DB has v11 schema', () => {
    const dbPath = tmpDbPath();
    const db = new BrainDB(dbPath);

    try {
      expect(db.getMetaValue('schema_version')).toBe('11');

      // Verify module columns work by inserting and reading a note with module fields
      db.setEmbeddingModel('mock-embedder', 384);
      db.upsertNote({
        id: 'v7-test',
        filePath: '/test.md',
        title: 'V7 Test',
        type: 'note',
        tier: 'slow',
        category: null,
        tags: null,
        summary: null,
        confidence: null,
        status: 'current',
        sources: null,
        createdAt: null,
        modifiedAt: null,
        lastReviewed: null,
        reviewInterval: null,
        expires: null,
        metadata: null,
        module: 'test-mod',
        moduleInstance: 'inst-1',
        contentDir: '/tmp/dir',
      });

      const note = db.getNoteById('v7-test');
      expect(note).toBeDefined();
      expect(note!.module).toBe('test-mod');
      expect(note!.moduleInstance).toBe('inst-1');
      expect(note!.contentDir).toBe('/tmp/dir');
    } finally {
      db.close();
    }

    // Verify schema details via raw better-sqlite3
    const raw = new Database(dbPath);
    try {
      const noteColumns = raw.pragma('table_info(notes)') as { name: string }[];
      const noteColNames = noteColumns.map((c) => c.name);
      expect(noteColNames).toContain('module');
      expect(noteColNames).toContain('module_instance');
      expect(noteColNames).toContain('content_dir');

      const relColumns = raw.pragma('table_info(relations)') as { name: string }[];
      const relColNames = relColumns.map((c) => c.name);
      expect(relColNames).toContain('module');
      expect(relColNames).toContain('module_instance');

      const tables = raw
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activities'")
        .all();
      expect(tables).toHaveLength(1);

      const indexes = raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_notes_module%'"
        )
        .all();
      expect(indexes.length).toBeGreaterThanOrEqual(2);
    } finally {
      raw.close();
    }
  });

  it('v6 DB migrates cleanly', () => {
    const dbPath = tmpDbPath();
    const raw = createV6Database(dbPath);

    raw
      .prepare(
        `INSERT INTO notes (id, file_path, title, type, tier, status) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('note-1', '/notes/note-1.md', 'Test Note 1', 'note', 'slow', 'current');
    raw
      .prepare(
        `INSERT INTO notes (id, file_path, title, type, tier, status) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('note-2', '/notes/note-2.md', 'Test Note 2', 'research', 'fast', 'draft');
    raw.close();

    // Reopen with BrainDB (triggers migration)
    const db = new BrainDB(dbPath);
    try {
      expect(db.getMetaValue('schema_version')).toBe('11');

      // Existing notes should have null module fields
      const note1 = db.getNoteById('note-1');
      expect(note1).toBeDefined();
      expect(note1!.module).toBeNull();
    } finally {
      db.close();
    }

    // Verify schema via raw DB after BrainDB closes
    const rawAfter = new Database(dbPath);
    try {
      const noteColumns = rawAfter.pragma('table_info(notes)') as { name: string }[];
      const noteColNames = noteColumns.map((c) => c.name);
      expect(noteColNames).toContain('module');
      expect(noteColNames).toContain('module_instance');
      expect(noteColNames).toContain('content_dir');

      const relColumns = rawAfter.pragma('table_info(relations)') as { name: string }[];
      expect(relColumns.map((c) => c.name)).toContain('module');

      const tables = rawAfter
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activities'")
        .all();
      expect(tables).toHaveLength(1);
    } finally {
      rawAfter.close();
    }
  });

  it('existing data survives migration', () => {
    const dbPath = tmpDbPath();
    const raw = createV6Database(dbPath);
    raw
      .prepare(
        `INSERT INTO notes (id, file_path, title, type, tier, status, category, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'surv-1',
        '/notes/surv-1.md',
        'Survivor One',
        'decision',
        'slow',
        'current',
        'architecture',
        'db,migration'
      );
    raw
      .prepare(
        `INSERT INTO notes (id, file_path, title, type, tier, status) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('surv-2', '/notes/surv-2.md', 'Survivor Two', 'research', 'fast', 'draft');
    raw.close();

    const db = new BrainDB(dbPath);
    try {
      const note1 = db.getNoteById('surv-1');
      expect(note1).toBeDefined();
      expect(note1!.title).toBe('Survivor One');
      expect(note1!.type).toBe('decision');
      expect(note1!.tier).toBe('slow');
      expect(note1!.category).toBe('architecture');
      expect(note1!.tags).toBe('db,migration');

      const note2 = db.getNoteById('surv-2');
      expect(note2).toBeDefined();
      expect(note2!.title).toBe('Survivor Two');
      expect(note2!.type).toBe('research');
      expect(note2!.status).toBe('draft');
    } finally {
      db.close();
    }
  });
});

// --- V3: Content Directory + FTS Integration ---

describe('V3: Content Directory + FTS Integration', () => {
  let db: BrainDB;
  let notesDir: string;
  const embedder = createMockEmbedder();

  beforeEach(() => {
    ({ db } = createTestDb());
    db.setEmbeddingModel(embedder.model, embedder.dimensions);
    notesDir = tmpDir();
  });

  afterEach(() => {
    db.close();
  });

  it('content directory text indexed into FTS', async () => {
    const contentDirPath = join(notesDir, 'dirtest.d');
    mkdirSync(contentDirPath, { recursive: true });
    writeFileSync(
      join(contentDirPath, 'details.md'),
      '# Details\n\nxylophone-quantum-42 is the secret code.',
      'utf-8'
    );
    writeFileSync(join(contentDirPath, 'image.png'), 'fakepngdata', 'utf-8');

    const filePath = writeNote(
      notesDir,
      'dirtest.md',
      {
        id: 'dirtest',
        title: '"Directory Test"',
        type: 'note',
        tier: 'slow',
        'content-dir': contentDirPath,
      },
      'Note body text'
    );

    const content = readFileSync(filePath, 'utf-8');
    await indexSingleFile(db, embedder, filePath, content, hashOf(content), Date.now());

    const results = db.searchFTS('xylophone-quantum-42', 10);
    expect(results.some((r) => r.noteId === 'dirtest')).toBe(true);
  });

  it('non-indexable files skipped', async () => {
    const contentDirPath = join(notesDir, 'skiptest.d');
    mkdirSync(contentDirPath, { recursive: true });
    writeFileSync(join(contentDirPath, 'image.png'), 'png-unique-marker-9876', 'utf-8');

    const filePath = writeNote(
      notesDir,
      'skiptest.md',
      {
        id: 'skiptest',
        title: '"Skip Test"',
        type: 'note',
        tier: 'slow',
        'content-dir': contentDirPath,
      },
      'Skip test body'
    );

    const content = readFileSync(filePath, 'utf-8');
    await indexSingleFile(db, embedder, filePath, content, hashOf(content), Date.now());

    const results = db.searchFTS('png-unique-marker-9876', 10);
    expect(results.some((r) => r.noteId === 'skiptest')).toBe(false);
  });

  it('note without content-dir still works', async () => {
    const filePath = writeNote(
      notesDir,
      'plain.md',
      {
        id: 'plain-note',
        title: '"Plain Note"',
        type: 'note',
        tier: 'slow',
      },
      'This note has zephyr-unique-text-777 in the body'
    );

    const content = readFileSync(filePath, 'utf-8');
    await indexSingleFile(db, embedder, filePath, content, hashOf(content), Date.now());

    const results = db.searchFTS('zephyr-unique-text-777', 10);
    expect(results.some((r) => r.noteId === 'plain-note')).toBe(true);
  });

  it('archive content directory', () => {
    const noteId = 'archive-test';
    const contentDirPath = join(notesDir, `${noteId}.d`);
    mkdirSync(contentDirPath, { recursive: true });
    writeFileSync(join(contentDirPath, 'file.md'), 'archive me', 'utf-8');

    const archivePath = archiveContentDir(notesDir, noteId);
    expect(archivePath).not.toBeNull();
    expect(existsSync(contentDirPath)).toBe(false);
    expect(existsSync(join(notesDir, '.archive', `${noteId}.d`, 'file.md'))).toBe(true);
  });

  it('delete content directory', () => {
    const noteId = 'delete-test';
    const contentDirPath = join(notesDir, `${noteId}.d`);
    mkdirSync(contentDirPath, { recursive: true });
    writeFileSync(join(contentDirPath, 'file.md'), 'delete me', 'utf-8');

    const deleted = deleteContentDir(notesDir, noteId);
    expect(deleted).toBe(true);
    expect(existsSync(contentDirPath)).toBe(false);
    expect(readIndexableContent(contentDirPath)).toBe('');
  });
});
