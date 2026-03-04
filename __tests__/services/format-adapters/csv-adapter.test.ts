import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  csvToMarkdownTable,
  detectCsvFlavor,
} from '../../../src/services/format-adapters/csv-adapter.js';

describe('parseCsv', () => {
  it('parses simple CSV', () => {
    const result = parseCsv('Name,Age\nAlice,30\nBob,25');
    expect(result.headers).toEqual(['Name', 'Age']);
    expect(result.rows).toEqual([
      ['Alice', '30'],
      ['Bob', '25'],
    ]);
  });

  it('handles quoted fields with commas', () => {
    const result = parseCsv('Name,Desc\n"Smith, John","A ""quoted"" value"');
    expect(result.rows[0]).toEqual(['Smith, John', 'A "quoted" value']);
  });

  it('handles CRLF line endings', () => {
    const result = parseCsv('A,B\r\n1,2\r\n3,4');
    expect(result.rows).toHaveLength(2);
  });

  it('handles empty CSV (headers only)', () => {
    const result = parseCsv('A,B,C');
    expect(result.headers).toEqual(['A', 'B', 'C']);
    expect(result.rows).toEqual([]);
  });

  it('trims whitespace from cells', () => {
    const result = parseCsv('A , B \n 1 , 2 ');
    expect(result.headers).toEqual(['A', 'B']);
    expect(result.rows[0]).toEqual(['1', '2']);
  });
});

describe('csvToMarkdownTable', () => {
  it('renders a markdown table', () => {
    const parsed = { headers: ['Name', 'Age'], rows: [['Alice', '30']] };
    const md = csvToMarkdownTable(parsed);
    expect(md).toContain('| Name | Age |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| Alice | 30 |');
  });

  it('escapes pipe characters in cells', () => {
    const parsed = { headers: ['A'], rows: [['a|b']] };
    const md = csvToMarkdownTable(parsed);
    expect(md).toContain('a\\|b');
  });
});

describe('detectCsvFlavor', () => {
  it('detects Linear CSV', () => {
    expect(detectCsvFlavor(['ID', 'Title', 'Status', 'Priority', 'Assignee'])).toBe('linear');
  });

  it('detects Notion database export', () => {
    expect(detectCsvFlavor(['Name', 'Tags', 'Status', 'Created time', 'Last edited time'])).toBe(
      'notion-db'
    );
  });

  it('returns generic for unknown headers', () => {
    expect(detectCsvFlavor(['foo', 'bar', 'baz'])).toBe('generic');
  });
});
