# Task 05: CascadeArchive on BrainDB

## Architectural Context

`cascadeArchive` is the safe alternative to `cascadeDelete`. It moves the root note's file to `.archive/` under the notes directory, removes it from the search index (chunks, FTS, vectors), sets its DB status to `archived`, and marks direct children with `orphaned_from` in their frontmatter. Children stay live and indexed — only the root is archived. This requires reading/writing markdown files and updating frontmatter.

## File Ownership

**May modify:**
- `src/services/brain-db.ts`
- `src/services/indexing.ts` (for `updateNoteFrontmatter` helper)
- `__tests__/services/brain-db.test.ts`

**Must not touch:**
- `src/services/repos/note-repo.ts` — Task 3 owns repo
- `src/types.ts` — Task 1 owns types
- `src/commands/` — Task 6 owns CLI

**Read for context (do not modify):**
- `src/services/repos/note-repo.ts` — understand `getDescendants` (depth=1 for direct children)
- `src/services/markdown-parser.ts` — understand frontmatter format
- `src/services/config.ts` — understand `notesDir` config

## Steps

### Step 1: Write failing tests for cascadeArchive

In `__tests__/services/brain-db.test.ts`, add:

```typescript
describe('cascadeArchive', () => {
  const tmpDir = join(tmpdir(), `brain-archive-test-${Date.now()}`);
  const archiveDir = join(tmpDir, '.archive');

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    // Create test files
    const initPath = join(tmpDir, 'research', 'initiative.md');
    mkdirSync(dirname(initPath), { recursive: true });
    writeFileSync(initPath, '---\nid: initiative\ntitle: "Init"\ntype: research\ntier: fast\n---\nContent');

    const childPath = join(tmpDir, 'research', 'child1.md');
    writeFileSync(childPath, '---\nid: child1\ntitle: "Child"\ntype: research\ntier: fast\n---\nChild content');

    // Create DB records
    for (const [id, fp] of [['initiative', initPath], ['child1', childPath]]) {
      db.upsertNote({
        id, filePath: fp, title: id, type: 'research', tier: 'fast',
        category: null, tags: null, summary: null, confidence: null,
        status: 'current', sources: null, createdAt: '2026-01-01',
        modifiedAt: '2026-01-01', lastReviewed: null,
        reviewInterval: null, expires: null, metadata: null,
      });
    }
    db.upsertRelations('child1', [
      { sourceId: 'child1', targetId: 'initiative', type: 'derived-from' },
    ]);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('moves root note file to archive directory', () => {
    db.cascadeArchive('initiative', tmpDir);
    expect(existsSync(join(archiveDir, 'research', 'initiative.md'))).toBe(true);
    expect(existsSync(join(tmpDir, 'research', 'initiative.md'))).toBe(false);
  });

  it('sets root note status to archived in DB', () => {
    db.cascadeArchive('initiative', tmpDir);
    const note = db.getNoteById('initiative');
    expect(note).not.toBeNull();
    expect(note!.status).toBe('archived');
  });

  it('removes root note from search index', () => {
    db.cascadeArchive('initiative', tmpDir);
    const chunks = db.getChunksForNote('initiative');
    expect(chunks).toHaveLength(0);
  });

  it('adds orphaned_from to child frontmatter', () => {
    db.cascadeArchive('initiative', tmpDir);
    const childContent = readFileSync(join(tmpDir, 'research', 'child1.md'), 'utf-8');
    expect(childContent).toContain('orphaned_from: initiative');
  });

  it('keeps child note live and indexed', () => {
    db.cascadeArchive('initiative', tmpDir);
    const child = db.getNoteById('child1');
    expect(child).not.toBeNull();
    expect(child!.status).toBe('current');
  });
});
```

### Step 2: Run test to verify it fails

Run: `npm test -- __tests__/services/brain-db.test.ts`
Expected: FAIL — `cascadeArchive` doesn't exist.

### Step 3: Add frontmatter update helper to indexing.ts

In `src/services/indexing.ts`, add an exported helper to add a field to a note's YAML frontmatter:

```typescript
export function addFrontmatterField(filePath: string, field: string, value: string): void {
  const content = readFileSync(filePath, 'utf-8');
  const endOfFrontmatter = content.indexOf('\n---', 4);
  if (endOfFrontmatter === -1) return;
  const updated = content.slice(0, endOfFrontmatter) + `\n${field}: ${value}` + content.slice(endOfFrontmatter);
  writeFileSync(filePath, updated, 'utf-8');
}
```

### Step 4: Implement cascadeArchive on BrainDB

In `src/services/brain-db.ts`, add:

```typescript
interface ArchiveResult {
  archivedNote: string;
  archivedPath: string;
  orphanedChildren: string[];
}

cascadeArchive(noteId: string, notesDir: string): ArchiveResult {
  const note = this.getNoteById(noteId);
  if (!note) throw new Error(`Note not found: ${noteId}`);

  const archiveDir = join(notesDir, '.archive');
  const relativePath = relative(notesDir, note.filePath);
  const archivePath = join(archiveDir, relativePath);

  // Move file to archive
  mkdirSync(dirname(archivePath), { recursive: true });
  if (existsSync(note.filePath)) {
    renameSync(note.filePath, archivePath);
  }

  // Remove from search index (chunks, FTS, vectors) but keep note row
  const txn = this.db.transaction(() => {
    this.memoryRepo.deleteMemoriesForNote(noteId);
    this.noteRepo.deleteChunksForNote(noteId);
    this.db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(noteId);
    // Update status to archived, update file_path to archive location
    this.db.prepare(
      'UPDATE notes SET status = ?, file_path = ? WHERE id = ?'
    ).run('archived', archivePath, noteId);
  });
  txn();

  // Mark direct children as orphaned
  const directChildren = this.noteRepo.getDescendants(noteId, 1);
  const orphanedIds: string[] = [];
  for (const child of directChildren) {
    const childNote = this.getNoteById(child.id);
    if (childNote && existsSync(childNote.filePath)) {
      addFrontmatterField(childNote.filePath, 'orphaned_from', noteId);
      orphanedIds.push(child.id);
    }
  }

  return { archivedNote: noteId, archivedPath: archivePath, orphanedChildren: orphanedIds };
}
```

Import `addFrontmatterField` from `./indexing.js`, and `join`, `dirname`, `relative` from `node:path`, `mkdirSync`, `renameSync`, `existsSync` from `node:fs`.

Export the `ArchiveResult` interface.

### Step 5: Run tests

Run: `npm test -- __tests__/services/brain-db.test.ts`
Expected: PASS

### Step 6: Run full test suite

Run: `npm test && npm run typecheck`
Expected: All pass

### Step 7: Commit

```bash
git add src/services/brain-db.ts src/services/indexing.ts __tests__/services/brain-db.test.ts
git commit -m "Add cascadeArchive: move to .archive, deindex root, mark children orphaned"
```

## Success Criteria

- [ ] Tests pass: `npm test -- __tests__/services/brain-db.test.ts`
- [ ] Types check: `npm run typecheck`
- [ ] Root note file moved to `.archive/` preserving relative path
- [ ] Root note status set to `archived` in DB
- [ ] Root note chunks/FTS/vectors removed from index
- [ ] Direct children get `orphaned_from` frontmatter field
- [ ] Children remain live and indexed

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT add features beyond what is specified in the steps
- Do NOT recurse into children for archiving — only the root is archived
- Do NOT delete relations — archive preserves the `derived-from` edges for lineage queries
