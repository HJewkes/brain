import { Command } from '@commander-js/extra-typings';
import { existsSync, readFileSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig } from '../../../types.js';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import type { Result } from '../errors.js';
import { ok, fail } from '../errors.js';
import { getPmNotes, getProjectNotes, resolveProject } from '../data/queries.js';

interface DeleteResult {
  deletedCount: number;
  untrackedCount: number;
  deletedIds: string[];
}

interface DeleteOptions {
  confirm: boolean;
  all?: boolean;
}

export function projectDeleteWithActivity(
  db: BrainDB,
  config: BrainConfig,
  prefix: string,
  opts: DeleteOptions
): Result<DeleteResult> {
  if (!opts.confirm) {
    return fail(
      'INVALID_INPUT',
      'Deletion requires --confirm. This will delete the project and all associated notes.'
    );
  }

  const projectNotes = getPmNotes(db, 'project', { prefix });
  if (projectNotes.length === 0) {
    return fail('NOT_FOUND', `Project "${prefix}" not found.`);
  }

  const allProjectNotes = getProjectNotes(db, prefix);
  const activityNotes = getPmNotes(db, 'activity', { project: prefix });

  const trackedIds = new Set<string>();
  for (const activity of activityNotes) {
    const meta = JSON.parse(activity.metadata!) as Record<string, unknown>;
    const createdNotes = meta.created_notes as string[] | undefined;
    if (createdNotes) {
      for (const id of createdNotes) {
        trackedIds.add(id);
      }
    }
  }

  let notesToDelete = allProjectNotes;
  let untrackedCount = 0;

  if (!opts.all && activityNotes.length > 0) {
    const untracked = allProjectNotes.filter(
      (n) => !trackedIds.has(n.id) && n.type !== 'activity'
    );
    untrackedCount = untracked.length;
    // Delete all notes anyway (tracked + untracked), but report untracked count
    notesToDelete = allProjectNotes;
  }

  // Also delete activity notes themselves
  for (const activity of activityNotes) {
    if (!notesToDelete.find((n) => n.id === activity.id)) {
      notesToDelete.push(activity);
    }
  }

  const deletedIds: string[] = [];
  for (const note of notesToDelete) {
    db.deleteNote(note.id);
    if (existsSync(note.filePath)) {
      unlinkSync(note.filePath);
    }
    deletedIds.push(note.id);
  }

  const projectDir = join(config.notesDir, 'modules', 'pm', prefix);
  if (existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }

  return ok({
    deletedCount: deletedIds.length,
    untrackedCount,
    deletedIds,
  });
}

export function createActivityCommand(): Command {
  const cmd = new Command('activity').description('Manage activity notes');

  cmd
    .command('list')
    .description('List activity notes')
    .option('--project <prefix>', 'Filter by project prefix')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const filters: Record<string, unknown> = {};
        if (opts.project) {
          const resolved = resolveProject(svc.db, opts.project);
          if (!resolved.ok) {
            process.stderr.write(formatError(resolved.error, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }
          filters.project = resolved.data;
        }

        const notes = getPmNotes(svc.db, 'activity', filters);

        if (opts.json) {
          const jsonOut = notes.map((n) => {
            const meta = JSON.parse(n.metadata!) as Record<string, unknown>;
            return {
              id: n.id,
              project: meta.project,
              activityType: meta.activity_type,
              createdNotes: meta.created_notes ?? [],
              createdRelations: meta.created_relations ?? 0,
            };
          });
          process.stdout.write(JSON.stringify(jsonOut, null, 2) + '\n');
          return;
        }

        if (notes.length === 0) {
          process.stdout.write('No activity notes found.\n');
          return;
        }

        for (const note of notes) {
          const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
          const noteCount = Array.isArray(meta.created_notes)
            ? (meta.created_notes as string[]).length
            : 0;
          process.stdout.write(
            `${meta.project} ${meta.activity_type} — ${noteCount} notes created\n`
          );
        }
      });
    });

  cmd
    .command('show')
    .description('Show activity note details')
    .argument('<id>', 'Activity note ID')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const note = svc.db.getNoteById(id);
        if (!note || note.module !== 'pm' || note.type !== 'activity') {
          const msg = `Activity note "${id}" not found.`;
          process.stderr.write(
            formatError({ error: true, code: 'NOT_FOUND', message: msg }, !!opts.json) + '\n'
          );
          process.exitCode = 1;
          return;
        }

        const meta = JSON.parse(note.metadata!) as Record<string, unknown>;

        if (opts.json) {
          const jsonOut = {
            id: note.id,
            project: meta.project,
            activityType: meta.activity_type,
            createdNotes: meta.created_notes ?? [],
            createdRelations: meta.created_relations ?? 0,
            filePath: note.filePath,
          };
          process.stdout.write(JSON.stringify(jsonOut, null, 2) + '\n');
          return;
        }

        const lines: string[] = [];
        lines.push(`Activity: ${meta.activity_type} on ${meta.project}`);
        lines.push(`ID: ${note.id}`);

        const createdNotes = (meta.created_notes as string[] | undefined) ?? [];
        lines.push(`Created notes: ${createdNotes.length}`);
        for (const noteId of createdNotes) {
          lines.push(`  - ${noteId}`);
        }

        const relations = (meta.created_relations as number | undefined) ?? 0;
        lines.push(`Created relations: ${relations}`);

        if (existsSync(note.filePath)) {
          const content = readFileSync(note.filePath, 'utf-8');
          const fmEnd = content.indexOf('\n---', 4);
          if (fmEnd !== -1) {
            const body = content.slice(fmEnd + 4).trim();
            if (body) {
              lines.push('', body);
            }
          }
        }

        process.stdout.write(lines.join('\n') + '\n');
      });
    });

  return cmd;
}
