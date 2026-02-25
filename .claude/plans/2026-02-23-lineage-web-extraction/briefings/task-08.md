# Task 08: Web Extraction Service

## Architectural Context

Brain needs a general-purpose web content extraction pipeline for fetching URLs, extracting readable content, and converting to markdown. This service will be used by `brain add --url` (Task 9), the future research pipeline, and inbox URL processing. Uses `@mozilla/readability` for article extraction, `turndown` for HTML→markdown, and `jsdom` for DOM parsing. Follows Brain's service pattern (pure functions, no DB dependency).

## File Ownership

**May modify:**
- `src/services/web-extract.ts` (new file)
- `__tests__/services/web-extract.test.ts` (new file)
- `package.json` (add dependencies)

**Must not touch:**
- `src/services/brain-db.ts`
- `src/services/indexing.ts`
- `src/commands/` — Task 9 owns CLI integration

**Read for context (do not modify):**
- `src/types.ts` — understand existing type patterns
- `package.json` — understand existing dependencies

## Steps

### Step 1: Install dependencies

```bash
npm install @mozilla/readability turndown jsdom
npm install -D @types/turndown @types/jsdom
```

Note: `@mozilla/readability` ships its own types. Check if `@types/readability` exists or if types are bundled.

### Step 2: Create type definitions

Create `src/services/web-extract.ts` with types:

```typescript
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';

export interface WebMetadata {
  title: string | null;
  author: string | null;
  description: string | null;
  siteName: string | null;
  publishedDate: string | null;
}

export interface WebExtractResult {
  markdown: string;
  metadata: WebMetadata;
  normalizedUrl: string;
  contentHash: string;
}

export interface WebExtractOptions {
  timeout?: number;       // default 10000ms
  maxSize?: number;       // default 5MB
  userAgent?: string;     // default 'brain/1.0'
}
```

### Step 3: Write failing tests

Create `__tests__/services/web-extract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeUrl, extractFromHtml, extractMetadata } from '../../src/services/web-extract.js';

describe('normalizeUrl', () => {
  it('strips utm parameters', () => {
    expect(normalizeUrl('https://example.com/page?utm_source=twitter&utm_medium=social'))
      .toBe('https://example.com/page');
  });

  it('strips tracking parameters', () => {
    expect(normalizeUrl('https://example.com/page?fbclid=abc&ref=homepage'))
      .toBe('https://example.com/page');
  });

  it('preserves meaningful query parameters', () => {
    expect(normalizeUrl('https://example.com/search?q=test&page=2'))
      .toBe('https://example.com/search?page=2&q=test');
  });

  it('lowercases hostname', () => {
    expect(normalizeUrl('https://EXAMPLE.COM/Path'))
      .toBe('https://example.com/Path');
  });

  it('removes trailing slash', () => {
    expect(normalizeUrl('https://example.com/path/'))
      .toBe('https://example.com/path');
  });
});

describe('extractFromHtml', () => {
  it('extracts article content as markdown', () => {
    const html = `
      <html><head><title>Test Article</title></head>
      <body>
        <nav>Navigation</nav>
        <article>
          <h1>Test Article</h1>
          <p>This is the main content of the article.</p>
          <p>It has multiple paragraphs.</p>
        </article>
        <footer>Footer</footer>
      </body></html>
    `;
    const result = extractFromHtml(html, 'https://example.com/article');
    expect(result.markdown).toContain('Test Article');
    expect(result.markdown).toContain('main content');
    expect(result.contentHash).toBeTruthy();
  });

  it('returns empty markdown for non-article pages', () => {
    const html = '<html><body><nav>Just navigation</nav></body></html>';
    const result = extractFromHtml(html, 'https://example.com/nav');
    // Readability may return null for non-article content
    expect(result.markdown).toBeDefined();
  });
});

describe('extractMetadata', () => {
  it('extracts og:title and description', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="OG Title">
        <meta property="og:description" content="OG Description">
        <meta property="og:site_name" content="Example Site">
        <meta name="author" content="John Doe">
      </head><body><p>Content</p></body></html>
    `;
    const meta = extractMetadata(html);
    expect(meta.title).toBe('OG Title');
    expect(meta.description).toBe('OG Description');
    expect(meta.siteName).toBe('Example Site');
    expect(meta.author).toBe('John Doe');
  });
});
```

### Step 4: Run tests to verify they fail

Run: `npm test -- __tests__/services/web-extract.test.ts`
Expected: FAIL — functions don't exist yet.

### Step 5: Implement normalizeUrl

```typescript
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'ref', 'source', 'mc_cid', 'mc_eid',
]);

