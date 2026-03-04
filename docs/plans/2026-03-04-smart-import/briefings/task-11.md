# Task 11: PM Content Handler for Task-List

## Architectural Context

This task registers a `ContentHandler` in the PM module that claims `task-list` content during import. When the import command (Task 10) encounters a section classified as `task-list`, it checks registered content handlers. The PM handler parses the table rows and creates individual PM task notes using the existing `createTask` data layer (`src/modules/pm/data/task-ops.ts`). This makes PM discoverable without explicit user invocation — importing a CSV with task columns automatically creates PM tasks if a project exists.

The PM module already registers note types, relation types, commands, etc. in `src/modules/pm/index.ts`. This adds one more registration: `ctx.registerContentHandler(handler)`.

## File Ownership

**May modify:**
- `src/modules/pm/content-handler.ts` (new)
- `src/modules/pm/index.ts` (add handler registration)
- `__tests__/modules/pm/content-handler.test.ts` (new)

**Must not touch:**
- `src/modules/types.ts` — Task 09 owns this
- `src/modules/registry.ts` — Task 09 owns this
- `src/commands/import.ts` — Task 10 owns this
- `src/modules/pm/data/task-ops.ts` — existing, read only

**Read for context (do not modify):**
- `src/modules/pm/data/task-ops.ts` — `CreateTaskInput` interface (L40-54), `buildTaskMarkdown` (L64-117)
- `src/modules/pm/index.ts` — existing registration pattern (L34-439), PM note type schemas
- `src/modules/types.ts` — `ContentHandler` interface (added by Task 09)
- `src/services/content-classifier.ts` — `ClassifiedSection` interface
- `src/modules/pm/data/queries.ts` — `getPmNotes` for finding active projects

## Steps

### Step 1: Write failing tests

Create `__tests__/modules/pm/content-handler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PmContentHandler } from '../../../src/modules/pm/content-handler.js';
import type { BrainDB } from '../../../src/services/brain-db.js';
import type { Embedder } from '../../../src/types.js';
import type { ClassifiedSection } from '../../../src/services/content-classifier.js';

const mockDb = {
  upsertNote: vi.fn(),
  upsertRelations: vi.fn(),
  upsertChunks: vi.fn(),
  deleteChunksForNote: vi.fn(),
  upsertFts: vi.fn(),
  upsertFile: vi.fn(),
  getMetaValue: vi.fn().mockReturnValue('1'),
  getAllNotes: vi.fn().mockReturnValue([]),
  getChunkCount: vi.fn().mockReturnValue(0),
  getNotesByModule: vi.fn().mockReturnValue([
    { id: 'proj-1', metadata: { prefix: 'TEST', status: 'active' }, frontmatter: { type: 'project', module: 'pm' } },
  ]),
} as unknown as BrainDB;

const mockEmbedder: Embedder = {
  embed: vi.fn().mockResolvedValue([[0, 0, 0]]),
  model: 'test',
  dimensions: 3,
};

describe('PmContentHandler', () => {
  let handler: PmContentHandler;

  beforeEach(() => {
    handler = new PmContentHandler();
    vi.clearAllMocks();
  });

  it('claims task-list content class', () => {
    expect(handler.contentClasses).toContain('task-list');
  });

  it('canHandle returns true for task-list with table content', () => {
    const section: ClassifiedSection = {
      content: '| Title | Status | Priority |\n| --- | --- | --- |\n| Fix bug | Open | High |',
      contentClass: 'task-list',
      confidence: 0.9,
      method: 'deterministic',
      heading: 'Tasks',
    };
    expect(handler.canHandle(section)).toBe(true);
  });

  it('canHandle returns false for non-task-list content', () => {
    const section: ClassifiedSection = {
      content: 'Some architecture text',
      contentClass: 'architecture',
      confidence: 0.8,
      method: 'deterministic',
      heading: 'Architecture',
    };
    expect(handler.canHandle(section)).toBe(false);
  });

  it('parses table rows into task creation calls', async () => {
    const content = `| Title | Status | Priority | Assignee |
