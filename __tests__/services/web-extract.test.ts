import { describe, it, expect } from 'vitest';
import { normalizeUrl, extractFromHtml, extractMetadata } from '../../src/services/web-extract.js';

describe('normalizeUrl', () => {
  it('strips utm parameters', () => {
    expect(normalizeUrl('https://example.com/page?utm_source=twitter&utm_medium=social')).toBe(
      'https://example.com/page'
    );
  });

  it('strips tracking parameters', () => {
    expect(normalizeUrl('https://example.com/page?fbclid=abc&ref=homepage')).toBe(
      'https://example.com/page'
    );
  });

  it('preserves meaningful query parameters', () => {
    expect(normalizeUrl('https://example.com/search?q=test&page=2')).toBe(
      'https://example.com/search?page=2&q=test'
    );
  });

  it('lowercases hostname', () => {
    expect(normalizeUrl('https://EXAMPLE.COM/Path')).toBe('https://example.com/Path');
  });

  it('removes trailing slash', () => {
    expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
  });

  it('preserves root path trailing slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
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
    expect(result.metadata.title).toBe('Test Article');
    expect(result.markdown).toContain('main content');
    expect(result.contentHash).toBeTruthy();
  });

  it('returns empty markdown for non-article pages', () => {
    const html = '<html><body><nav>Just navigation</nav></body></html>';
    const result = extractFromHtml(html, 'https://example.com/nav');
    expect(result.markdown).toBeDefined();
  });

  it('normalizes the URL in result', () => {
    const html = `
      <html><body><article>
        <h1>Title</h1>
        <p>Content paragraph for the article body.</p>
      </article></body></html>
    `;
    const result = extractFromHtml(html, 'https://EXAMPLE.COM/page?utm_source=test');
    expect(result.normalizedUrl).toBe('https://example.com/page');
  });

  it('computes a consistent content hash', () => {
    const html = `
      <html><body><article>
        <h1>Hash Test</h1>
        <p>Consistent content for hashing purposes.</p>
      </article></body></html>
    `;
    const result1 = extractFromHtml(html, 'https://example.com/a');
    const result2 = extractFromHtml(html, 'https://example.com/a');
    expect(result1.contentHash).toBe(result2.contentHash);
    expect(result1.contentHash).toHaveLength(64);
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

  it('falls back to document title when no og:title', () => {
    const html = `
      <html><head><title>Page Title</title></head>
      <body><p>Content</p></body></html>
    `;
    const meta = extractMetadata(html);
    expect(meta.title).toBe('Page Title');
  });

  it('extracts published date', () => {
    const html = `
      <html><head>
        <meta property="article:published_time" content="2025-01-15">
      </head><body><p>Content</p></body></html>
    `;
    const meta = extractMetadata(html);
    expect(meta.publishedDate).toBe('2025-01-15');
  });

  it('returns null for missing metadata', () => {
    const html = '<html><head></head><body><p>Content</p></body></html>';
    const meta = extractMetadata(html);
    expect(meta.author).toBeNull();
    expect(meta.description).toBeNull();
    expect(meta.siteName).toBeNull();
    expect(meta.publishedDate).toBeNull();
  });
});
