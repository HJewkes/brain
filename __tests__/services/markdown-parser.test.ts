import { describe, it, expect } from 'vitest';
import {
  parseMarkdown,
  estimateTokens,
  coerceFrontmatter,
} from '../../src/services/markdown-parser.js';

describe('estimateTokens', () => {
  it('estimates tokens as ceil(length / 4)', () => {
    expect(estimateTokens('a'.repeat(2000))).toBe(500);
    expect(estimateTokens('hello')).toBe(2);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(5))).toBe(2);
  });
});

describe('parseMarkdown — frontmatter extraction', () => {
  it('extracts all known frontmatter fields', () => {
    const content = `---
title: React Server Components
type: research
tier: fast
category: frontend
tags: [react, rsc]
summary: How RSC works
confidence: high
status: current
related: [hooks-deep-dive, next-app-router]
supersedes: old-rsc-note
parent: react-ecosystem
---

Body text here.
`;
    const result = parseMarkdown('react-server-components.md', content);
    expect(result.frontmatter.title).toBe('React Server Components');
    expect(result.frontmatter.type).toBe('research');
    expect(result.frontmatter.tier).toBe('fast');
    expect(result.frontmatter.category).toBe('frontend');
    expect(result.frontmatter.tags).toEqual(['react', 'rsc']);
    expect(result.frontmatter.summary).toBe('How RSC works');
    expect(result.frontmatter.confidence).toBe('high');
    expect(result.frontmatter.status).toBe('current');
  });

  it('derives id from title when no explicit id in frontmatter', () => {
    const content = `---
title: My Note
type: note
tier: slow
---

Content.
`;
    const result = parseMarkdown('react-server-components.md', content);
    expect(result.id).toBe('my-note');
  });

  it('falls back to filename slug when no id or title in frontmatter', () => {
    const content = `---
type: note
tier: slow
---

Content.
`;
    const result = parseMarkdown('react-server-components.md', content);
    expect(result.id).toBe('react-server-components');
  });

  it('uses frontmatter id when provided', () => {
    const content = `---
id: custom-id
title: My Note
type: note
tier: slow
---

Content.
`;
    const result = parseMarkdown('some-file.md', content);
    expect(result.id).toBe('custom-id');
  });

  it('drops unknown fields from frontmatter', () => {
    const content = `---
title: My Note
type: note
tier: slow
customField: custom-value
anotherField: 42
---

Content.
`;
    const result = parseMarkdown('note.md', content);
    expect('customField' in result.frontmatter).toBe(false);
    expect('anotherField' in result.frontmatter).toBe(false);
  });

  it('produces sensible defaults for missing required fields', () => {
    const content = `---
category: misc
---

Content.
`;
    const result = parseMarkdown('my-great-note.md', content);
    expect(result.frontmatter.title).toBe('my-great-note');
    expect(result.frontmatter.type).toBe('note');
    expect(result.frontmatter.tier).toBe('slow');
  });

  it('stores filePath on the result', () => {
    const content = `---
title: Test
type: note
tier: slow
---

Body.
`;
    const result = parseMarkdown('notes/test.md', content);
    expect(result.filePath).toBe('notes/test.md');
  });

  it('stores body content without frontmatter', () => {
    const content = `---
title: Test
type: note
tier: slow
---

Body text only.
`;
    const result = parseMarkdown('test.md', content);
    expect(result.content).toBe('\nBody text only.\n');
    expect(result.content).not.toContain('---');
    expect(result.content).not.toContain('title:');
  });
});