| --- | --- | --- | --- |
| Fix login bug | Open | High | Alice |
| Add tests | Done | Medium | Bob |`;

    const section: ClassifiedSection = {
      content,
      contentClass: 'task-list',
      confidence: 0.9,
      method: 'deterministic',
      heading: 'Tasks',
    };

    const ids = await handler.materialize(mockDb, mockEmbedder, content, section, 'source-note-1');
    expect(ids.length).toBeGreaterThan(0);
  });
});
```

### Step 2: Implement PM content handler

Create `src/modules/pm/content-handler.ts`:

```typescript
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
    classification: ClassifiedSection,
    sourceNoteId: string,
    schemaMapping?: Record<string, string>
  ): Promise<string[]> {
    const rows = this.parseTable(content);
    if (rows.length === 0) return [];

    // Find an active PM project to attach tasks to
    const project = this.findActiveProject(db);

    const noteIds: string[] = [];
    for (const row of rows) {
      const title = row.get('title') ?? row.get('name') ?? `Task from import`;
      const status = row.get('status') ?? 'pending';
      const priority = this.mapPriority(row.get('priority'));

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
        lines.push(`module: pm`);
        lines.push(`project: ${project}`);
      }

      lines.push('---', '', `# ${title}`, '');

      // Add remaining fields as body content
      for (const [key, value] of row.entries()) {
        if (!['title', 'name', 'status', 'priority'].includes(key)) {
          lines.push(`**${key}:** ${value}`);
        }
      }

      const markdown = lines.join('\n') + '\n';
      const hash = createHash('sha256').update(markdown).digest('hex');
      const noteId = await indexSingleFile(db, embedder, `import-task-${id}.md`, markdown, hash, Date.now());

      db.upsertRelations(noteId, [{ sourceId: noteId, targetId: sourceNoteId, type: 'derived-from' }]);
      noteIds.push(noteId);
    }

    return noteIds;
  }

  private parseTable(content: string): Map<string, string>[] {
    const lines = content.split('\n').filter((l) => l.trim().startsWith('|'));
    if (lines.length < 3) return []; // need header + separator + at least 1 row

    const headers = lines[0]
      .split('|')
      .map((h) => h.trim())
      .filter(Boolean)
      .map((h) => h.toLowerCase());

    // Skip separator line (index 1)
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

  private findActiveProject(db: BrainDB): string | null {
    try {
      const notes = db.getNotesByModule('pm');
      const project = notes.find(
        (n) => n.frontmatter?.type === 'project' && n.metadata?.status === 'active'
      );
      return (project?.metadata?.prefix as string) ?? null;
    } catch {
      return null;
    }
  }

  private mapPriority(raw: string | undefined): string {
    if (!raw) return 'medium';
    const lower = raw.toLowerCase();
    if (['critical', 'urgent', 'p0'].includes(lower)) return 'critical';
    if (['high', 'p1'].includes(lower)) return 'high';
    if (['low', 'p3'].includes(lower)) return 'low';
    return 'medium';
  }
}
```

### Step 3: Register handler in PM module

In `src/modules/pm/index.ts`, add after the existing registrations (after `ctx.registerFilter({ visibility: 'private' });` around line 261):

```typescript
import { PmContentHandler } from './content-handler.js';

// Inside register(ctx):
ctx.registerContentHandler(new PmContentHandler());
```

### Step 4: Run typecheck and tests

Run: `npm run typecheck && npm test -- __tests__/modules/pm/content-handler.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/modules/pm/content-handler.ts src/modules/pm/index.ts __tests__/modules/pm/content-handler.test.ts
git commit -m "Register PM content handler for task-list content class"
```

## Success Criteria

- [ ] Types check: `npm run typecheck`
- [ ] Tests pass: `npm test -- __tests__/modules/pm/content-handler.test.ts`
- [ ] No new lint warnings: `npm run lint`
- [ ] PM handler claims `task-list` content class
- [ ] Table rows parsed into individual task notes
- [ ] `derived-from` relations created from tasks to source note
- [ ] Active PM project auto-detected and linked when available

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT add features beyond what is specified in the steps
- Do NOT use the full PM `createTask` pipeline — create lightweight notes that can be promoted later
- Do NOT make real embedder calls in tests — mock the embedder
