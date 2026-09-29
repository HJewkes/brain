import { Command } from '@commander-js/extra-typings';
import { resolveFormat } from './format.js';
import { formatOutput } from '../services/output-formatter.js';
import { withDb } from '../services/brain-service.js';
import type { BrainDB } from '../services/brain-db.js';
import type { InstancePaths } from '../services/config.js';
import { parseIntervalDays } from '../utils.js';
import { collectFullStatus, renderFullStatus } from './status-full.js';

export interface IndexSummary {
  instance: InstancePaths;
  totalNotes: number;
  totalChunks: number;
  byTier: Record<string, number>;
  byType: Record<string, number>;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  lastIndexed: string | null;
  staleNotes: number;
  staleNoteIds: string[];
}

export const statusCommand = new Command('status')
  .description('Show database statistics')
  .option('--json', 'output as JSON')
  .option('--full', 'show index, memory, inbox and PM sections')
  .action(async (opts, cmd) => {
    await withDb(({ db, instance }) => {
      const format = resolveFormat(opts, cmd);
      if (opts.full) {
        const full = collectFullStatus(db, () => collectIndexSummary(db, instance));
        process.stdout.write(
          format === 'json' ? JSON.stringify(full) + '\n' : renderFullStatus(full)
        );
        return;
      }

      const summary = collectIndexSummary(db, instance);
      if (format === 'json') {
        process.stdout.write(JSON.stringify(summary) + '\n');
      } else if (format === 'table') {
        process.stdout.write(formatOutput(summaryRows(summary), 'table') + '\n');
      } else {
        process.stderr.write(summaryText(summary));
      }
    });
  });

export function collectIndexSummary(db: BrainDB, instance: InstancePaths): IndexSummary {
  const notes = db.getAllNotes();
  const embeddingModel = db.getEmbeddingModel();

  const byTier: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const staleNoteIds: string[] = [];
  const now = new Date();

  for (const note of notes) {
    byTier[note.tier] = (byTier[note.tier] ?? 0) + 1;
    byType[note.type] = (byType[note.type] ?? 0) + 1;

    if (note.lastReviewed && note.reviewInterval) {
      const reviewed = new Date(note.lastReviewed);
      const intervalDays = parseIntervalDays(note.reviewInterval);
      const due = new Date(reviewed.getTime() + intervalDays * 86_400_000);
      if (due < now) {
        staleNoteIds.push(note.id);
      }
    }
  }

  let lastIndexed: number | null = null;
  for (const [, file] of db.getAllFiles()) {
    if (lastIndexed === null || file.indexedAt > lastIndexed) {
      lastIndexed = file.indexedAt;
    }
  }

  return {
    instance: { root: instance.root, isLocal: instance.isLocal, source: instance.source },
    totalNotes: notes.length,
    totalChunks: db.getChunkCount(),
    byTier,
    byType,
    embeddingModel: embeddingModel?.model ?? null,
    embeddingDimensions: embeddingModel?.dimensions ?? null,
    lastIndexed: lastIndexed ? new Date(lastIndexed).toISOString() : null,
    staleNotes: staleNoteIds.length,
    staleNoteIds,
  };
}

function instanceLabel(s: IndexSummary): string {
  return `${s.instance.isLocal ? 'local' : 'global'} (${s.instance.root})`;
}

function embeddingLabel(s: IndexSummary): string | null {
  return s.embeddingModel ? `${s.embeddingModel} (${s.embeddingDimensions}d)` : null;
}

function summaryRows(s: IndexSummary): { field: string; value: string }[] {
  return [
    { field: 'Instance', value: instanceLabel(s) },
    { field: 'Notes', value: String(s.totalNotes) },
    { field: 'Chunks', value: String(s.totalChunks) },
    { field: 'By tier', value: formatMap(s.byTier) },
    { field: 'By type', value: formatMap(s.byType) },
    { field: 'Embedding', value: embeddingLabel(s) ?? 'none' },
    { field: 'Last indexed', value: s.lastIndexed ?? 'never' },
    { field: 'Stale notes', value: String(s.staleNotes) },
  ];
}

function summaryText(s: IndexSummary): string {
  const lines = [
    `Instance: ${instanceLabel(s)}`,
    `Notes: ${s.totalNotes}`,
    `Chunks: ${s.totalChunks}`,
    `By tier: ${formatMap(s.byTier)}`,
    `By type: ${formatMap(s.byType)}`,
  ];
  const embedding = embeddingLabel(s);
  if (embedding) lines.push(`Embedding: ${embedding}`);
  if (s.lastIndexed) lines.push(`Last indexed: ${s.lastIndexed}`);
  if (s.staleNotes > 0) lines.push(`Stale notes needing review: ${s.staleNotes}`);
  return lines.map((line) => line + '\n').join('');
}

function formatMap(map: Record<string, number>): string {
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}
