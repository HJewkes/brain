import { Command } from '@commander-js/extra-typings';
import { loadConfig } from '../services/config.js';
import { BrainDB } from '../services/brain-db.js';

export const contextCommand = new Command('context')
  .description('Show context for a note: related notes, memories, and graph connections')
  .argument('<id>', 'Note ID')
  .option('--json', 'Output as JSON')
  .action((id, opts) => {
    const config = loadConfig();
    const db = new BrainDB(config.dbPath);

    try {
      const note = db.getNoteById(id);
      if (!note) {
        console.error(`Error: note "${id}" not found`);
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

      const relatedNotes = [...relatedNoteIds]
        .map((nid) => db.getNoteById(nid))
        .filter((n) => n !== null);

      if (opts.json) {
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

      console.log(`${note.title} (${note.type}, ${note.tier})`);
      console.log(`  id: ${note.id}`);
      console.log();

      if (memories.length > 0) {
        console.log(`Memories (${memories.length}):`);
        for (const m of memories) {
          const tag = m.containerTag !== 'default' ? ` [${m.containerTag}]` : '';
          console.log(`  - ${m.memory}${tag}`);
        }
        console.log();
      }

      if (relatedNotes.length > 0) {
        console.log(`Related notes (${relatedNotes.length}):`);
        for (const rn of relatedNotes) {
          console.log(`  - ${rn.title} (${rn.id})`);
        }
        console.log();
      }

      const allRelations = [...relationsFrom, ...relationsTo];
      if (allRelations.length > 0) {
        console.log(`Relations (${allRelations.length}):`);
        for (const r of allRelations) {
          const direction = r.sourceId === id ? '->' : '<-';
          const other = r.sourceId === id ? r.targetId : r.sourceId;
          console.log(`  ${direction} ${r.type} ${other}`);
        }
      }

      if (memories.length === 0 && relatedNotes.length === 0 && allRelations.length === 0) {
        console.log('No context found for this note.');
      }
    } finally {
      db.close();
    }
  });
