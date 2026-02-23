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
          const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ';
          const childNote = db.getNoteById(child.id);
          const label = childNote ? `${childNote.title} (${child.id})` : child.id;
          process.stdout.write(`${prefix}${connector}${label}\n`);
          printTree(child.id, prefix + (isLast ? '    ' : '\u2502   '));
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
      process.stdout.write(`Archived: ${result.archivedNote} \u2192 ${result.archivedPath}\n`);
      if (result.orphanedChildren.length > 0) {
        process.stdout.write(`Orphaned children:\n`);
        for (const id of result.orphanedChildren) {
          process.stdout.write(`  - ${id}\n`);
        }
      }
    });
  });
