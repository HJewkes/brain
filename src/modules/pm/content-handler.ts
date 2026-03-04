import type { ContentHandler } from '../../modules/types.js';
import type { ContentClass, Embedder } from '../../types.js';
import type { BrainDB } from '../../services/brain-db.js';
import type { ClassifiedSection } from '../../services/content-classifier.js';
import { indexSingleFile } from '../../services/indexing.js';
import { createHash } from 'node:crypto';
import { slugify } from '../../utils.js';

export class PmContentHandler implements ContentHandler {
  contentClasses: ContentClass[] = ['task-list'];

  canHandle(classification: ClassifiedSection): boolean {
    return classification.contentClass === 'task-list';
  }

  async materialize(
    db: BrainDB,
    embedder: Embedder,
    content: string,
    _classification: ClassifiedSection,
    sourceNoteId: string
  ): Promise<string[]> {
    const rows = parseTable(content);
    if (rows.length === 0) return [];

    const project = findActiveProject(db);
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

function findActiveProject(db: BrainDB): string | null {
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

function mapPriority(raw: string | undefined): string {
  if (!raw) return 'medium';
  const lower = raw.toLowerCase();
  if (['critical', 'urgent', 'p0'].includes(lower)) return 'critical';
  if (['high', 'p1'].includes(lower)) return 'high';
  if (['low', 'p3'].includes(lower)) return 'low';
  return 'medium';
}
