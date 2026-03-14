import { Command } from '@commander-js/extra-typings';
import { resolveFormat } from './format.js';
import { formatOutput } from '../services/output-formatter.js';
import { withDb } from '../services/brain-service.js';
import { parseIntervalDays } from '../utils.js';

export const statusCommand = new Command('status')
  .description('Show database statistics')
  .option('--json', 'output as JSON')
  .action(async (opts, cmd) => {
    await withDb(({ db, instance }) => {
      const notes = db.getAllNotes();
      const embeddingModel = db.getEmbeddingModel();

      const byTier: Record<string, number> = {};
      const byType: Record<string, number> = {};
      const staleNotes: string[] = [];
      const now = new Date();

      for (const note of notes) {
        byTier[note.tier] = (byTier[note.tier] ?? 0) + 1;
        byType[note.type] = (byType[note.type] ?? 0) + 1;

        if (note.lastReviewed && note.reviewInterval) {
          const reviewed = new Date(note.lastReviewed);
          const intervalDays = parseIntervalDays(note.reviewInterval);
          const due = new Date(reviewed.getTime() + intervalDays * 86_400_000);
          if (due < now) {
            staleNotes.push(note.id);
          }
        }
      }

      const files = db.getAllFiles();
      let lastIndexed: number | null = null;
      for (const [, file] of files) {
        if (lastIndexed === null || file.indexedAt > lastIndexed) {
          lastIndexed = file.indexedAt;
        }
      }

      const totalChunks = db.getChunkCount();

      const summary = {
        instance: {
          root: instance.root,
          isLocal: instance.isLocal,
          source: instance.source,
        },
        totalNotes: notes.length,
        totalChunks,
        byTier,
        byType,
        embeddingModel: embeddingModel?.model ?? null,
        embeddingDimensions: embeddingModel?.dimensions ?? null,
        lastIndexed: lastIndexed ? new Date(lastIndexed).toISOString() : null,
        staleNotes: staleNotes.length,
        staleNoteIds: staleNotes,
      };

      const format = resolveFormat(opts, cmd);

      if (format === 'json') {
        process.stdout.write(JSON.stringify(summary) + '\n');
      } else if (format === 'table') {
        const rows = [
          {
            field: 'Instance',
            value: `${instance.isLocal ? 'local' : 'global'} (${instance.root})`,
          },
          { field: 'Notes', value: String(notes.length) },
          { field: 'Chunks', value: String(totalChunks) },
          { field: 'By tier', value: formatMap(byTier) },
          { field: 'By type', value: formatMap(byType) },
          {
            field: 'Embedding',
            value: embeddingModel
              ? `${embeddingModel.model} (${embeddingModel.dimensions}d)`
              : 'none',
          },
          {
            field: 'Last indexed',
            value: lastIndexed ? new Date(lastIndexed).toISOString() : 'never',
          },
          { field: 'Stale notes', value: String(staleNotes.length) },
        ];
        process.stdout.write(formatOutput(rows, 'table') + '\n');
      } else {
        const instanceLabel = instance.isLocal ? 'local' : 'global';
        process.stderr.write(`Instance: ${instanceLabel} (${instance.root})\n`);
        process.stderr.write(`Notes: ${notes.length}\n`);
        process.stderr.write(`Chunks: ${totalChunks}\n`);
        process.stderr.write(`By tier: ${formatMap(byTier)}\n`);
        process.stderr.write(`By type: ${formatMap(byType)}\n`);
        if (embeddingModel) {
          process.stderr.write(
            `Embedding: ${embeddingModel.model} (${embeddingModel.dimensions}d)\n`
          );
        }
        if (lastIndexed) {
          process.stderr.write(`Last indexed: ${new Date(lastIndexed).toISOString()}\n`);
        }
        if (staleNotes.length > 0) {
          process.stderr.write(`Stale notes needing review: ${staleNotes.length}\n`);
        }
      }
    });
  });

function formatMap(map: Record<string, number>): string {
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}