describe('parseMarkdown — heading-aware chunking', () => {
  it('splits H2 sections into separate chunks', () => {
    const content = `---
title: Test
type: note
tier: slow
---

## Section One

Content of section one with enough text to be meaningful and pass the minimum threshold.

## Section Two

Content of section two with enough text to be meaningful and pass the minimum threshold.
`;
    const result = parseMarkdown('test.md', content);
    expect(result.chunks.length).toBe(2);
    expect(result.chunks[0].heading).toBe('Section One');
    expect(result.chunks[1].heading).toBe('Section Two');
  });

  it('treats H1, H2, H3 as split boundaries', () => {
    const content = `---
title: Test
type: note
tier: slow
---

# Heading One

Enough content here to be a meaningful chunk for heading one section text.

## Heading Two

Enough content here to be a meaningful chunk for heading two section text.

### Heading Three

Enough content here to be a meaningful chunk for heading three section text.
`;
    const result = parseMarkdown('test.md', content);
    expect(result.chunks.length).toBe(3);
    expect(result.chunks[0].heading).toBe('Heading One');
    expect(result.chunks[1].heading).toBe('Heading Two');
    expect(result.chunks[2].heading).toBe('Heading Three');
  });

  it('creates a null-heading chunk for content before first heading', () => {
    const content = `---
title: Test
type: note
tier: slow
---

This is introductory content that appears before any heading in the document.

## First Section

Section content with enough text to be meaningful and pass the minimum threshold.
`;
    const result = parseMarkdown('test.md', content);
    expect(result.chunks[0].heading).toBeNull();
    expect(result.chunks[0].text).toContain('introductory content');
    expect(result.chunks[1].heading).toBe('First Section');
  });

  it('skips empty sections (content < 20 chars)', () => {
    const content = `---
title: Test
type: note
tier: slow
---

## Non-empty Section

This section has enough content to be included as a meaningful chunk in results.

## Empty Section

tiny

## Another Section

This section also has enough content to be included as a meaningful chunk in results.
`;
    const result = parseMarkdown('test.md', content);
    const headings = result.chunks.map((c) => c.heading);
    expect(headings).toContain('Non-empty Section');
    expect(headings).toContain('Another Section');
    expect(headings).not.toContain('Empty Section');
  });
});

describe('parseMarkdown — code fence protection', () => {
  it('does not split inside a fenced code block', () => {
    const longCode = 'const x = 1;\n'.repeat(200); // >600 tokens worth
    const content = `---
title: Test
type: note
tier: slow
---

## Code Section

Here is some code:

\`\`\`typescript
${longCode}\`\`\`

After the code block.
`;
    const result = parseMarkdown('test.md', content);
    const codeChunks = result.chunks.filter((c) => c.heading === 'Code Section');
    // The code block should remain atomic in at least one chunk
    const hasFullCode = codeChunks.some((c) => c.text.includes('```typescript'));
    expect(hasFullCode).toBe(true);
  });

  it('detects triple-backtick fences with language markers', () => {
    const longCode = '// line\n'.repeat(200);
    const content = `---
title: Test
type: note
tier: slow
---

## Example

\`\`\`javascript
${longCode}\`\`\`

More text after with enough content to be a chunk on its own here.
`;
    const result = parseMarkdown('test.md', content);
    const chunk = result.chunks.find((c) => c.text.includes('```javascript'));
    expect(chunk).toBeDefined();
    expect(chunk!.text).toContain('```');
  });
});

describe('parseMarkdown — paragraph splitting of oversized sections', () => {
  it('splits oversized sections at paragraph boundaries', () => {
    const paragraph =
      'This is a paragraph with some meaningful content that takes up space. '.repeat(10) + '\n\n';
    // Each paragraph ~700 chars => ~175 tokens. 4 paragraphs ~700 tokens > 512
    const body = paragraph.repeat(4);
    const content = `---
title: Test
type: note
tier: slow
---

## Big Section

${body}
`;
    const result = parseMarkdown('test.md', content);
    const sectionChunks = result.chunks.filter((c) => c.heading === 'Big Section');
    expect(sectionChunks.length).toBeGreaterThan(1);
  });

  it('keeps code blocks atomic during paragraph splitting', () => {
    const codeBlock = '```python\n' + 'x = 1\n'.repeat(100) + '```\n\n';
    const textParagraph =
      'Some text paragraph with meaningful filler content here. '.repeat(10) + '\n\n';
    const content = `---
title: Test
type: note
tier: slow
---

## Mixed Section

${textParagraph}${codeBlock}${textParagraph}
`;
    const result = parseMarkdown('test.md', content);
    // Code block should be intact in some chunk
    const hasIntactCode = result.chunks.some(
      (c) => c.text.includes('```python') && c.text.includes('x = 1')
    );
    expect(hasIntactCode).toBe(true);
  });

  it('keeps chunks at or below 512 tokens unless a single code block exceeds that', () => {
    const paragraph = 'Word '.repeat(100) + '\n\n'; // 500 chars ~125 tokens
    const body = paragraph.repeat(8); // ~1000 tokens
    const content = `---
title: Test
type: note
tier: slow
---

## Large Section

${body}
`;
    const result = parseMarkdown('test.md', content);
    const sectionChunks = result.chunks.filter((c) => c.heading === 'Large Section');
    for (const chunk of sectionChunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(512);
    }
  });

  it('chunks with overlap do not exceed MAX_CHUNK_TOKENS', () => {
    const longParagraph = 'Word '.repeat(200);
    const body = `${longParagraph}\n\n${longParagraph}\n\n${longParagraph}\n\n${longParagraph}`;
    const result = parseMarkdown(
      'test.md',
      `---\ntitle: test\ntype: note\ntier: slow\n---\n\n${body}`
    );

    for (const chunk of result.chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(512);
    }
  });

  it('adds ~10% overlap between paragraph-split chunks', () => {
    const paragraph =
      'Unique sentence number one for testing overlap behavior. '.repeat(12) + '\n\n';
    const body = paragraph.repeat(4);
    const content = `---
title: Test
type: note
tier: slow
---

## Overlap Section

${body}
`;
    const result = parseMarkdown('test.md', content);
    const chunks = result.chunks.filter((c) => c.heading === 'Overlap Section');
    if (chunks.length >= 2) {
      // Second chunk should start with some text from end of first chunk
      const firstEnd = chunks[0].text.slice(-200);
      const secondStart = chunks[1].text.slice(0, 200);
      // There should be some overlapping content
      const firstWords = firstEnd.split(/\s+/).filter(Boolean);
      const secondWords = secondStart.split(/\s+/).filter(Boolean);
      const overlap = firstWords.filter((w) => secondWords.includes(w));
      expect(overlap.length).toBeGreaterThan(0);
    }
  });
});

