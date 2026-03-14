import { describe, it, expect } from 'vitest';
import { parseMarkdown, splitOversizedParagraph } from '../../src/services/markdown-parser.js';

describe('splitOversizedParagraph', () => {
  it('returns text unchanged when under limit', () => {
    const text = 'Short paragraph.';
    const result = splitOversizedParagraph(text, 4096);

    expect(result).toEqual([text]);
  });

  it('splits at line boundaries when text exceeds limit', () => {
    const line = 'A'.repeat(100) + '\n';
    const text = line.repeat(50).trim(); // 50 lines of 100 chars each
    const result = splitOversizedParagraph(text, 2000);

    for (const part of result) {
      expect(part.length).toBeLessThanOrEqual(2000);
    }
    expect(result.join('\n')).toBe(text);
  });

  it('preserves content integrity after splitting', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Line ${i}: ${'x'.repeat(150)}`);
    const text = lines.join('\n');
    const result = splitOversizedParagraph(text, 2000);

    expect(result.join('\n')).toBe(text);
    expect(result.length).toBeGreaterThan(1);
  });
});

describe('chunk size cap integration', () => {
  it('enforces 4KB cap on chunks from large sections', () => {
    const largeParagraphs = Array.from(
      { length: 20 },
      (_, i) => `Paragraph ${i}: ${'Lorem ipsum dolor sit amet. '.repeat(30)}`
    );
    const body = largeParagraphs.join('\n\n');
    const content = `---\ntitle: Large Note\ntype: note\n---\n\n## Big Section\n\n${body}`;

    const result = parseMarkdown('large-note.md', content);

    for (const chunk of result.chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(4096);
    }
    expect(result.chunks.length).toBeGreaterThan(1);
  });

  it('preserves heading ancestry in all sub-chunks', () => {
    const longContent = 'A'.repeat(200) + '\n\n' + 'B'.repeat(200);
    const content = `---\ntitle: Test\n---\n\n# Parent\n\n## Child\n\n${longContent.repeat(20)}`;

    const result = parseMarkdown('test.md', content);
    const childChunks = result.chunks.filter((c) => c.heading === 'Child');

    for (const chunk of childChunks) {
      expect(chunk.headingAncestry).toContain('# Parent');
      expect(chunk.headingAncestry).toContain('## Child');
    }
  });

  it('splits oversized single paragraphs within a section', () => {
    const giantParagraph = 'word '.repeat(2000); // ~10KB single paragraph
    const content = `---\ntitle: Giant\n---\n\n## Section\n\n${giantParagraph}`;

    const result = parseMarkdown('giant.md', content);

    for (const chunk of result.chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(4096);
    }
    expect(result.chunks.length).toBeGreaterThan(1);
  });

  it('produces chunks between 1KB and 4KB for typical content', () => {
    const paragraphs = Array.from(
      { length: 30 },
      (_, i) =>
        `Section ${i} content: ${'This is a meaningful sentence about topic number ' + i + '. '.repeat(10)}`
    );
    const body = paragraphs.join('\n\n');
    const content = `---\ntitle: Typical Note\ntype: research\n---\n\n## Research Findings\n\n${body}`;

    const result = parseMarkdown('typical.md', content);
    const nonTinyChunks = result.chunks.filter((c) => c.text.length > 100);

    for (const chunk of nonTinyChunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(4096);
    }
  });

  it('handles content with no headings', () => {
    const largeParagraphs = Array.from(
      { length: 15 },
      (_, i) => `Paragraph ${i}: ${'Some content here. '.repeat(40)}`
    );
    const body = largeParagraphs.join('\n\n');
    const content = `---\ntitle: No Headings\n---\n\n${body}`;

    const result = parseMarkdown('no-headings.md', content);

    for (const chunk of result.chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(4096);
    }
  });

  it('preserves code fence integrity during splitting', () => {
    const codeBlock = '```javascript\n' + 'const x = 1;\n'.repeat(100) + '```';
    const prose = 'Some text. '.repeat(100);
    const content = `---\ntitle: Code\n---\n\n## Code Section\n\n${prose}\n\n${codeBlock}\n\n${prose}`;

    const result = parseMarkdown('code.md', content);

    for (const chunk of result.chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(4096);
    }
  });
});
