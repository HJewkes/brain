import { Command } from '@commander-js/extra-typings';
import { withDb } from '../../../services/brain-service.js';
import type { BrainDB } from '../../../services/brain-db.js';
import type { Relation } from '../../../types.js';

export interface RelateOptions {
  type?: string;
  remove?: boolean;
  json?: boolean;
}

export async function relateAction(
  db: BrainDB,
  source: string,
  target: string,
  opts: RelateOptions,
): Promise<{ ok: boolean; message: string }> {
  const relType = opts.type ?? 'related';

  const sourceNote = db.getNoteById(source);
  if (!sourceNote) {
    return { ok: false, message: `Source note not found: ${source}` };
  }
  const targetNote = db.getNoteById(target);
  if (!targetNote) {
    return { ok: false, message: `Target note not found: ${target}` };
  }

  const existing = db.getRelationsFrom(source);

  if (opts.remove) {
    const filtered = existing.filter(
      (r) => !(r.targetId === target && r.type === relType),
    );
    db.upsertRelations(source, filtered);
    return { ok: true, message: `Removed ${relType} relation: ${source} -> ${target}` };
  }

  const alreadyExists = existing.some(
    (r) => r.targetId === target && r.type === relType,
  );
  if (alreadyExists) {
    return { ok: true, message: `Relation already exists: ${source} -[${relType}]-> ${target}` };
  }

  const newRelation: Relation = {
    sourceId: source,
    targetId: target,
    type: relType,
  };
  db.upsertRelations(source, [...existing, newRelation]);
  return { ok: true, message: `Created ${relType} relation: ${source} -> ${target}` };
}

export function createRelateCommand() {
  return new Command('relate')
    .description('Create or remove a relation between two notes')
    .argument('<source>', 'Source note ID or display ID')
    .argument('<target>', 'Target note ID or display ID')
    .option('--type <type>', 'Relation type (related, depends_on, derived-from, parent)', 'related')
    .option('--remove', 'Remove the relation instead of creating it')
    .option('--json', 'Output JSON')
    .action(async (source, target, opts) => {
      await withDb(async ({ db }) => {
        const result = await relateAction(db, source, target, opts);
        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        } else {
          process.stdout.write(result.message + '\n');
        }
        if (!result.ok) {
          process.exitCode = 1;
        }
      });
    });
}
