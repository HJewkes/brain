import { extname } from 'node:path';
import { parseCsv, csvToMarkdownTable, detectCsvFlavor } from './csv-adapter.js';
import type { CsvFlavor } from './csv-adapter.js';
import { isNotionExport, cleanNotionMarkdown } from './notion-adapter.js';
import { isLinearCsv } from './linear-adapter.js';

export type SupportedFormat = 'markdown' | 'csv' | 'plaintext' | 'notion' | 'linear';

export function detectFormat(filePath: string, content: string): SupportedFormat {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.csv') {
    const parsed = parseCsv(content);
    if (isLinearCsv(parsed.headers)) return 'linear';
    return 'csv';
  }
  if (ext === '.txt') return 'plaintext';
  if ((ext === '.md' || ext === '.markdown') && isNotionExport(content)) return 'notion';
  return 'markdown';
}

export interface ConvertResult {
  markdown: string;
  format: SupportedFormat;
  meta: {
    csvFlavor?: CsvFlavor;
    rowCount?: number;
    columnNames?: string[];
    notionProperties?: Record<string, string>;
  };
}

export function convertToMarkdown(filePath: string, content: string): ConvertResult {
  const format = detectFormat(filePath, content);

  if (format === 'csv') {
    const parsed = parseCsv(content);
    const flavor = detectCsvFlavor(parsed.headers);
    const title = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'Import';
    const table = csvToMarkdownTable(parsed);
    const markdown = `---\ntitle: "${title}"\ntype: note\ntier: fast\nstatus: draft\n---\n\n## ${title} (${parsed.rows.length} rows)\n\n${table}\n`;
    return {
      markdown,
      format,
      meta: { csvFlavor: flavor, rowCount: parsed.rows.length, columnNames: parsed.headers },
    };
  }

  if (format === 'linear') {
    const parsed = parseCsv(content);
    const title = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'Import';
    const table = csvToMarkdownTable(parsed);
    const markdown = `---\ntitle: "${title}"\ntype: note\ntier: fast\nstatus: draft\n---\n\n## ${title} (${parsed.rows.length} rows)\n\n${table}\n`;
    return {
      markdown,
      format,
      meta: { csvFlavor: 'linear' as CsvFlavor, rowCount: parsed.rows.length, columnNames: parsed.headers },
    };
  }

  if (format === 'notion') {
    const result = cleanNotionMarkdown(content, filePath);
    return { markdown: result.markdown, format, meta: { notionProperties: result.extractedProperties } };
  }

  if (format === 'plaintext') {
    const title = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'Import';
    const markdown = `---\ntitle: "${title}"\ntype: note\ntier: fast\nstatus: draft\n---\n\n${content}\n`;
    return { markdown, format, meta: {} };
  }

  return { markdown: content, format, meta: {} };
}
