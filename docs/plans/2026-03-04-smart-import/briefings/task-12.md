# Task 12: Notion/Linear Adapters

## Architectural Context

This task adds named format adapters that understand specific export formats from Notion and Linear. These are consumed by the format adapter factory (`src/services/format-adapters/index.ts`, created in Task 02). The Notion adapter cleans Notion markdown exports (UUID link patterns, embedded properties tables). The Linear adapter converts Linear CSV exports into structured task records that the PM content handler (Task 11) can consume. Both adapters integrate into the `detectFormat` / `convertToMarkdown` pipeline.

## File Ownership

**May modify:**
- `src/services/format-adapters/notion-adapter.ts` (new)
- `src/services/format-adapters/linear-adapter.ts` (new)
- `src/services/format-adapters/index.ts` (extend detection/routing)
- `src/types.ts` (add `'notion' | 'linear'` to `InboxSource`)
- `__tests__/services/format-adapters/notion-adapter.test.ts` (new)
- `__tests__/services/format-adapters/linear-adapter.test.ts` (new)

**Must not touch:**
- `src/services/format-adapters/csv-adapter.ts` — Task 02 owns this
- `src/modules/pm/content-handler.ts` — Task 11 owns this

**Read for context (do not modify):**
- `src/services/format-adapters/index.ts` — `detectFormat`, `convertToMarkdown` (Task 02)
- `src/services/format-adapters/csv-adapter.ts` — `parseCsv`, `detectCsvFlavor` (Task 02)
- `src/types.ts` — `InboxSource` union (L216-218), `VALID_INBOX_SOURCES` (L219)

## Steps

### Step 1: Write Notion adapter tests

Create `__tests__/services/format-adapters/notion-adapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  isNotionExport,
  cleanNotionMarkdown,
  extractNotionProperties,
} from '../../../src/services/format-adapters/notion-adapter.js';

describe('isNotionExport', () => {
  it('detects Notion UUID link pattern', () => {
    const content = 'Check [My Page](https://www.notion.so/My-Page-abc123def456abc123def456abc123de)';
    expect(isNotionExport(content)).toBe(true);
  });

  it('returns false for regular markdown', () => {
    const content = '# Hello\n\nThis is a normal doc.';
    expect(isNotionExport(content)).toBe(false);
  });
});

describe('extractNotionProperties', () => {
  it('extracts properties table from Notion export', () => {
    const content = `# My Page

| Property | Value |
| --- | --- |
| Status | In Progress |
| Priority | High |
| Assignee | Alice |

## Content

The actual content here.`;

    const result = extractNotionProperties(content);
    expect(result.properties).toEqual({
      Status: 'In Progress',
      Priority: 'High',
      Assignee: 'Alice',
    });
    expect(result.cleanedContent).toContain('The actual content here.');
    expect(result.cleanedContent).not.toContain('| Property |');
  });
});

describe('cleanNotionMarkdown', () => {
  it('normalizes Notion internal links to plain text', () => {
    const content = 'See [Design Doc](https://www.notion.so/Design-Doc-abc123def456abc123def456abc123de)';
    const result = cleanNotionMarkdown(content, 'test.md');
    expect(result.markdown).toContain('Design Doc');
    expect(result.markdown).not.toContain('notion.so');
  });

  it('strips breadcrumb-style headers from Notion exports', () => {
    const content = `# Workspace / Team / My Page

## Real Section

Content here.`;
    const result = cleanNotionMarkdown(content, 'test.md');
    expect(result.markdown).toContain('My Page');
  });
});
```

### Step 2: Implement Notion adapter

Create `src/services/format-adapters/notion-adapter.ts`:

