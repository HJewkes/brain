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
  timeout?: number;
  maxSize?: number;
  userAgent?: string;
}

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'ref', 'source', 'mc_cid', 'mc_eid',
]);

export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hostname = url.hostname.toLowerCase();

  for (const param of TRACKING_PARAMS) {
    url.searchParams.delete(param);
  }

  url.searchParams.sort();

  let result = url.toString();
  if (result.endsWith('/') && url.pathname !== '/') {
    result = result.slice(0, -1);
  }
  return result;
}

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

export function extractFromHtml(html: string, url: string): WebExtractResult {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });

  const markdown = article?.content ? turndown.turndown(article.content) : '';
  const metadata = extractMetadata(html);

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

const DEFAULT_OPTIONS: Required<WebExtractOptions> = {
  timeout: 10_000,
  maxSize: 5 * 1024 * 1024,
  userAgent: 'brain/1.0',
};

export async function fetchAndExtract(
  url: string,
  options?: WebExtractOptions,
): Promise<WebExtractResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported protocol: ${parsed.protocol} (only http/https)`);
  }

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
    if (html.length > opts.maxSize) {
      throw new Error(`Content too large: ${html.length} bytes (max ${opts.maxSize})`);
    }
    return extractFromHtml(html, url);
  } finally {
    clearTimeout(timeoutId);
  }
}
