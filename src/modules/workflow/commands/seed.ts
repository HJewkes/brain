import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { Command } from '@commander-js/extra-typings';
import type { BrainDB } from '../../../services/brain-db.js';
import { withBrain } from '../../../services/brain-service.js';
import { registerWorkflow } from '../data/workflow-ops.js';
import { listWorkflows } from '../data/queries.js';
import { indexSingleFile } from '../../../services/indexing.js';
import type { WorkflowDefinition } from '../types.js';

function findDefinitionsDir(): string {
  // Source layout: commands/seed.ts -> ../definitions/
  const sourceDir = join(import.meta.dirname, '..', 'definitions');
  if (existsSync(sourceDir)) return sourceDir;

  // Bundled layout: dist/*.js -> definitions/
  const bundledDir = join(import.meta.dirname, 'definitions');
  if (existsSync(bundledDir)) return bundledDir;

  return sourceDir;
}

function loadDefinitions(): Array<{ name: string; filename: string; definition: WorkflowDefinition }> {
  const dir = findDefinitionsDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((filename) => {
      const content = readFileSync(join(dir, filename), 'utf-8');
      const definition = JSON.parse(content) as WorkflowDefinition;
      return { name: definition.name, filename, definition };
    });
}

function fixDisplayId(db: BrainDB, oldDisplayId: string, newDisplayId: string): void {
  if (oldDisplayId === newDisplayId) return;
  const noteIds = db.getModuleNoteIds({ module: 'workflow', type: 'workflow' });
  const notes = db.getNotesByIds(noteIds);
  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.display_id === oldDisplayId) {
      const updated = { ...meta, display_id: newDisplayId };
      db.upsertNote({ ...note, metadata: JSON.stringify(updated) });
      return;
    }
  }
}

export function createSeedCommand(): Command {
  return new Command('seed')
    .description('Register built-in workflow definitions (idempotent)')
    .option('--json', 'Output JSON')
    .option('--force', 'Re-register even if already registered')
    .action(async (opts) => {
      const definitions = loadDefinitions();
      if (definitions.length === 0) {
        if (opts.json) {
          process.stdout.write(JSON.stringify({ seeded: [], skipped: [] }) + '\n');
        } else {
          process.stderr.write('No workflow definitions found\n');
        }
        return;
      }

      await withBrain(async (svc) => {
        const existingResult = listWorkflows(svc.db);
        const existingByName = new Map<string, string>();
        if (existingResult.ok) {
          for (const wf of existingResult.data) {
            existingByName.set(wf.name, wf.display_id);
          }
        }

        const notesDir = join(svc.config.notesDir, 'modules', 'workflow', 'definitions');
        mkdirSync(notesDir, { recursive: true });

        const seeded: Array<{ name: string; displayId: string; steps: number; edges: number }> = [];
        const skipped: string[] = [];

        for (const { name, filename, definition } of definitions) {
          const existingDisplayId = existingByName.get(name);
          if (existingDisplayId && !opts.force) {
            // Ensure display_id matches the workflow name for user-friendly lookup
            if (existingDisplayId !== name) {
              fixDisplayId(svc.db, existingDisplayId, name);
            }
            skipped.push(name);
            continue;
          }
          if (existingDisplayId && opts.force) {
            fixDisplayId(svc.db, existingDisplayId, name);
            skipped.push(name);
            continue;
          }

          const slug = basename(filename, '.json');
          const noteFilePath = join(notesDir, `${slug}.md`);
          const frontmatter = [
            '---',
            `id: "${definition.name}"`,
            `title: "${definition.name} workflow"`,
            'type: workflow',
            'module: workflow',
            `created: ${new Date().toISOString().slice(0, 10)}`,
            '---',
            '',
            JSON.stringify(definition, null, 2),
          ].join('\n');

          writeFileSync(noteFilePath, frontmatter, 'utf-8');

          const hash = createHash('sha256').update(frontmatter).digest('hex');
          const noteId = await indexSingleFile(
            svc.db,
            svc.embedder,
            noteFilePath,
            frontmatter,
            hash,
            Date.now()
          );

          if (!noteId) {
            process.stderr.write(`Failed to index ${filename}\n`);
            continue;
          }

          const regResult = await registerWorkflow(svc.db, svc.config, svc.embedder, noteId);
          if (!regResult.ok) {
            process.stderr.write(`Failed to register ${name}: ${regResult.error.message}\n`);
            continue;
          }

          seeded.push({
            name,
            displayId: regResult.data.display_id,
            steps: regResult.data.step_count,
            edges: regResult.data.edge_count,
          });
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify({ seeded, skipped }, null, 2) + '\n');
        } else {
          if (seeded.length > 0) {
            process.stdout.write(`Registered ${seeded.length} workflow(s):\n`);
            for (const s of seeded) {
              process.stdout.write(`  ${s.name} — ${s.steps} steps, ${s.edges} edges\n`);
            }
          }
          if (skipped.length > 0) {
            process.stdout.write(`Skipped ${skipped.length} (already registered): ${skipped.join(', ')}\n`);
          }
          if (seeded.length === 0 && skipped.length === 0) {
            process.stdout.write('Nothing to do\n');
          }
        }
      });
    });
}
