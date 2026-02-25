# Task 01: Types + Schema V6 Migration

## Architectural Context

Brain uses a repository pattern with `BrainDB` as a facade over domain repos. Schema migrations are versioned (currently V5) in `brain-db.ts`. This task adds the `derived-from` relation type to the TypeScript union and creates a `note_access` table via V6 migration for tracking how notes are accessed (for usage-based tier promotion).

## File Ownership

**May modify:**
- `src/types.ts`
- `src/services/brain-db.ts`
- `__tests__/services/brain-db.test.ts`

**Must not touch:**
- `src/services/repos/note-repo.ts` — Task 3 owns repo methods
- `src/services/repos/memory-repo.ts`
- `src/commands/` — no CLI changes in this task

**Read for context (do not modify):**
- `src/services/repos/note-repo.ts` — understand existing relation patterns

## Steps

### Step 1: Write failing test for V6 migration

In `__tests__/services/brain-db.test.ts`, add a test that verifies the `note_access` table exists after migration and that `derived-from` can be stored as a relation type.

```typescript
describe('schema V6 migration', () => {
  it('creates note_access table', () => {
    const row = db.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='note_access'"
    ).get() as { name: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.name).toBe('note_access');
  });

  it('stores derived-from relation type', () => {
    // Insert a test note first
    db.upsertNote({
      id: 'parent-note',
      filePath: '/test/parent.md',
      title: 'Parent',
      type: 'note',
      tier: 'slow',
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
    db.upsertNote({
      id: 'child-note',
      filePath: '/test/child.md',
      title: 'Child',
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

    db.upsertRelations('child-note', [
      { sourceId: 'child-note', targetId: 'parent-note', type: 'derived-from' },
    ]);

    const rels = db.getRelationsFrom('child-note');
    expect(rels).toHaveLength(1);
    expect(rels[0].type).toBe('derived-from');
    expect(rels[0].targetId).toBe('parent-note');
  });
});
```

### Step 2: Run test to verify it fails

Run: `npm test -- __tests__/services/brain-db.test.ts`
Expected: Tests may fail if `note_access` table doesn't exist or type checks fail.

### Step 3: Add `derived-from` to RelationType in types.ts

In `src/types.ts`, update the RelationType union:

```typescript
export type RelationType = 'related-to' | 'supersedes' | 'informs' | 'parent' | 'derived-from';
```

Also add the NoteAccessEvent type and interface:

```typescript
export type NoteAccessEvent = 'search_hit' | 'relation_target' | 'context_view';

export interface NoteAccessRecord {
  noteId: string;
  event: NoteAccessEvent;
  createdAt: number;
}
```

### Step 4: Add Schema V6 migration in brain-db.ts

Update `SCHEMA_VERSION` from 5 to 6. Add the V6 migration DDL and apply it:

```typescript
const SCHEMA_VERSION = 6;
```

Add a `noteAccessDDL()` method:

```typescript
private noteAccessDDL(): string {
  return `
    CREATE TABLE IF NOT EXISTS note_access (
      note_id    TEXT NOT NULL,
      event      TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_note_access_note ON note_access(note_id);
  `;
}
```

Add migration call in `migrate()`:

```typescript
this.applyMigration(currentVersion, 6, () => this.db.exec(this.noteAccessDDL()));
```

Also add `noteAccessDDL()` content to `schemaV1()` so fresh databases get the table.

### Step 5: Run tests to verify they pass

Run: `npm test -- __tests__/services/brain-db.test.ts`
Expected: PASS

### Step 6: Run full test suite and typecheck

Run: `npm test && npm run typecheck`
Expected: All pass

### Step 7: Commit

```bash
git add src/types.ts src/services/brain-db.ts __tests__/services/brain-db.test.ts
git commit -m "Add derived-from relation type and note_access table (schema V6)"
```

## Success Criteria

- [ ] Tests pass: `npm test -- __tests__/services/brain-db.test.ts`
- [ ] Types check: `npm run typecheck`
- [ ] `derived-from` can be stored and queried as a relation type
- [ ] `note_access` table exists after fresh DB creation and after V5→V6 migration

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT add features beyond what is specified in the steps
- Do NOT add repo methods for note_access — Task 3 handles that
