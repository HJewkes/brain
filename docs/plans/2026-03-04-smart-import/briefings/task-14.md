# Task 14: Image Context Preservation

## Architectural Context

Images in markdown aren't searchable, but their surrounding context is. This task adds image reference extraction to the markdown parser so that when a section contains primarily an image (alt text + short caption), the chunk includes synthesized text that makes the image discoverable via search. It also adds `imageRefs` to `ParsedNote` (the type field was added in Task 01).

The markdown parser at `src/services/markdown-parser.ts` already handles heading-aware chunking. The key insertion points are: (1) extract image references during parsing, (2) synthesize searchable text for image-heavy sections.

## File Ownership

**May modify:**
- `src/services/markdown-parser.ts` (add `extractImageReferences`, update `parseMarkdown`)
- `__tests__/services/markdown-parser.test.ts` (add image tests)

**Must not touch:**
- `src/types.ts` — Task 01 already added `imageRefs` to `ParsedNote`
- `src/services/indexing.ts`

**Read for context (do not modify):**
- `src/services/markdown-parser.ts` — `parseMarkdown` (L29), `chunkBody` (L223-257), `splitParagraphsProtectingFences` (L325-375)
- `src/types.ts` — `ParsedNote` interface, `imageRefs?: Array<{alt: string; path: string}>` (Task 01)

## Steps

### Step 1: Write failing tests

Add to `__tests__/services/markdown-parser.test.ts`:

```typescript
import { extractImageReferences } from '../../src/services/markdown-parser.js';

describe('extractImageReferences', () => {
  it('extracts image references with alt text and paths', () => {
    const content = `## Architecture

![System Diagram](./images/arch-diagram.png)

The system uses a microservices pattern.

![Data Flow](../diagrams/data-flow.svg)`;

    const refs = extractImageReferences(content);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({ alt: 'System Diagram', path: './images/arch-diagram.png' });
    expect(refs[1]).toEqual({ alt: 'Data Flow', path: '../diagrams/data-flow.svg' });
  });

  it('returns empty array when no images', () => {
    const content = '# Just Text\n\nNo images here.';
    expect(extractImageReferences(content)).toHaveLength(0);
  });

  it('handles images with empty alt text', () => {
    const content = '![](photo.jpg)';
    const refs = extractImageReferences(content);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({ alt: '', path: 'photo.jpg' });
  });
});

describe('parseMarkdown image context', () => {
  it('populates imageRefs on ParsedNote', () => {
    const content = `---
title: Design Doc
type: research
tier: slow
---

## Diagrams

![Component Layout](./component-layout.png)

This shows the main components.`;

    const result = parseMarkdown('design.md', content);
    expect(result.imageRefs).toBeDefined();
    expect(result.imageRefs).toHaveLength(1);
    expect(result.imageRefs![0].alt).toBe('Component Layout');
  });

  it('synthesizes searchable text for image-only sections', () => {
    const content = `---
title: Screenshots
type: note
tier: fast
---

## Login Screen

![Login Form with validation errors](./screenshots/login.png)`;

    const result = parseMarkdown('screenshots.md', content);
    const chunks = result.chunks;
    const imageChunk = chunks.find((c) => c.text.includes('Login Form'));
    expect(imageChunk).toBeDefined();
    expect(imageChunk!.text).toContain('[Image: Login Form with validation errors]');
  });
});
```

### Step 2: Implement extractImageReferences

Add to `src/services/markdown-parser.ts`:

```typescript
const IMAGE_REF = /!\[([^\]]*)\]\(([^)]+)\)/g;

export function extractImageReferences(content: string): Array<{ alt: string; path: string }> {
  const refs: Array<{ alt: string; path: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = IMAGE_REF.exec(content)) !== null) {
    refs.push({ alt: match[1], path: match[2] });
  }
  return refs;
}
```

### Step 3: Update parseMarkdown to populate imageRefs

In `parseMarkdown`, after parsing the body, extract image references and attach to the result:

```typescript
// Inside parseMarkdown, before the return:
const imageRefs = extractImageReferences(body);

// Add to the returned ParsedNote:
return {
  // ... existing fields
  imageRefs: imageRefs.length > 0 ? imageRefs : undefined,
};
```

### Step 4: Synthesize text for image-heavy sections

In `chunkBody` or `splitParagraphsProtectingFences`, when a paragraph unit is primarily an image reference (matches `IMAGE_REF` and surrounding text is < 50 chars), prepend synthesized context:

```typescript
function synthesizeImageContext(paragraph: string): string {
  const imageMatch = paragraph.match(/!\[([^\]]*)\]\(([^)]+)\)/);
  if (!imageMatch) return paragraph;

  const alt = imageMatch[1];
  const textWithoutImage = paragraph.replace(/!\[[^\]]*\]\([^)]+\)/, '').trim();

  // If the paragraph is mostly just an image, add searchable context
  if (textWithoutImage.length < 50 && alt.length > 0) {
    return `[Image: ${alt}] ${textWithoutImage}`.trim();
  }
  return paragraph;
}
```

Apply this in `splitParagraphsProtectingFences` when emitting paragraph units.

### Step 5: Run tests

Run: `npm test -- __tests__/services/markdown-parser.test.ts`
Expected: PASS

### Step 6: Commit

```bash
git add src/services/markdown-parser.ts __tests__/services/markdown-parser.test.ts
git commit -m "Add image context preservation to markdown parser"
```

## Success Criteria

- [ ] Tests pass: `npm test -- __tests__/services/markdown-parser.test.ts`
- [ ] No new lint warnings: `npm run lint`
- [ ] Types check: `npm run typecheck`
- [ ] `extractImageReferences` finds all markdown image references
- [ ] `ParsedNote.imageRefs` populated when images present
- [ ] Image-only sections produce chunks with `[Image: alt text]` context
- [ ] Existing chunk tests still pass (no regression)

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT add features beyond what is specified in the steps
- Do NOT attempt to process actual image files — only extract references from markdown syntax
- Do NOT change the chunking algorithm — only augment paragraph text before chunking
