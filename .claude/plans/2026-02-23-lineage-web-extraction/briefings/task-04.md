# Task 04: CascadeDelete on BrainDB

## Architectural Context

`BrainDB` is the database facade that orchestrates cross-repo operations. It already has a `deleteNote(id)` method that handles single-note deletion (memories, chunks, FTS, relations, note). This task adds `cascadeDelete(noteId)` which uses the recursive `getDescendants()` from NoteRepo (Task 3) to find all notes in a `derived-from` lineage tree and deletes them leaf-first. Also adds facade delegates for the new NoteRepo methods.

## File Ownership

**May modify:**
- `src/services/brain-db.ts`
- `__tests__/services/brain-db.test.ts`

**Must not touch:**
- `src/services/repos/note-repo.ts` — Task 3 owns repo methods
- `src/types.ts` — Task 1 owns types
- `src/commands/` — Task 6 owns CLI

**Read for context (do not modify):**
- `src/services/repos/note-repo.ts` — understand `getDescendants` signature
- `src/types.ts` — understand `NoteAccessEvent` type

## Steps

### Step 1: Write failing test for cascadeDelete

In `__tests__/services/brain-db.test.ts`, add:

```typescript
describe('cascadeDelete', () => {
  beforeEach(() => {
    // Create lineage: initiative -> child1, child2; child1 -> grandchild1
    for (const id of ['initiative', 'child1', 'child2', 'grandchild1']) {
      db.upsertNote({
        id,
        filePath: `/test/${id}.md`,
        title: id,
        type: 'research',
        tier: 'fast',
        category: null,
        tags: null,
        summary: null,
        confidence: null,
        status: 'current',
        sources: null,
        createdAt: '2026-01-01',
        modifiedAt: '2026-01-01',
        lastReviewed: null,
        reviewInterval: null,
        expires: null,
        metadata: null,
      });
    }
    db.upsertRelations('child1', [
      { sourceId: 'child1', targetId: 'initiative', type: 'derived-from' },
    ]);
    db.upsertRelations('child2', [
      { sourceId: 'child2', targetId: 'initiative', type: 'derived-from' },
    ]);
    db.upsertRelations('grandchild1', [
      { sourceId: 'grandchild1', targetId: 'child1', type: 'derived-from' },
    ]);
  });

  it('returns preview of affected notes', () => {
    const preview = db.cascadeDeletePreview('initiative');
    expect(preview.noteIds).toContain('child1');
    expect(preview.noteIds).toContain('child2');
    expect(preview.noteIds).toContain('grandchild1');
    expect(preview.noteIds).toContain('initiative');
    expect(preview.noteCount).toBe(4);
  });

  it('deletes all descendants and the root', () => {
    db.cascadeDelete('initiative');
    expect(db.getNoteById('initiative')).toBeNull();
    expect(db.getNoteById('child1')).toBeNull();
    expect(db.getNoteById('child2')).toBeNull();
    expect(db.getNoteById('grandchild1')).toBeNull();
  });

  it('deletes a leaf node without affecting siblings', () => {
    db.cascadeDelete('grandchild1');
    expect(db.getNoteById('grandchild1')).toBeNull();
    expect(db.getNoteById('child1')).not.toBeNull();
    expect(db.getNoteById('initiative')).not.toBeNull();
  });
});
```

### Step 2: Run test to verify it fails

Run: `npm test -- __tests__/services/brain-db.test.ts`
Expected: FAIL — `cascadeDeletePreview` and `cascadeDelete` don't exist.

### Step 3: Add facade delegates for new NoteRepo methods

In `src/services/brain-db.ts`, add facade delegates:

```typescript
getDescendants(noteId: string, maxDepth?: number): Array<{ id: string; depth: number }> {
  return this.noteRepo.getDescendants(noteId, maxDepth);
}

recordAccess(noteId: string, event: NoteAccessEvent): void {
  this.noteRepo.recordAccess(noteId, event);
}

getAccessCount(noteId: string): number {
  return this.noteRepo.getAccessCount(noteId);
}

getAccessCounts(noteIds: string[]): Map<string, number> {
  return this.noteRepo.getAccessCounts(noteIds);
}
```

Import `NoteAccessEvent` from `../types.js`.

### Step 4: Implement cascadeDeletePreview and cascadeDelete

In `src/services/brain-db.ts`, add:

```typescript
interface CascadePreview {
  noteIds: string[];
  noteCount: number;
  memoryCount: number;
}

cascadeDeletePreview(noteId: string): CascadePreview {
  const descendants = this.noteRepo.getDescendants(noteId);
  const allIds = [noteId, ...descendants.map((d) => d.id)];
  let memoryCount = 0;
  for (const id of allIds) {
    memoryCount += this.memoryRepo.getMemoriesForNote(id).length;
  }
  return { noteIds: allIds, noteCount: allIds.length, memoryCount };
}

cascadeDelete(noteId: string): CascadePreview {
  const preview = this.cascadeDeletePreview(noteId);
  // Sort by depth descending (leaves first) to maintain referential integrity
  const descendants = this.noteRepo.getDescendants(noteId);
  const sorted = [...descendants].sort((a, b) => b.depth - a.depth);

  const txn = this.db.transaction(() => {
    // Delete leaves first, then work up to root
    for (const desc of sorted) {
      this.deleteNote(desc.id);
    }
    // Delete root last
    this.deleteNote(noteId);
  });
  txn();

  return preview;
}
```

Export the `CascadePreview` interface from brain-db.ts.

### Step 5: Run tests

Run: `npm test -- __tests__/services/brain-db.test.ts`
Expected: PASS

### Step 6: Run full test suite

Run: `npm test && npm run typecheck`
Expected: All pass

### Step 7: Commit

```bash
git add src/services/brain-db.ts __tests__/services/brain-db.test.ts
git commit -m "Add cascadeDelete with preview for derived-from lineage trees"
```

## Success Criteria

- [ ] Tests pass: `npm test -- __tests__/services/brain-db.test.ts`
- [ ] Types check: `npm run typecheck`
- [ ] `cascadeDeletePreview` returns all affected note IDs and counts
- [ ] `cascadeDelete` removes all descendants leaf-first, then root
- [ ] Facade delegates for `getDescendants`, `recordAccess`, `getAccessCount`, `getAccessCounts` work

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT add features beyond what is specified in the steps
- Do NOT implement archive logic — Task 5 handles that
