import type {
  ContentHandler,
  ContentHandlerV2,
} from '../../modules/types.js';
import type { BrainConfig, ContentClass, Embedder, ExtractedItem } from '../../types.js';
import type { BrainDB } from '../../services/brain-db.js';
import type { ClassifiedSection } from '../../services/content-classifier.js';
import type { TaskPriority, TaskCategory } from './types.js';
import { createTask } from './data/task-ops.js';
import { createProject } from './data/project-ops.js';
import { createWorkstream } from './data/workstream-ops.js';
import { getPmNotes } from './data/queries.js';
import { indexSingleFile } from '../../services/indexing.js';
import { createHash } from 'node:crypto';
import { slugify } from '../../utils.js';

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
 * PM content handler that implements both the new ContentHandler interface
 * (ExtractedItem[] batches) and the legacy ContentHandler interface
 * (raw content + classification) for backward compatibility.
 */
export class PmContentHandler implements ContentHandlerV2, ContentHandler {
  // New interface (ContentHandlerV2)
  noteTypes: string[] = ['task'];

  // Legacy interface (ContentHandler)
  contentClasses: ContentClass[] = ['task-list'];

  private config: BrainConfig | null = null;

  setConfig(config: BrainConfig): void {
    this.config = config;
  }

  // --- New ContentHandler interface ---

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canHandle(noteTypeOrClassification: string | ClassifiedSection, _content?: string): boolean {
    if (typeof noteTypeOrClassification === 'string') {
      return noteTypeOrClassification === 'task';
    }
    return noteTypeOrClassification.contentClass === 'task-list';
  }

  async materialize(
    db: BrainDB,
    embedder: Embedder,
    itemsOrContent: ExtractedItem[] | string,
    classificationOrSourceNoteId: ClassifiedSection | string,
    sourceNoteId?: string
  ): Promise<string[]> {
    if (Array.isArray(itemsOrContent)) {
      return this.materializeItems(
        db,
        embedder,
        itemsOrContent,
        classificationOrSourceNoteId as string
      );
    }
    return this.materializeLegacy(
      db,
      embedder,
      itemsOrContent,
      classificationOrSourceNoteId as ClassifiedSection,
      sourceNoteId!
    );
  }

  private async materializeItems(
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

  // --- Legacy ContentHandler interface ---

  private async materializeLegacy(
    db: BrainDB,
    embedder: Embedder,
    content: string,
    _classification: ClassifiedSection,
    sourceNoteId: string
  ): Promise<string[]> {
    const rows = parseTable(content);
    if (rows.length === 0) return [];

    const project = findActiveProjectPrefix(db);
    const noteIds: string[] = [];

    for (const row of rows) {
      const title = row.get('title') ?? row.get('name') ?? 'Task from import';
      const status = row.get('status') ?? 'pending';
      const priority = mapPriority(row.get('priority'));
      const id = slugify(title);
      const now = new Date().toISOString().slice(0, 10);

      const lines = [
        '---',
        `id: ${id}`,
        `title: "${title.replace(/"/g, '\\"')}"`,
        'type: note',
        'tier: fast',
        'status: draft',
        `created: ${now}`,
        `modified: ${now}`,
        `import_status: "${status}"`,
        `import_priority: "${priority}"`,
      ];

      if (project) {
        lines.push('module: pm');
        lines.push(`project: ${project}`);
      }

      lines.push('---', '', `# ${title}`, '');

      for (const [key, value] of row.entries()) {
        if (!['title', 'name', 'status', 'priority'].includes(key)) {
          lines.push(`**${key}:** ${value}`);
        }
      }

      const markdown = lines.join('\n') + '\n';
      const hash = createHash('sha256').update(markdown).digest('hex');
      const noteId = await indexSingleFile(
        db,
        embedder,
        `import-task-${id}.md`,
        markdown,
        hash,
        Date.now()
      );

      db.upsertRelations(noteId, [
        { sourceId: noteId, targetId: sourceNoteId, type: 'derived-from' },
      ]);
      noteIds.push(noteId);
    }

    return noteIds;
  }
}

function parseTable(content: string): Map<string, string>[] {
  const lines = content.split('\n').filter((l) => l.trim().startsWith('|'));
  if (lines.length < 3) return [];

  const headers = lines[0]
    .split('|')
    .map((h) => h.trim())
    .filter(Boolean)
    .map((h) => h.toLowerCase());

  const rows: Map<string, string>[] = [];
  for (let i = 2; i < lines.length; i++) {
    const cells = lines[i]
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    const row = new Map<string, string>();
    for (let j = 0; j < headers.length && j < cells.length; j++) {
      row.set(headers[j], cells[j]);
    }
    rows.push(row);
  }
  return rows;
}
