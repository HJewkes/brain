import { Command } from '@commander-js/extra-typings';
import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { withBrain } from '../services/brain-service.js';
import { parentResolveOpts } from '../services/config.js';
import { indexSingleFile } from '../services/indexing.js';
import { createHash } from 'node:crypto';
import type { NoteRecord, Relation } from '../types.js';
import type { BrainDB } from '../services/brain-db.js';

interface FilterClause {
  sql: string;
  params: string[];
}

interface SourceNote {
  id: string;
  file_path: string;
  title: string;
  type: string;
  tier: string;
  category: string | null;
  tags: string | null;
  summary: string | null;
  confidence: string | null;
  status: string;
  sources: string | null;
  created_at: string | null;
  modified_at: string | null;
  last_reviewed: string | null;
  review_interval: string | null;
  expires: string | null;
  metadata: string | null;
  module: string | null;
  module_instance: string | null;
  content_dir: string | null;
  l0_abstract: string | null;
  l1_overview: string | null;
}

interface SourceRelation {
  source_id: string;
  target_id: string;
  type: string;
}

interface ImportStats {
  imported: number;
  skipped: number;
  overwritten: number;
  collisions: string[];
  missingFiles: string[];
  relationsImported: number;
  relationsDangling: number;
  destNotesDir: string;
}

/** Parse "module=pm AND project=VNM AND type=task" into SQL fragments */
export function parseFilter(filter: string): FilterClause {
  const parts = filter
    .split(/\s+AND\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);

  const sqlParts: string[] = [];
  const params: string[] = [];

  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();

    switch (key) {
      case 'module':
        sqlParts.push('module = ?');
        params.push(value);
        break;
      case 'project':
        sqlParts.push("json_extract(metadata, '$.project') = ?");
        params.push(value);
        break;
      case 'type':
        sqlParts.push('type = ?');
        params.push(value);
        break;
      case 'tier':
        sqlParts.push('tier = ?');
        params.push(value);
        break;
      case 'status':
        sqlParts.push('status = ?');
        params.push(value);
        break;
      default:
        // Unknown key: skip silently
        break;
    }
  }

  return {
    sql: sqlParts.length > 0 ? sqlParts.join(' AND ') : '1=1',
    params,
  };
}

/** Detect the source brain's notesDir from config.json or file_path heuristics */
function detectSourceNotesDir(sourceDbPath: string, notes: SourceNote[]): string {
  const dbDir = dirname(sourceDbPath);

  // Try config.json next to the DB
  for (const candidate of [dbDir, join(dbDir, '..')]) {
    const configPath = join(resolve(candidate), 'config.json');
    if (existsSync(configPath)) {
      try {
        const cfg = JSON.parse(readFileSync(configPath, 'utf-8')) as { notesDir?: string };
        if (cfg.notesDir) return resolve(cfg.notesDir);
      } catch {
        // ignore parse errors
      }
    }
  }

  // Fall back: infer from the most common directory prefix across notes
  if (notes.length > 0) {
    const dirs = notes.map((n) => dirname(n.file_path));
    const prefix = commonPrefix(dirs);
    if (prefix.length > 1) return prefix;
    return dirname(notes[0].file_path);
  }

  return dbDir;
}

/** Find the longest common path prefix from a list of absolute paths */
function commonPrefix(paths: string[]): string {
  if (paths.length === 0) return '';
  const parts = paths[0].split('/');
  let prefix = '';
  for (let i = 0; i < parts.length; i++) {
    const candidate = parts.slice(0, i + 1).join('/');
    if (paths.every((p) => p.startsWith(candidate + '/'))) {
      prefix = candidate;
    } else {
      break;
    }
  }
  return prefix;
}

/** Determine destination file path for a source note */
function destinationPath(
  sourceFilePath: string,
  sourceNotesDir: string,
  destNotesDir: string
): string {
  let rel: string;
  try {
    rel = relative(sourceNotesDir, sourceFilePath);
    // If relative path escapes the source notes dir, use just the filename
    if (rel.startsWith('..')) {
      rel = sourceFilePath.split('/').pop() ?? 'imported.md';
    }
  } catch {
    rel = sourceFilePath.split('/').pop() ?? 'imported.md';
  }
  return join(destNotesDir, rel);
}

