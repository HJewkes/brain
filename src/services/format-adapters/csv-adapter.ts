export interface CsvParsed {
  headers: string[];
  rows: string[][];
}

export function parseCsv(content: string): CsvParsed {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const result: string[][] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    result.push(parseRow(line));
  }

  if (result.length === 0) return { headers: [], rows: [] };
  const headers = result[0].map((h) => h.trim());
  const rows = result.slice(1).map((r) => r.map((c) => c.trim()));
  return { headers, rows };
}

function parseRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

export function csvToMarkdownTable(parsed: CsvParsed): string {
  const escape = (s: string) => s.replace(/\|/g, '\\|');
  const header = '| ' + parsed.headers.map(escape).join(' | ') + ' |';
  const separator = '| ' + parsed.headers.map(() => '---').join(' | ') + ' |';
  const rows = parsed.rows.map((r) => '| ' + r.map(escape).join(' | ') + ' |');
  return [header, separator, ...rows].join('\n');
}

const LINEAR_COLUMNS = new Set(['id', 'title', 'status', 'priority', 'assignee', 'labels', 'team', 'cycle', 'estimate']);
const NOTION_COLUMNS = new Set(['name', 'tags', 'status', 'created time', 'last edited time', 'url']);

export type CsvFlavor = 'linear' | 'notion-db' | 'generic';

export function detectCsvFlavor(headers: string[]): CsvFlavor {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const linearHits = lower.filter((h) => LINEAR_COLUMNS.has(h)).length;
  if (linearHits >= 3) return 'linear';
  const notionHits = lower.filter((h) => NOTION_COLUMNS.has(h)).length;
  if (notionHits >= 3) return 'notion-db';
  return 'generic';
}