export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hostname = url.hostname.toLowerCase();

  // Remove tracking params
  for (const param of TRACKING_PARAMS) {
    url.searchParams.delete(param);
  }

  // Sort remaining params for consistency
  url.searchParams.sort();

  let result = url.toString();
  // Remove trailing slash (but not for root path)
  if (result.endsWith('/') && url.pathname !== '/') {
    result = result.slice(0, -1);
  }
  return result;
}
```

### Step 6: Implement extractMetadata

```typescript
export function extractMetadata(html: string): WebMetadata {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const getMeta = (selectors: string[]): string | null => {
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el) return el.getAttribute('content');
    }
    return null;
  };

  return {
    title: getMeta(['meta[property="og:title"]', 'meta[name="title"]']) ?? doc.title ?? null,
    author: getMeta(['meta[name="author"]', 'meta[property="article:author"]']),
    description: getMeta(['meta[property="og:description"]', 'meta[name="description"]']),
    siteName: getMeta(['meta[property="og:site_name"]']),
    publishedDate: getMeta(['meta[property="article:published_time"]', 'meta[name="date"]']),
  };
}
```

### Step 7: Implement extractFromHtml

```typescript
export function extractFromHtml(html: string, url: string): WebExtractResult {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });

  const markdown = article ? turndown.turndown(article.content) : '';
  const metadata = extractMetadata(html);

  // Use article title if available, fall back to metadata
  if (article?.title) metadata.title = article.title;
  if (article?.byline) metadata.author = article.byline;
  if (article?.siteName) metadata.siteName = article.siteName;

  const contentHash = createHash('sha256').update(markdown).digest('hex');

  return {
    markdown,
    metadata,
    normalizedUrl: normalizeUrl(url),
    contentHash,
  };
}
```

### Step 8: Implement fetchAndExtract (the main entry point)

```typescript
const DEFAULT_OPTIONS: Required<WebExtractOptions> = {
  timeout: 10_000,
  maxSize: 5 * 1024 * 1024,
  userAgent: 'brain/1.0',
};

export async function fetchAndExtract(
  url: string,
  options?: WebExtractOptions
): Promise<WebExtractResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': opts.userAgent },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > opts.maxSize) {
      throw new Error(`Content too large: ${contentLength} bytes (max ${opts.maxSize})`);
    }

    const html = await response.text();
    return extractFromHtml(html, url);
  } finally {
    clearTimeout(timeoutId);
  }
}
```

### Step 9: Run all tests

Run: `npm test -- __tests__/services/web-extract.test.ts && npm run typecheck`
Expected: PASS

### Step 10: Commit

```bash
git add src/services/web-extract.ts __tests__/services/web-extract.test.ts package.json package-lock.json
git commit -m "Add web extraction service (readability + turndown + jsdom)"
```

## Success Criteria

- [ ] Tests pass: `npm test -- __tests__/services/web-extract.test.ts`
- [ ] Types check: `npm run typecheck`
- [ ] `normalizeUrl` strips tracking params, lowercases hostname, removes trailing slash
- [ ] `extractFromHtml` converts HTML article to markdown via Readability + Turndown
- [ ] `extractMetadata` extracts OG/meta tags
- [ ] `fetchAndExtract` fetches URL with timeout and size limits
- [ ] Content hash computed for deduplication

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT add features beyond what is specified in the steps
- Do NOT add network-dependent tests — all tests should use static HTML strings
- Do NOT add `jsdom` or `@mozilla/readability` to `tsup` externals yet — do that only if build fails