/** Convert a raw DB row to NoteRecord shape for destination DB */
function sourceRowToRecord(note: SourceNote, newFilePath: string): NoteRecord {
  return {
    id: note.id,
    filePath: newFilePath,
    title: note.title,
    type: note.type as NoteRecord['type'],
    tier: note.tier as NoteRecord['tier'],
    category: note.category,
    tags: note.tags,
    summary: note.summary,
    confidence: note.confidence as NoteRecord['confidence'],
    status: note.status as NoteRecord['status'],
    sources: note.sources,
    createdAt: note.created_at,
    modifiedAt: note.modified_at,
    lastReviewed: note.last_reviewed,
    reviewInterval: note.review_interval,
    expires: note.expires,
    metadata: note.metadata,
    module: note.module,
    moduleInstance: note.module_instance,
    contentDir: note.content_dir,
    l0Abstract: note.l0_abstract ?? null,
    l1Overview: note.l1_overview ?? null,
  };
}

/** Write a note into the destination DB, either with full re-embed or direct insert */
async function writeNoteToDestination(
  note: SourceNote,
  destFilePath: string,
  fileContent: string,
  db: BrainDB,
  embedder: Parameters<typeof indexSingleFile>[1] | null,
  noEmbed: boolean
): Promise<void> {
  if (noEmbed || embedder === null) {
    const record = sourceRowToRecord(note, destFilePath);
    db.upsertNote(record);
    return;
  }

  const hash = createHash('sha256').update(fileContent).digest('hex');
  await indexSingleFile(db, embedder, destFilePath, fileContent, hash, Date.now());
}

/** Query relations from source DB where both endpoints are in the imported set */
function querySourceRelations(sourceDb: Database.Database, noteIds: Set<string>): SourceRelation[] {
  if (noteIds.size === 0) return [];
  const placeholders = [...noteIds].map(() => '?').join(',');
  const params = [...noteIds];
  try {
    return sourceDb
      .prepare(
        `SELECT source_id, target_id, type FROM relations
         WHERE source_id IN (${placeholders})`
      )
      .all(...params) as SourceRelation[];
  } catch {
    return [];
  }
}

