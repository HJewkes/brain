# Task 03: NoteRepo Lineage + Access Helpers

## Architectural Context

`NoteRepo` in `src/services/repos/note-repo.ts` owns all note, chunk, relation, and FTS SQL. This task adds two new capabilities: (1) a recursive CTE query to find all descendants of a note via `derived-from` edges (used by cascade operations in Tasks 4-5), and (2) methods to record and query `note_access` events (used by search tracking in Task 7 and promotion logic). The `note_access` table is created by Task 1's schema V6 migration.

## File Ownership

**May modify:**
- `src/services/repos/note-repo.ts`
- `__tests__/services/repos/note-repo.test.ts`

**Must not touch:**
- `src/types.ts` — Task 1 owns types (but you can import new types)
- `src/services/brain-db.ts` — Tasks 1/4/5 own facade changes
- `src/services/search.ts` — Task 7 owns search integration

**Read for context (do not modify):**
- `src/types.ts` — import `NoteAccessEvent`, `NoteAccessRecord`, `RelationType`
- `src/services/brain-db.ts` — understand facade delegation pattern

## Steps

### Step 1: Write failing tests for descendants query

In `__tests__/services/repos/note-repo.test.ts`, add tests:

```typescript
describe('getDescendants', () => {
  beforeEach(() => {
    // Create a lineage tree: initiative -> child1, child2 -> grandchild1
    for (const id of ['initiative', 'child1', 'child2', 'grandchild1']) {
      db.prepare(
        `INSERT INTO notes (id, file_path, title, type, tier, status)
         VALUES (?, ?, ?, 'note', 'fast', 'current')`
      ).run(id, `/test/${id}.md`, id);
    }
    const insert = db.prepare(
      `INSERT INTO relations (source_id, target_id, type, created_at) VALUES (?, ?, ?, ?)`
    );
    insert.run('child1', 'initiative', 'derived-from', Date.now());
    insert.run('child2', 'initiative', 'derived-from', Date.now());
    insert.run('grandchild1', 'child1', 'derived-from', Date.now());
  });

  it('returns all descendants of a note', () => {
    const descendants = noteRepo.getDescendants('initiative');
    const ids = descendants.map((d) => d.id).sort();
    expect(ids).toEqual(['child1', 'child2', 'grandchild1']);
  });

  it('returns empty for leaf nodes', () => {
    const descendants = noteRepo.getDescendants('grandchild1');
    expect(descendants).toEqual([]);
  });

  it('returns direct children only at depth 1', () => {
    const descendants = noteRepo.getDescendants('initiative', 1);
    const ids = descendants.map((d) => d.id).sort();
    expect(ids).toEqual(['child1', 'child2']);
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npm test -- __tests__/services/repos/note-repo.test.ts`
Expected: FAIL — `getDescendants` doesn't exist yet.

### Step 3: Implement getDescendants

In `src/services/repos/note-repo.ts`, add:

```typescript
getDescendants(noteId: string, maxDepth?: number): Array<{ id: string; depth: number }> {
  const depthLimit = maxDepth ?? 100;
  const rows = this.db.prepare(`
    WITH RECURSIVE descendants(id, depth) AS (
      SELECT source_id, 1 FROM relations
      WHERE target_id = ? AND type = 'derived-from'
      UNION ALL
      SELECT r.source_id, d.depth + 1 FROM relations r
      JOIN descendants d ON r.target_id = d.id
      WHERE r.type = 'derived-from' AND d.depth < ?
    )
    SELECT id, depth FROM descendants
  `).all(noteId, depthLimit) as Array<{ id: string; depth: number }>;
  return rows;
}
```

### Step 4: Run descendants tests

Run: `npm test -- __tests__/services/repos/note-repo.test.ts`
Expected: PASS for descendants tests.

### Step 5: Write failing tests for access tracking

```typescript
describe('note access tracking', () => {
  it('records an access event', () => {
    noteRepo.recordAccess('test-note', 'search_hit');
    const count = noteRepo.getAccessCount('test-note');
    expect(count).toBe(1);
  });

  it('counts multiple events', () => {
    noteRepo.recordAccess('test-note', 'search_hit');
    noteRepo.recordAccess('test-note', 'context_view');
    noteRepo.recordAccess('test-note', 'search_hit');
    const count = noteRepo.getAccessCount('test-note');
    expect(count).toBe(3);
  });

  it('returns 0 for unaccessed notes', () => {
    const count = noteRepo.getAccessCount('nonexistent');
    expect(count).toBe(0);
  });
});
```

### Step 6: Implement access tracking methods

In `src/services/repos/note-repo.ts`, add:

```typescript
recordAccess(noteId: string, event: NoteAccessEvent): void {
  this.db.prepare(
    'INSERT INTO note_access (note_id, event, created_at) VALUES (?, ?, ?)'
  ).run(noteId, event, Date.now());
}

getAccessCount(noteId: string): number {
  const row = this.db.prepare(
    'SELECT COUNT(*) as count FROM note_access WHERE note_id = ?'
  ).get(noteId) as { count: number };
  return row.count;
}

getAccessCounts(noteIds: string[]): Map<string, number> {
  if (noteIds.length === 0) return new Map();
  const placeholders = noteIds.map(() => '?').join(',');
  const rows = this.db.prepare(
    `SELECT note_id, COUNT(*) as count FROM note_access
     WHERE note_id IN (${placeholders}) GROUP BY note_id`
  ).all(...noteIds) as Array<{ note_id: string; count: number }>;
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.note_id, row.count);
  }
  return map;
}
```

Import `NoteAccessEvent` from `../../types.js` at the top of the file.

### Step 7: Run all tests

Run: `npm test -- __tests__/services/repos/note-repo.test.ts`
Expected: PASS

### Step 8: Commit

```bash
git add src/services/repos/note-repo.ts __tests__/services/repos/note-repo.test.ts
git commit -m "Add lineage descendants query and access tracking to NoteRepo"
```

## Success Criteria

- [ ] Tests pass: `npm test -- __tests__/services/repos/note-repo.test.ts`
- [ ] Types check: `npm run typecheck`
- [ ] `getDescendants` returns recursive descendants via `derived-from` edges
- [ ] `getDescendants` respects `maxDepth` parameter
- [ ] `recordAccess` and `getAccessCount` work for note access tracking

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT add features beyond what is specified in the steps
- Do NOT add facade delegates on BrainDB — Tasks 4/5 will add those