```typescript
const NOTION_UUID_LINK = /\[([^\]]+)\]\(https?:\/\/(?:www\.)?notion\.so\/[^\s)]*[a-f0-9]{32}\)/g;
const NOTION_PROPERTIES_TABLE = /^\| Property \| Value \|\n\| --- \| --- \|\n((?:\|[^\n]+\|\n)*)/m;

export function isNotionExport(content: string): boolean {
  return NOTION_UUID_LINK.test(content);
}

export function extractNotionProperties(content: string): {
  properties: Record<string, string>;
  cleanedContent: string;
} {
  const match = content.match(NOTION_PROPERTIES_TABLE);
  if (!match) return { properties: {}, cleanedContent: content };

  const properties: Record<string, string> = {};
  const rows = match[1].trim().split('\n');
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2) {
      properties[cells[0]] = cells[1];
    }
  }

  const cleanedContent = content.replace(match[0], '').trim();
  return { properties, cleanedContent };
}

export function cleanNotionMarkdown(
  content: string,
  filePath: string
): { markdown: string; extractedProperties: Record<string, string> } {
  const { properties, cleanedContent } = extractNotionProperties(content);

  let markdown = cleanedContent;

  // Replace Notion internal links with plain text
  markdown = markdown.replace(NOTION_UUID_LINK, '$1');

  // Simplify breadcrumb headers (e.g., "# Workspace / Team / Page" → "# Page")
  markdown = markdown.replace(/^(#{1,3})\s+(?:[^/\n]+\s*\/\s*)*([^/\n]+)$/gm, '$1 $2');

  return { markdown: markdown.trim(), extractedProperties: properties };
}
```

### Step 3: Write Linear adapter tests

Create `__tests__/services/format-adapters/linear-adapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  isLinearCsv,
  linearCsvToTaskNotes,
  mapLinearPriority,
  mapLinearStatus,
} from '../../../src/services/format-adapters/linear-adapter.js';

describe('isLinearCsv', () => {
  it('detects Linear CSV by column names', () => {
    expect(isLinearCsv(['Title', 'Status', 'Priority', 'Assignee', 'Project'])).toBe(true);
  });

  it('returns false for generic CSV', () => {
    expect(isLinearCsv(['Name', 'Email', 'Phone'])).toBe(false);
  });
});

describe('mapLinearPriority', () => {
  it('maps Urgent to critical', () => expect(mapLinearPriority('Urgent')).toBe('critical'));
  it('maps High to high', () => expect(mapLinearPriority('High')).toBe('high'));
  it('maps Medium to medium', () => expect(mapLinearPriority('Medium')).toBe('medium'));
  it('maps Low to low', () => expect(mapLinearPriority('Low')).toBe('low'));
  it('maps No priority to medium', () => expect(mapLinearPriority('No priority')).toBe('medium'));
});

describe('mapLinearStatus', () => {
  it('maps Todo to pending', () => expect(mapLinearStatus('Todo')).toBe('pending'));
  it('maps In Progress to in-progress', () => expect(mapLinearStatus('In Progress')).toBe('in-progress'));
  it('maps Done to done', () => expect(mapLinearStatus('Done')).toBe('done'));
  it('maps Cancelled to cancelled', () => expect(mapLinearStatus('Cancelled')).toBe('cancelled'));
});

describe('linearCsvToTaskNotes', () => {
  it('converts rows to structured task records', () => {
    const parsed = {
      headers: ['Title', 'Status', 'Priority', 'Assignee', 'Description'],
      rows: [
        ['Fix login bug', 'In Progress', 'High', 'Alice', 'Login fails on mobile'],
        ['Add dark mode', 'Todo', 'Medium', 'Bob', 'Support dark theme'],
      ],
    };

    const tasks = linearCsvToTaskNotes(parsed);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual({
      title: 'Fix login bug',
      description: 'Login fails on mobile',
      priority: 'high',
      status: 'in-progress',
      assignee: 'Alice',
    });
  });
});
```

### Step 4: Implement Linear adapter

Create `src/services/format-adapters/linear-adapter.ts`:

