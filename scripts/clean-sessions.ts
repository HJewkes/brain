/**
 * Clean session data for re-testing.
 * Usage: npx tsx scripts/clean-sessions.ts [--confirm]
 *
 * Without --confirm: dry-run showing what would be deleted.
 * With --confirm: actually deletes session notes, content dirs, and ingestion state.
 */
import { withDb } from '../src/services/brain-service.js';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const confirm = process.argv.includes('--confirm');

await withDb(async (svc) => {
  const noteIds = svc.db.getModuleNoteIds({ module: 'sessions', type: 'session' });
  const notes = svc.db.getNotesByIds(noteIds);

  console.log(`Found ${noteIds.length} session notes`);

  if (!confirm) {
    console.log('Dry run — pass --confirm to actually delete');
    for (const [id, note] of notes) {
      const meta = note.metadata ? (JSON.parse(note.metadata) as Record<string, unknown>) : {};
      console.log(`  ${meta.display_id ?? id}: ${note.filePath}`);
    }
    // Check ingestion state
    const stateRaw = svc.db.getMetaValue('session_ingestion_state');
    if (stateRaw) {
      const state = JSON.parse(stateRaw) as { records: Record<string, unknown> };
      console.log(`Ingestion state: ${Object.keys(state.records).length} records`);
    }
    return;
  }

  // Delete notes from DB
  let deleted = 0;
  for (const [id, note] of notes) {
    try {
      svc.db.deleteNote(id);
      deleted++;
    } catch (err) {
      console.error(`Failed to delete ${id}: ${err}`);
    }

    // Delete markdown file
    if (note.filePath && existsSync(note.filePath)) {
      rmSync(note.filePath);
    }

    // Delete content directory
    const meta = note.metadata ? (JSON.parse(note.metadata) as Record<string, unknown>) : {};
    const displayId = meta.display_id as string;
    if (displayId) {
      const contentDir = join(svc.config.notesDir, 'modules', 'sessions', displayId);
      if (existsSync(contentDir)) {
        rmSync(contentDir, { recursive: true });
      }
    }
  }
  console.log(`Deleted ${deleted} session notes`);

  // Clear ingestion state
  svc.db.setMetaValue('session_ingestion_state', JSON.stringify({ records: {} }));
  console.log('Cleared ingestion state');

  // Clean up the sessions module directory (remove empty .md files)
  const sessionsDir = join(svc.config.notesDir, 'modules', 'sessions');
  if (existsSync(sessionsDir)) {
    console.log(`Session files dir: ${sessionsDir}`);
  }

  console.log('Done — session data cleaned');
});
