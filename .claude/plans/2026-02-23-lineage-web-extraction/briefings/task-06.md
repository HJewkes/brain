# Task 06: brain lineage CLI Command

## Architectural Context

Brain uses Commander.js for CLI commands, registered in `src/cli.ts` via `program.addCommand()`. Each command lives in `src/commands/`. This task adds `brain lineage` with subcommands: `tree` (visualize lineage), `delete` (cascade delete with confirmation), and `archive` (cascade archive with confirmation). Commands use `withDb` or `withBrain` helpers from `brain-service.ts` for resource lifecycle.

## File Ownership

**May modify:**
- `src/commands/lineage.ts` (new file)
- `src/cli.ts` (add command registration)
- `__tests__/commands/lineage.test.ts` (new file)

**Must not touch:**
- `src/services/brain-db.ts` — Tasks 4/5 own cascade methods
- `src/services/repos/` — Task 3 owns repo methods
- Other command files

**Read for context (do not modify):**
- `src/commands/graph.ts` — reference for graph visualization patterns
- `src/services/brain-service.ts` — understand `withDb`/`withBrain` helpers
- `src/services/brain-db.ts` — understand `cascadeDeletePreview`, `cascadeDelete`, `cascadeArchive` signatures

## Steps

### Step 1: Create the lineage command file

Create `src/commands/lineage.ts`:

```typescript
import { Command } from '@commander-js/extra-typings';
import { withDb } from '../services/brain-service.js';

export const lineageCommand = new Command('lineage')
  .description('View and manage note lineage (derived-from trees)');

lineageCommand
  .command('tree')
  .description('Show lineage tree for a note')
  .argument('<noteId>', 'Root note ID')
  .option('--depth <n>', 'Max depth to display', '10')
  .action(async (noteId, opts) => {
    await withDb(({ db }) => {
      const note = db.getNoteById(noteId);
      if (!note) {
        process.stderr.write(`Note not found: ${noteId}\n`);
        process.exitCode = 1;
        return;
      }

      const descendants = db.getDescendants(noteId, Number(opts.depth));
      process.stdout.write(`${note.title} (${noteId})\n`);

      if (descendants.length === 0) {
        process.stdout.write('  (no derived notes)\n');
        return;
      }

      // Group by parent for tree display
      const childrenOf = new Map<string, Array<{ id: string; depth: number }>>();
      for (const d of descendants) {
        // Find parent by checking relations
        const rels = db.getRelationsFrom(d.id);
        const parentRel = rels.find((r) => r.type === 'derived-from');
        const parentId = parentRel?.targetId ?? noteId;
        if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
        childrenOf.get(parentId)!.push(d);
      }

      function printTree(parentId: string, prefix: string): void {
        const children = childrenOf.get(parentId) ?? [];
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          const isLast = i === children.length - 1;
          const connector = isLast ? '└── ' : '├── ';
          const childNote = db.getNoteById(child.id);
          const label = childNote ? `${childNote.title} (${child.id})` : child.id;
          process.stdout.write(`${prefix}${connector}${label}\n`);
          printTree(child.id, prefix + (isLast ? '    ' : '│   '));
        }
      }

      printTree(noteId, '');
      process.stdout.write(`\n${descendants.length} derived note(s)\n`);
    });
  });

lineageCommand
  .command('delete')
  .description('Cascade delete a note and all its descendants')
  .argument('<noteId>', 'Root note ID')
  .option('--force', 'Skip confirmation prompt')
  .action(async (noteId, opts) => {
    await withDb(({ db }) => {
      const preview = db.cascadeDeletePreview(noteId);
      if (preview.noteCount === 0) {
        process.stderr.write(`Note not found: ${noteId}\n`);
        process.exitCode = 1;
        return;
      }

      process.stdout.write(
        `Will delete ${preview.noteCount} note(s) and ${preview.memoryCount} memorie(s):\n`
      );
      for (const id of preview.noteIds) {
        process.stdout.write(`  - ${id}\n`);
      }

      if (!opts.force) {
        process.stdout.write('\nUse --force to confirm deletion.\n');
        return;
      }

      db.cascadeDelete(noteId);
      process.stdout.write(`\nDeleted ${preview.noteCount} note(s).\n`);
    });
  });

lineageCommand
  .command('archive')
  .description('Archive a note and mark its children as orphaned')
  .argument('<noteId>', 'Root note ID')
  .action(async (noteId) => {
    await withDb(({ db, config }) => {
      const note = db.getNoteById(noteId);
      if (!note) {
        process.stderr.write(`Note not found: ${noteId}\n`);
        process.exitCode = 1;
        return;
      }

      const result = db.cascadeArchive(noteId, config.notesDir);
      process.stdout.write(`Archived: ${result.archivedNote} → ${result.archivedPath}\n`);
      if (result.orphanedChildren.length > 0) {
        process.stdout.write(`Orphaned children:\n`);
        for (const id of result.orphanedChildren) {
          process.stdout.write(`  - ${id}\n`);
        }
      }
    });
  });
```

### Step 2: Register command in cli.ts

In `src/cli.ts`, add:

```typescript
import { lineageCommand } from './commands/lineage.js';
```

And:

```typescript
program.addCommand(lineageCommand);
```

### Step 3: Write basic tests

Create `__tests__/commands/lineage.test.ts` with smoke tests that verify the command module exports correctly and the tree formatting works:

```typescript
import { describe, it, expect } from 'vitest';
import { lineageCommand } from '../../src/commands/lineage.js';

describe('lineage command', () => {
  it('exports a Commander command', () => {
    expect(lineageCommand.name()).toBe('lineage');
  });

  it('has tree, delete, and archive subcommands', () => {
    const subcommands = lineageCommand.commands.map((c) => c.name());
    expect(subcommands).toContain('tree');
    expect(subcommands).toContain('delete');
    expect(subcommands).toContain('archive');
  });
});
```

### Step 4: Run tests

Run: `npm test -- __tests__/commands/lineage.test.ts`
Expected: PASS

### Step 5: Run full test suite and typecheck

Run: `npm test && npm run typecheck`
Expected: All pass

### Step 6: Commit

```bash
git add src/commands/lineage.ts src/cli.ts __tests__/commands/lineage.test.ts
git commit -m "Add brain lineage CLI command (tree, delete, archive)"
```

## Success Criteria

- [ ] Tests pass: `npm test -- __tests__/commands/lineage.test.ts`
- [ ] Types check: `npm run typecheck`
- [ ] `brain lineage tree <id>` displays a tree of derived notes
- [ ] `brain lineage delete <id> --force` cascade deletes with preview
- [ ] `brain lineage archive <id>` archives root and marks children orphaned
- [ ] Command registered in `cli.ts`

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT add features beyond what is specified in the steps
- Do NOT implement interactive confirmation (stdin prompts) — use `--force` flag pattern
