import { describe, it, expect } from 'vitest';
import { classifyContentType } from '../../src/services/markdown-parser.js';
import { parseMarkdown } from '../../src/services/markdown-parser.js';

describe('classifyContentType', () => {
  it('classifies pure prose as prose', () => {
    const text = 'This is a paragraph of text.\nIt has multiple lines.\nAll prose content.';
    expect(classifyContentType(text)).toBe('prose');
  });

  it('classifies a code-only block as code', () => {
    const text =
      '```typescript\nconst x = 1;\nconst y = 2;\nconst z = x + y;\nconsole.log(z);\n```';
    expect(classifyContentType(text)).toBe('code');
  });

  it('classifies mixed prose and code as mixed', () => {
    const text =
      'Here is some explanation about the code:\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nMore prose here.';
    expect(classifyContentType(text)).toBe('mixed');
  });

  it('classifies table-heavy content as table', () => {
    const text = '| Name | Value |\n| --- | --- |\n| foo | 1 |\n| bar | 2 |\n| baz | 3 |';
    expect(classifyContentType(text)).toBe('table');
  });

  it('returns prose for empty text', () => {
    expect(classifyContentType('')).toBe('prose');
  });

  it('returns prose for whitespace-only text', () => {
    expect(classifyContentType('   \n  \n  ')).toBe('prose');
  });

  it('classifies a small code snippet with prose as mixed', () => {
    const text =
      'Use the following pattern:\n\n```\nfoo()\n```\n\nThis pattern is useful for initialization.\nIt handles cleanup automatically.\nSee the docs for more details.';
    expect(classifyContentType(text)).toBe('mixed');
  });
});

describe('parseMarkdown assigns contentType to chunks', () => {
  it('tags prose chunks as prose', () => {
    const md = `---
title: Test Note
type: note
tier: fast
---

# Introduction

This is a paragraph of text about a topic.
It contains only prose content with no code blocks.
`;
    const parsed = parseMarkdown('test.md', md);
    expect(parsed.chunks.length).toBeGreaterThan(0);
    expect(parsed.chunks[0].contentType).toBe('prose');
  });

  it('tags code-heavy chunks as code', () => {
    const md = `---
title: Code Note
type: note
tier: fast
---

# Setup

\`\`\`typescript
import { createServer } from 'http';
const server = createServer();
server.listen(3000);
console.log('Server running');
process.on('exit', () => server.close());
\`\`\`
`;
    const parsed = parseMarkdown('code.md', md);
    expect(parsed.chunks.length).toBeGreaterThan(0);
    expect(parsed.chunks[0].contentType).toBe('code');
  });

  it('tags mixed prose+code chunks as mixed', () => {
    const md = `---
title: Mixed Note
type: note
tier: fast
---

# Usage

First install the package:

\`\`\`bash
npm install brain
\`\`\`

Then configure it in your project settings.
Make sure to set the correct paths.
`;
    const parsed = parseMarkdown('mixed.md', md);
    expect(parsed.chunks.length).toBeGreaterThan(0);
    expect(parsed.chunks[0].contentType).toBe('mixed');
  });
});