describe('parseMarkdown — relation extraction', () => {
  it('extracts related relations', () => {
    const content = `---
title: Test
type: note
tier: slow
related: [hooks-deep-dive, next-app-router]
---

Content with enough text to generate at least one chunk for the parser output.
`;
    const result = parseMarkdown('test.md', content);
    expect(result.relations).toHaveLength(2);
    expect(result.relations[0]).toEqual({
      sourceId: 'test',
      targetId: 'hooks-deep-dive',
      type: 'related-to',
    });
    expect(result.relations[1]).toEqual({
      sourceId: 'test',
      targetId: 'next-app-router',
      type: 'related-to',
    });
  });

  it('extracts supersedes relation', () => {
    const content = `---
title: Test
type: note
tier: slow
supersedes: old-note
---

Content with enough text to generate at least one chunk for the parser output.
`;
    const result = parseMarkdown('test.md', content);
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).toEqual({
      sourceId: 'test',
      targetId: 'old-note',
      type: 'supersedes',
    });
  });

  it('extracts parent relation', () => {
    const content = `---
title: Test
type: note
tier: slow
parent: parent-note
---

Content with enough text to generate at least one chunk for the parser output.
`;
    const result = parseMarkdown('test.md', content);
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).toEqual({
      sourceId: 'test',
      targetId: 'parent-note',
      type: 'parent',
    });
  });

  it('returns empty relations array when no relation fields present', () => {
    const content = `---
title: Test
type: note
tier: slow
---

Content with enough text to generate at least one chunk for the parser output.
`;
    const result = parseMarkdown('test.md', content);
    expect(result.relations).toEqual([]);
  });
});

