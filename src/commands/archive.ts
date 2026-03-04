import { Command } from '@commander-js/extra-typings';
import { renameSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { withDb } from '../services/brain-service.js';
import { parentResolveOpts } from '../services/config.js';

export const archiveCommand = new Command('archive')
  .description('Move expired fast-tier notes to archive')
  .option('--dry-run', 'List files that would be archived without moving them')
  .action(async (opts, cmd) => {
    await withDb(({ db, config }) => {
      const notes = db.getAllNotes();
      const now = Date.now();

      const expired = notes.filter((n) => {
        if (n.tier !== 'fast') return false;
        if (!n.expires) return false;
        return new Date(n.expires).getTime() < now;
      });

      if (expired.length === 0) {
        process.stdout.write('No expired notes to archive.\n');
        return;
      }

      for (const note of expired) {
        const expiresDate = new Date(note.expires!);
        const yyyy = String(expiresDate.getFullYear());
        const archiveDir = join(config.notesDir, 'archive', yyyy);
        const filename = basename(note.filePath);
        const archivePath = join(archiveDir, filename);

        if (opts.dryRun) {
          process.stdout.write(`Would archive: ${note.filePath} → ${archivePath}\n`);
          continue;
        }

        if (!existsSync(archiveDir)) {
          mkdirSync(archiveDir, { recursive: true });
        }

        if (existsSync(note.filePath)) {
          renameSync(note.filePath, archivePath);
        }

        db.upsertNote({ ...note, filePath: archivePath });
      }

      const verb = opts.dryRun ? 'Would archive' : 'Archived';
      process.stdout.write(`${verb} ${expired.length} note${expired.length === 1 ? '' : 's'}.\n`);
    }, parentResolveOpts(cmd));
  });
