import type { ContentHandler } from '../../modules/types.js';
import type { BrainConfig, Embedder, ExtractedItem } from '../../types.js';
import type { BrainDB } from '../../services/brain-db.js';
import type { TaskPriority, TaskCategory } from './types.js';
import { createTask } from './data/task-ops.js';
import { createProject } from './data/project-ops.js';
import { createWorkstream } from './data/workstream-ops.js';
import { getPmNotes } from './data/queries.js';

const VALID_CATEGORIES: TaskCategory[] = [
  'implementation',
  'testing',
  'documentation',
  'research',
  'review',
  'infrastructure',
  'configuration',
  'design',
  'migration',
];

export function mapPriority(raw: string | undefined): TaskPriority {
  if (!raw) return 'medium';
  const lower = raw.toLowerCase();
  if (['critical', 'urgent', 'p0'].includes(lower)) return 'critical';
  if (['high', 'p1'].includes(lower)) return 'high';
  if (['low', 'p3'].includes(lower)) return 'low';
  return 'medium';
}

function mapCategory(raw: string | undefined): TaskCategory {
  if (!raw) return 'implementation';
  const lower = raw.toLowerCase() as TaskCategory;
  if (VALID_CATEGORIES.includes(lower)) return lower;
  return 'implementation';
}

function findActiveProjectPrefix(db: BrainDB): string | null {
  try {
    const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'project' });
    if (noteIds.length === 0) return null;

    const notes = db.getNotesByIds(noteIds);
    for (const [, note] of notes) {
      if (!note.metadata) continue;
      const meta = JSON.parse(note.metadata) as Record<string, unknown>;
      if (meta.status === 'active' && typeof meta.prefix === 'string') {
        return meta.prefix;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function ensureProjectAndWorkstream(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder
): Promise<{ prefix: string; workstream: number }> {
  let prefix = findActiveProjectPrefix(db);

  if (!prefix) {
    prefix = 'IMPT';
    const result = await createProject(db, config, embedder, {
      name: 'Imported',
      prefix,
    });
    if (!result.ok && result.error.code !== 'PROJECT_EXISTS') {
      throw new Error(`Failed to create import project: ${result.error.message}`);
    }
  }

  const workstreams = getPmNotes(db, 'workstream', { project: prefix });
  if (workstreams.length > 0) {
    const meta = JSON.parse(workstreams[0].metadata!) as Record<string, unknown>;
    return { prefix, workstream: meta.number as number };
  }

  const wsResult = await createWorkstream(db, config, embedder, {
    project: prefix,
    name: 'General',
  });
  if (!wsResult.ok) {
    throw new Error(`Failed to create workstream: ${wsResult.error.message}`);
  }
  return { prefix, workstream: wsResult.data.number };
}

/**
 * PM content handler that materializes extracted task items into PM notes.
 */
export class PmContentHandler implements ContentHandler {
  noteTypes: string[] = ['task'];

  private config: BrainConfig | null = null;

  setConfig(config: BrainConfig): void {
    this.config = config;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canHandle(noteType: string, _content: string): boolean {
    return noteType === 'task';
  }

  async materialize(
    db: BrainDB,
    embedder: Embedder,
    items: ExtractedItem[],
    sourceNoteId: string
  ): Promise<string[]> {
    if (items.length === 0) return [];
    if (!this.config) {
      throw new Error('PmContentHandler requires config — call setConfig() before materialize()');
    }

    const { prefix, workstream } = await ensureProjectAndWorkstream(
      db,
      this.config,
      embedder
    );

    const noteIds: string[] = [];

    for (const item of items) {
      const name = item.fields.name || item.title || 'Imported task';
      const description = item.fields.description || item.content || name;
      const priority = mapPriority(item.fields.priority);
      const category = mapCategory(item.fields.category);
      const dueDate = item.fields.due_date || undefined;

      const result = await createTask(db, this.config, embedder, {
        project: prefix,
        workstream,
        name,
        description,
        priority,
        category,
        dueDate,
      });

      if (!result.ok) {
        continue;
      }

      const taskDisplayId = result.data.display_id;
      const taskNotes = getPmNotes(db, 'task', { display_id: taskDisplayId });
      if (taskNotes.length > 0) {
        const noteId = taskNotes[0].id;
        db.upsertRelations(noteId, [
          { sourceId: noteId, targetId: sourceNoteId, type: 'derived-from' },
        ]);
        noteIds.push(noteId);
      }
    }

    return noteIds;
  }
}
