import { describe, it, expect } from 'vitest';
import {
  isNotionExport,
  cleanNotionMarkdown,
  extractNotionProperties,
} from '../../../src/services/format-adapters/notion-adapter.js';

describe('isNotionExport', () => {
  it('detects Notion UUID link pattern', () => {
    const content =
      'Check [My Page](https://www.notion.so/My-Page-abc123def456abc123def456abc123de)';
    expect(isNotionExport(content)).toBe(true);
  });

  it('detects Notion link without www prefix', () => {
    const content = 'See [Doc](https://notion.so/workspace/Doc-abc123def456abc123def456abc123de)';
    expect(isNotionExport(content)).toBe(true);
  });

  it('returns false for regular markdown', () => {
    const content = '# Hello\n\nThis is a normal doc.';
    expect(isNotionExport(content)).toBe(false);
  });

  it('returns false for non-Notion links', () => {
    const content = '[Link](https://example.com/some-page)';
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

  it('returns empty properties when no table found', () => {
    const content = '# Just a heading\n\nSome text.';
    const result = extractNotionProperties(content);
    expect(result.properties).toEqual({});
    expect(result.cleanedContent).toBe(content);
  });
});

describe('cleanNotionMarkdown', () => {
  it('normalizes Notion internal links to plain text', () => {
    const content =
      'See [Design Doc](https://www.notion.so/Design-Doc-abc123def456abc123def456abc123de)';
    const result = cleanNotionMarkdown(content);
    expect(result.markdown).toContain('Design Doc');
    expect(result.markdown).not.toContain('notion.so');
  });

  it('strips breadcrumb-style headers from Notion exports', () => {
    const content = `# Workspace / Team / My Page

## Real Section

Content here.`;
    const result = cleanNotionMarkdown(content);
    expect(result.markdown).toContain('My Page');
  });

  it('preserves non-breadcrumb headers', () => {
    const content = `# Simple Title

Some content.`;
    const result = cleanNotionMarkdown(content);
    expect(result.markdown).toContain('# Simple Title');
  });

  it('combines property extraction and link cleaning', () => {
    const content = `# Workspace / Project / My Note

| Property | Value |
| --- | --- |
| Status | Done |

See [Other Page](https://www.notion.so/Other-Page-abc123def456abc123def456abc123de) for details.`;

    const result = cleanNotionMarkdown(content);
    expect(result.extractedProperties).toEqual({ Status: 'Done' });
    expect(result.markdown).toContain('Other Page');
    expect(result.markdown).not.toContain('notion.so');
    expect(result.markdown).toContain('My Note');
  });
});
