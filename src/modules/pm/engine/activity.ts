import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder, Relation } from '../../../types.js';
import { indexSingleFile } from '../../../services/indexing.js';
import type { ActivityType } from '../types.js';

interface ActivityInput {
  project: string;
  activityType: ActivityType;
  taskDisplayId: string;
  taskNoteId: string;
  fromState: string;
  toState: string;
  newlyEligible?: string[];
  summary?: string;
}

export async function createActivityNote(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  input: ActivityInput
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = `${input.project.toLowerCase()}-${input.activityType}-${input.taskDisplayId.toLowerCase()}-${timestamp}`;
  const activityPath = join(config.notesDir, 'modules', 'pm', input.project, `${slug}.md`);
  const dir = dirname(activityPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const now = new Date().toISOString();
  const fmLines = [
    '---',
    `id: ${slug}`,
    `title: "${capitalize(input.activityType)}: ${input.taskDisplayId} → ${input.toState}"`,
    'type: activity',
    'tier: slow',
    'module: pm',
    `project: ${input.project}`,
    `activity_type: ${input.activityType}`,
    `task_id: ${input.taskDisplayId}`,
    `from_state: ${input.fromState}`,
    `to_state: ${input.toState}`,
    'embed_status: queued',
    `created: ${now}`,
    `modified: ${now}`,
  ];

  if (input.newlyEligible && input.newlyEligible.length > 0) {
    fmLines.push('newly_eligible:');
    for (const id of input.newlyEligible) {
      fmLines.push(`  - ${id}`);
    }
  }

  fmLines.push('---', '', `# ${capitalize(input.activityType)}: ${input.taskDisplayId}`);

  if (input.summary) {
    fmLines.push('', input.summary);
  }

  const content = fmLines.join('\n');
  writeFileSync(activityPath, content, 'utf-8');

  const hash = createHash('sha256').update(content).digest('hex');
  const noteId = await indexSingleFile(db, embedder, activityPath, content, hash, Date.now());

  const relations: Relation[] = [
    { sourceId: noteId, targetId: input.taskNoteId, type: 'recorded_for' },
  ];

  if (input.newlyEligible) {
    for (const eligibleId of input.newlyEligible) {
      const allNotes = db.getAllNotes();
      const eligibleNote = allNotes.find(n => {
        const meta = JSON.parse(n.metadata ?? '{}');
        return meta.display_id === eligibleId;
      });
      if (eligibleNote) {
        relations.push({ sourceId: noteId, targetId: eligibleNote.id, type: 'unblocked' });
      }
    }
  }

  db.upsertRelations(noteId, relations);
  return noteId;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