describe('frontmatter coercion', () => {
  it('normalizes comma-separated tags string to array', () => {
    const fm = coerceFrontmatter('test.md', { tags: 'react, hooks, state' });
    expect(fm.tags).toEqual(['react', 'hooks', 'state']);
  });

  it('wraps a single tag string in an array', () => {
    const fm = coerceFrontmatter('test.md', { tags: 'react' });
    expect(fm.tags).toEqual(['react']);
  });

  it('keeps tags array as-is', () => {
    const fm = coerceFrontmatter('test.md', { tags: ['react', 'hooks'] });
    expect(fm.tags).toEqual(['react', 'hooks']);
  });

  it('filters non-string entries from tags array', () => {
    const fm = coerceFrontmatter('test.md', { tags: ['react', 42, null, 'hooks'] });
    expect(fm.tags).toEqual(['react', 'hooks']);
  });

  it('coerces YAML Date object to ISO string', () => {
    const date = new Date('2026-02-17T00:00:00.000Z');
    const fm = coerceFrontmatter('test.md', { created: date });
    expect(fm.created).toBe('2026-02-17T00:00:00.000Z');
  });

  it('keeps date strings as-is', () => {
    const fm = coerceFrontmatter('test.md', { created: '2026-02-17' });
    expect(fm.created).toBe('2026-02-17');
  });

  it('returns undefined for invalid Date objects', () => {
    const fm = coerceFrontmatter('test.md', { created: new Date('invalid') });
    expect(fm.created).toBeUndefined();
  });

  it('falls back to default for invalid type', () => {
    const fm = coerceFrontmatter('test.md', { type: 'invalid-type' });
    expect(fm.type).toBe('note');
  });

  it('falls back to default for invalid tier', () => {
    const fm = coerceFrontmatter('test.md', { tier: 'invalid-tier' });
    expect(fm.tier).toBe('slow');
  });

  it('returns undefined for invalid confidence', () => {
    const fm = coerceFrontmatter('test.md', { confidence: 'invalid' });
    expect(fm.confidence).toBeUndefined();
  });

  it('returns undefined for invalid status', () => {
    const fm = coerceFrontmatter('test.md', { status: 'invalid' });
    expect(fm.status).toBeUndefined();
  });

  it('does not spread unknown fields into frontmatter', () => {
    const fm = coerceFrontmatter('test.md', {
      title: 'Test',
      type: 'note',
      tier: 'slow',
      unknownField: 'should-not-appear',
      anotherUnknown: 123,
    });
    expect('unknownField' in fm).toBe(false);
    expect('anotherUnknown' in fm).toBe(false);
  });

  it('applies defaults for missing required fields', () => {
    const fm = coerceFrontmatter('my-great-note.md', {});
    expect(fm.title).toBe('my-great-note');
    expect(fm.type).toBe('note');
    expect(fm.tier).toBe('slow');
  });

  it('drops malformed source entries', () => {
    const fm = coerceFrontmatter('test.md', {
      sources: [
        { url: 'https://example.com', accessed: '2026-01-01', type: 'web' },
        { noUrl: true },
        'not-an-object',
        null,
      ],
    });
    expect(fm.sources).toHaveLength(1);
    expect(fm.sources![0].url).toBe('https://example.com');
  });

  it('returns undefined for sources that are not an array', () => {
    const fm = coerceFrontmatter('test.md', { sources: 'not-an-array' });
    expect(fm.sources).toBeUndefined();
  });

  it('returns undefined for sources where all entries are malformed', () => {
    const fm = coerceFrontmatter('test.md', {
      sources: [{ noUrl: true }, 'bad'],
    });
    expect(fm.sources).toBeUndefined();
  });

  it('validates review-interval format', () => {
    expect(coerceFrontmatter('t.md', { 'review-interval': '30d' })['review-interval']).toBe('30d');
    expect(coerceFrontmatter('t.md', { 'review-interval': '2w' })['review-interval']).toBe('2w');
    expect(coerceFrontmatter('t.md', { 'review-interval': '6m' })['review-interval']).toBe('6m');
    expect(
      coerceFrontmatter('t.md', { 'review-interval': 'invalid' })['review-interval']
    ).toBeUndefined();
    expect(
      coerceFrontmatter('t.md', { 'review-interval': '30' })['review-interval']
    ).toBeUndefined();
    expect(
      coerceFrontmatter('t.md', { 'review-interval': 'dx' })['review-interval']
    ).toBeUndefined();
  });

  it('coerces related to string array and drops non-strings', () => {
    const fm = coerceFrontmatter('test.md', { related: ['note-a', 42, 'note-b'] });
    expect(fm.related).toEqual(['note-a', 'note-b']);
  });

  it('coerces supersedes to string', () => {
    const fm = coerceFrontmatter('test.md', { supersedes: 'old-note' });
    expect(fm.supersedes).toBe('old-note');
  });

  it('coerces numeric supersedes to string', () => {
    const fm = coerceFrontmatter('test.md', { supersedes: 42 });
    expect(fm.supersedes).toBe('42');
  });

  it('drops supersedes if it is an object', () => {
    const fm = coerceFrontmatter('test.md', { supersedes: { id: 'note' } });
    expect(fm.supersedes).toBeUndefined();
  });

  it('coerces parent to string', () => {
    const fm = coerceFrontmatter('test.md', { parent: 'parent-note' });
    expect(fm.parent).toBe('parent-note');
  });

  it('coerces numeric title to string via coerceString fallback', () => {
    const fm = coerceFrontmatter('test.md', { title: 42 });
    expect(fm.title).toBe('test');
  });

  it('handles all date fields consistently', () => {
    const date = new Date('2026-03-01T00:00:00.000Z');
    const fm = coerceFrontmatter('test.md', {
      created: date,
      modified: '2026-03-02',
      'last-reviewed': date,
      expires: 'never',
      date: date,
    });
    expect(fm.created).toBe('2026-03-01T00:00:00.000Z');
    expect(fm.modified).toBe('2026-03-02');
    expect(fm['last-reviewed']).toBe('2026-03-01T00:00:00.000Z');
    expect(fm.expires).toBe('never');
    expect(fm.date).toBe('2026-03-01T00:00:00.000Z');
  });
});