export const importInstanceCommand = new Command('import-instance')
  .description('Import notes from another brain database instance')
  .requiredOption('--from <path>', 'Path to source brain database file')
  .option('--filter <expr>', 'Filter notes (e.g. "module=pm AND project=VNM")')
  .option('--dry-run', 'Show what would be imported without writing anything')
  .option('--force', 'Overwrite notes with colliding IDs in destination')
  .option('--skip-collisions', 'Skip notes that already exist (default)')
  .option('--no-embed', 'Skip re-embedding; insert note records only')
  .action(async (opts, cmd) => {
    const resolveOpts = parentResolveOpts(cmd);
    const fromPath = resolve(opts.from);
    const dryRun = opts.dryRun ?? false;
    const force = opts.force ?? false;
    const noEmbed = opts['embed'] === false;

    if (!existsSync(fromPath)) {
      process.stderr.write(`Error: source database not found: ${fromPath}\n`);
      process.exitCode = 1;
      return;
    }

    let sourceDb: Database.Database;
    try {
      sourceDb = new Database(fromPath, { readonly: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: could not open source database: ${msg}\n`);
      process.exitCode = 1;
      return;
    }

    await withBrain(async ({ db, embedder, config }) => {
      const stats: ImportStats = {
        imported: 0,
        skipped: 0,
        overwritten: 0,
        collisions: [],
        missingFiles: [],
        relationsImported: 0,
        relationsDangling: 0,
        destNotesDir: config.notesDir,
      };

      // Query source notes
      const filterClause = opts.filter ? parseFilter(opts.filter) : { sql: '1=1', params: [] };
      let sourceNotes: SourceNote[];
      try {
        sourceNotes = sourceDb
          .prepare(`SELECT * FROM notes WHERE ${filterClause.sql}`)
          .all(...filterClause.params) as SourceNote[];
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: could not query source notes: ${msg}\n`);
        sourceDb.close();
        process.exitCode = 1;
        return;
      }

      if (sourceNotes.length === 0) {
        process.stdout.write('No notes matched the filter in the source database.\n');
        sourceDb.close();
        return;
      }

      const sourceNotesDir = detectSourceNotesDir(fromPath, sourceNotes);
      const importedNoteIds = new Set<string>();

      for (const note of sourceNotes) {
        const destFilePath = destinationPath(note.file_path, sourceNotesDir, config.notesDir);

        // Collision detection
        const existing = db.getNoteById(note.id);
        if (existing) {
          stats.collisions.push(note.id);
          if (!force) {
            stats.skipped++;
            if (dryRun) {
              process.stdout.write(`  [collision-skip] ${note.id}: ${note.title}\n`);
            }
            continue;
          }
          if (dryRun) {
            process.stdout.write(`  [collision-overwrite] ${note.id}: ${note.title}\n`);
            importedNoteIds.add(note.id);
            stats.overwritten++;
            continue;
          }
        }

        if (dryRun) {
          process.stdout.write(`  [import] ${note.id}: ${note.title} → ${destFilePath}\n`);
          importedNoteIds.add(note.id);
          stats.imported++;
          continue;
        }

        // Read the source file
        let fileContent: string;
        try {
          fileContent = readFileSync(note.file_path, 'utf-8');
        } catch {
          stats.missingFiles.push(note.file_path);
          process.stderr.write(
            `  [warn] Missing source file: ${note.file_path} — inserting DB record only\n`
          );
          // Insert DB record without file content
          const record = sourceRowToRecord(note, destFilePath);
          db.upsertNote(record);
          importedNoteIds.add(note.id);
          if (existing) stats.overwritten++;
          else stats.imported++;
          continue;
        }

        // Copy file to destination
        mkdirSync(dirname(destFilePath), { recursive: true });
        writeFileSync(destFilePath, fileContent, 'utf-8');

        // Insert into destination DB
        await writeNoteToDestination(
          note,
          destFilePath,
          fileContent,
          db,
          noEmbed ? null : embedder,
          noEmbed
        );

        importedNoteIds.add(note.id);
        if (existing) stats.overwritten++;
        else stats.imported++;
      }

      // Handle relations
      if (!dryRun && importedNoteIds.size > 0) {
        const sourceRelations = querySourceRelations(sourceDb, importedNoteIds);

        // Group by source note for upsertRelations
        const bySource = new Map<string, Relation[]>();
        for (const rel of sourceRelations) {
          // Only import if the target exists in destination (either already there or just imported)
          const targetExists =
            importedNoteIds.has(rel.target_id) || db.getNoteById(rel.target_id) !== null;
          if (!targetExists) {
            stats.relationsDangling++;
            continue;
          }
          if (!bySource.has(rel.source_id)) bySource.set(rel.source_id, []);
          bySource.get(rel.source_id)!.push({
            sourceId: rel.source_id,
            targetId: rel.target_id,
            type: rel.type,
          });
          stats.relationsImported++;
        }

        for (const [sourceId, relations] of bySource) {
          db.upsertRelations(sourceId, relations);
        }
      } else if (dryRun && importedNoteIds.size > 0) {
        const sourceRelations = querySourceRelations(sourceDb, importedNoteIds);
        for (const rel of sourceRelations) {
          const targetExists =
            importedNoteIds.has(rel.target_id) || db.getNoteById(rel.target_id) !== null;
          if (!targetExists) stats.relationsDangling++;
          else stats.relationsImported++;
        }
      }

      printReport(stats, dryRun, noEmbed);
    }, resolveOpts).finally(() => {
      sourceDb.close();
    });
  });

function printReport(stats: ImportStats, dryRun: boolean, noEmbed: boolean): void {
  const prefix = dryRun ? '[dry-run] ' : '';

  process.stdout.write(`\n${prefix}Import summary:\n`);
  process.stdout.write(`  Imported:             ${stats.imported}\n`);
  if (stats.overwritten > 0) {
    process.stdout.write(`  Overwritten:          ${stats.overwritten}\n`);
  }
  process.stdout.write(`  Skipped (collision):  ${stats.skipped}\n`);
  process.stdout.write(`  Relations imported:   ${stats.relationsImported}\n`);
  process.stdout.write(`  Relations dangling:   ${stats.relationsDangling} (skipped)\n`);

  if (stats.collisions.length > 0) {
    process.stdout.write(`\n  Collision IDs (${stats.collisions.length}):\n`);
    for (const id of stats.collisions.slice(0, 10)) {
      process.stdout.write(`    ${id}\n`);
    }
    if (stats.collisions.length > 10) {
      process.stdout.write(`    ... and ${stats.collisions.length - 10} more\n`);
    }
  }

  if (stats.missingFiles.length > 0) {
    process.stdout.write(`\n  Missing source files (${stats.missingFiles.length}):\n`);
    for (const f of stats.missingFiles.slice(0, 5)) {
      process.stdout.write(`    ${f}\n`);
    }
    if (stats.missingFiles.length > 5) {
      process.stdout.write(`    ... and ${stats.missingFiles.length - 5} more\n`);
    }
  }

  if (!dryRun) {
    process.stdout.write(`\n  Files copied to: ${stats.destNotesDir}\n`);
    if (noEmbed) {
      process.stdout.write(`  Embeddings skipped. Run 'brain index' to embed imported notes.\n`);
    }
  }
}
