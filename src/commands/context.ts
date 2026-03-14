import { Command } from '@commander-js/extra-typings';
import { withDb } from '../services/brain-service.js';
import { parentResolveOpts } from '../services/config.js';
import { isJsonFormat } from './format.js';

const PM_ID_PATTERN = /^[A-Z]{2,5}(-\d{2}(\.\d{2})?)?$/;

export const contextCommand = new Command('context')
  .description('Show context for a note: related notes, memories, and graph connections')
  .argument('<id>', 'Note ID')
  .option('--json', 'Output as JSON')
  .action(async (id, opts, cmd) => {
    await withDb(({ db }) => {
      const note = db.getNoteById(id);
      if (!note) {
        if (PM_ID_PATTERN.test(id.toUpperCase())) {
          process.stderr.write(
            `Note "${id}" not found. This looks like a PM display ID — try: brain pm context ${id}\n`
          );
        } else {
          process.stderr.write(`Error: note "${id}" not found\n`);
        }
        process.exitCode = 1;
        return;
      }

      const memories = db.getMemoriesForNote(id);
      const relationsFrom = db.getRelationsFrom(id);
      const relationsTo = db.getRelationsTo(id);

      const relatedNoteIds = new Set([
        ...relationsFrom.map((r) => r.targetId),
        ...relationsTo.map((r) => r.sourceId),
      ]);
      relatedNoteIds.delete(id);

      const relatedNotesById = db.getNotesByIds([...relatedNoteIds]);
      const relatedNotes = [...relatedNotesById.values()];

      if (isJsonFormat(opts, cmd)) {
        process.stdout.write(
          JSON.stringify({
            note: { id: note.id, title: note.title, type: note.type, tier: note.tier },
            memories,
            relations: [...relationsFrom, ...relationsTo],
            relatedNotes: relatedNotes.map((n) => ({
              id: n.id,
              title: n.title,
              type: n.type,
            })),
          }) + '\n'
        );
        return;
      }

      process.stdout.write(`${note.title} (${note.type}, ${note.tier})\n`);
      process.stdout.write(`  id: ${note.id}\n`);
      process.stdout.write('\n');

      if (memories.length > 0) {
        process.stdout.write(`Memories (${memories.length}):\n`);
        for (const m of memories) {
          const tag = m.containerTag !== 'default' ? ` [${m.containerTag}]` : '';
          process.stdout.write(`  - ${m.memory}${tag}\n`);
        }
        process.stdout.write('\n');
      }

      if (relatedNotes.length > 0) {
        process.stdout.write(`Related notes (${relatedNotes.length}):\n`);
        for (const rn of relatedNotes) {
          process.stdout.write(`  - ${rn.title} (${rn.id})\n`);
        }
        process.stdout.write('\n');
      }

      const allRelations = [...relationsFrom, ...relationsTo];
      if (allRelations.length > 0) {
        process.stdout.write(`Relations (${allRelations.length}):\n`);
        for (const r of allRelations) {
          const direction = r.sourceId === id ? '->' : '<-';
          const other = r.sourceId === id ? r.targetId : r.sourceId;
          process.stdout.write(`  ${direction} ${r.type} ${other}\n`);
        }
      }

      if (memories.length === 0 && relatedNotes.length === 0 && allRelations.length === 0) {
        process.stdout.write('No context found for this note.\n');
      }
    }, parentResolveOpts(cmd));
  });