```typescript
const LINEAR_COLUMNS = new Set(['title', 'status', 'priority', 'assignee', 'project', 'labels', 'estimate']);

export function isLinearCsv(headers: string[]): boolean {
  const lower = headers.map((h) => h.toLowerCase());
  const matches = lower.filter((h) => LINEAR_COLUMNS.has(h));
  return matches.length >= 3 && lower.includes('title') && lower.includes('status');
}

export interface LinearTaskRecord {
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: string;
  assignee: string;
}

export function mapLinearPriority(value: string): 'critical' | 'high' | 'medium' | 'low' {
  const lower = value.toLowerCase();
  if (lower === 'urgent') return 'critical';
  if (lower === 'high') return 'high';
  if (lower === 'low') return 'low';
  if (lower === 'medium') return 'medium';
  return 'medium'; // "No priority" and unknown values
}

export function mapLinearStatus(value: string): string {
  const lower = value.toLowerCase();
  if (lower === 'todo' || lower === 'backlog' || lower === 'triage') return 'pending';
  if (lower === 'in progress') return 'in-progress';
  if (lower === 'done' || lower === 'completed') return 'done';
  if (lower === 'cancelled' || lower === 'canceled') return 'cancelled';
  return lower;
}

export function linearCsvToTaskNotes(
  parsed: { headers: string[]; rows: string[][] }
): LinearTaskRecord[] {
  const headerMap = new Map<string, number>();
  for (let i = 0; i < parsed.headers.length; i++) {
    headerMap.set(parsed.headers[i].toLowerCase(), i);
  }

  const get = (row: string[], field: string): string => {
    const idx = headerMap.get(field);
    return idx !== undefined ? row[idx] ?? '' : '';
  };

  return parsed.rows.map((row) => ({
    title: get(row, 'title'),
    description: get(row, 'description'),
    priority: mapLinearPriority(get(row, 'priority')),
    status: mapLinearStatus(get(row, 'status')),
    assignee: get(row, 'assignee'),
  }));
}
```

### Step 5: Update format adapter index

In `src/services/format-adapters/index.ts`, extend `detectFormat` and `convertToMarkdown`:

- Import `isNotionExport`, `cleanNotionMarkdown` from `./notion-adapter.js`
- Import `isLinearCsv` from `./linear-adapter.js`
- In `detectFormat`: if extension is `.md` and `isNotionExport(content)`, return `'notion'`
- In `detectFormat`: if extension is `.csv` and `isLinearCsv(parseCsv(content).headers)`, return `'linear'`
- In `convertToMarkdown`: for `'notion'` format, use `cleanNotionMarkdown`
- For `'linear'`, use existing CSV-to-markdown conversion (Linear CSV is still a CSV, content handler does the task routing)

### Step 6: Add InboxSource values to types.ts

In `src/types.ts`, add `'notion'` and `'linear'` to the `InboxSource` type and `VALID_INBOX_SOURCES` array.

### Step 7: Run tests

Run: `npm run typecheck && npm test -- __tests__/services/format-adapters/`
Expected: PASS

### Step 8: Commit

```bash
git add src/services/format-adapters/notion-adapter.ts src/services/format-adapters/linear-adapter.ts src/services/format-adapters/index.ts src/types.ts __tests__/services/format-adapters/notion-adapter.test.ts __tests__/services/format-adapters/linear-adapter.test.ts
git commit -m "Add Notion and Linear format adapters"
```

## Success Criteria

- [ ] Types check: `npm run typecheck`
- [ ] Tests pass: `npm test -- __tests__/services/format-adapters/`
- [ ] No new lint warnings: `npm run lint`
- [ ] Notion UUID links detected and normalized
- [ ] Notion properties tables extracted as metadata
- [ ] Linear CSV detected by column patterns
- [ ] Linear priority/status values mapped to brain conventions
- [ ] Format adapter index routes to correct adapters

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT add features beyond what is specified in the steps
- Do NOT add npm dependencies — all parsing is hand-rolled
- Do NOT handle Notion database exports (future scope)
