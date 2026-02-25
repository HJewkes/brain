import { Command } from '@commander-js/extra-typings';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { loadConfig } from '../services/config.js';
import { withBrain } from '../services/brain-service.js';
import { indexSingleFile } from '../services/indexing.js';
import { parseMarkdown } from '../services/markdown-parser.js';
import type { NoteType, NoteTier } from '../types.js';
import {
  VALID_NOTE_TYPES,
  VALID_NOTE_TIERS,
  VALID_NOTE_CONFIDENCES,
  VALID_NOTE_STATUSES,
} from '../types.js';
import { slugify } from '../utils.js';

function buildFrontmatter(opts: {
  title?: string;
  type?: string;
  tier?: string;
  tags?: string;
  summary?: string;
  confidence?: string;
  status?: string;
  category?: string;
  related?: string;
  reviewInterval?: string;
  created?: string;
}): string {
  const now = new Date().toISOString().slice(0, 10);
  const title = opts.title ?? 'Untitled';
  const type = opts.type ?? 'note';
  const tier = opts.tier ?? 'slow';
  const lines = [
    '---',
    `id: ${slugify(title)}`,
    `title: "${title}"`,
    `type: ${type}`,
    `tier: ${tier}`,
  ];
  if (opts.tags) {
    const tagList = opts.tags.split(',').map((t) => t.trim());
    lines.push(`tags: [${tagList.join(', ')}]`);
  }
  if (opts.summary) lines.push(`summary: "${opts.summary}"`);
  if (opts.confidence) lines.push(`confidence: ${opts.confidence}`);
  if (opts.status) lines.push(`status: ${opts.status}`);
  if (opts.category) lines.push(`category: ${opts.category}`);
  if (opts.reviewInterval) lines.push(`review-interval: ${opts.reviewInterval}`);
  if (opts.related) {
    const relatedList = opts.related.split(',').map((r) => r.trim());
    lines.push('related:');
    for (const r of relatedList) {
      lines.push(`  - ${r}`);
    }
  }
  lines.push(`created: ${opts.created ?? now}`);
  lines.push(`modified: ${now}`);
  lines.push('---');
  return lines.join('\n');
}

function hasFrontmatter(content: string): boolean {
  return content.trimStart().startsWith('---');
}

const TYPE_DIRS: Record<NoteType, string> = {
  note: 'notes',
  decision: 'decisions',
  research: 'research',
  pattern: 'patterns',
  meeting: 'logs',
  'session-log': 'logs',
  guide: 'guides',
};

function resolveOutputPath(notesDir: string, tier: NoteTier, type: NoteType, id: string): string {
  if (tier === 'fast') {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return join(notesDir, 'logs', yyyy, mm, `${yyyy}-${mm}-${dd}-${id}.md`);
  }

  const typeDir = TYPE_DIRS[type];
  return join(notesDir, typeDir, `${id}.md`);
}

async function handleUrlAdd(opts: {
  url?: string;
  title?: string;
  type?: string;
  tier?: string;
  tags?: string;
  summary?: string;
  confidence?: string;
  status?: string;
  category?: string;
  related?: string;
  reviewInterval?: string;
  created?: string;
}): Promise<void> {
  const { fetchAndExtract } = await import('../services/web-extract.js');
  const result = await fetchAndExtract(opts.url!);

  if (!result.markdown.trim()) {
    process.stderr.write('Could not extract content from URL.\n');
    process.exitCode = 1;
    return;
  }

  const title = opts.title ?? result.metadata.title ?? 'Web capture';
  const type = (opts.type ?? 'research') as NoteType;
  const tier = (opts.tier ?? 'fast') as NoteTier;
  const now = new Date().toISOString().slice(0, 10);
  const id = slugify(title);

  const frontmatterLines = [
    '---',
    `id: ${id}`,
    `title: "${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    `type: ${type}`,
    `tier: ${tier}`,
  ];
  if (opts.tags) {
    const tagList = opts.tags.split(',').map((t: string) => t.trim());
    frontmatterLines.push(`tags: [${tagList.join(', ')}]`);
  }
  if (opts.summary) frontmatterLines.push(`summary: "${opts.summary}"`);
  if (opts.confidence) frontmatterLines.push(`confidence: ${opts.confidence}`);
  if (opts.status) frontmatterLines.push(`status: ${opts.status ?? 'draft'}`);
  if (opts.category) frontmatterLines.push(`category: ${opts.category}`);
  if (opts.reviewInterval) frontmatterLines.push(`review-interval: ${opts.reviewInterval}`);

  frontmatterLines.push('sources:');
  frontmatterLines.push(`  - url: "${result.normalizedUrl}"`);
  frontmatterLines.push(`    accessed: "${now}"`);
  frontmatterLines.push('    type: "web"');

  if (opts.related) {
    const relatedList = opts.related.split(',').map((r: string) => r.trim());
    frontmatterLines.push('related:');
    for (const r of relatedList) {
      frontmatterLines.push(`  - ${r}`);
    }
  }

  frontmatterLines.push(`created: ${opts.created ?? now}`);
  frontmatterLines.push(`modified: ${now}`);
  frontmatterLines.push('---');

  const markdown = frontmatterLines.join('\n') + '\n\n' + result.markdown;

  await withBrain(async ({ db, embedder, config }) => {
    const outPath = resolveOutputPath(config.notesDir, tier, type, id);
    const dir = dirname(outPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(outPath, markdown, 'utf-8');

    const hash = createHash('sha256').update(markdown).digest('hex');
    await indexSingleFile(db, embedder, outPath, markdown, hash, Date.now());
    process.stdout.write(`Created: ${outPath}\n`);
  });
}

function validateEnum<T extends string>(
  value: string | undefined,
  valid: readonly T[],
  label: string
): T | null {
  if (!value) return null;
  if (valid.includes(value as T)) return value as T;
  process.stderr.write(`Error: invalid ${label} "${value}". Valid values: ${valid.join(', ')}\n`);
  process.exitCode = 1;
  return null;
}

export const addCommand = new Command('add')
  .description('Create a new note from file or stdin')
  .argument('[file]', 'Input file path')
  .option('--title <title>', 'Note title')
  .option(
    '--type <type>',
    'Note type (note, decision, pattern, research, meeting, session-log, guide)'
  )
  .option('--tier <tier>', 'Note tier (slow, fast)')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--summary <text>', 'One-line summary for search excerpts')
  .option('--confidence <level>', 'Confidence level (high, medium, low, speculative)')
  .option('--status <status>', 'Note status (current, outdated, deprecated, draft)')
  .option('--category <cat>', 'Category label')
  .option('--related <ids>', 'Comma-separated related note IDs')
  .option('--review-interval <interval>', 'Review interval (e.g. 90d, 30d, 180d)')
  .option('--created <date>', 'Created date (YYYY-MM-DD), defaults to today')
  .option('--url <url>', 'Fetch URL and create note from extracted content')
  .action(async (file, opts) => {
    if (opts.type && !VALID_NOTE_TYPES.includes(opts.type as NoteType)) {
      process.stderr.write(
        `Error: invalid type "${opts.type}". Valid types: ${VALID_NOTE_TYPES.join(', ')}\n`
      );
      process.exitCode = 1;
      return;
    }

    if (opts.tier && !VALID_NOTE_TIERS.includes(opts.tier as NoteTier)) {
      process.stderr.write(
        `Error: invalid tier "${opts.tier}". Valid tiers: ${VALID_NOTE_TIERS.join(', ')}\n`
      );
      process.exitCode = 1;
      return;
    }

    if (opts.confidence) {
      const result = validateEnum(opts.confidence, VALID_NOTE_CONFIDENCES, 'confidence');
      if (result === null && opts.confidence) return;
    }

    if (opts.status) {
      const result = validateEnum(opts.status, VALID_NOTE_STATUSES, 'status');
      if (result === null && opts.status) return;
    }

    if (opts.reviewInterval && !/^\d+[dwm]$/.test(opts.reviewInterval)) {
      process.stderr.write(
        `Error: invalid review-interval "${opts.reviewInterval}". Use format like 30d, 4w, 3m\n`
      );
      process.exitCode = 1;
      return;
    }

    if (opts.url) {
      await handleUrlAdd(opts);
      return;
    }

    let content: string;

    if (file) {
      content = readFileSync(resolve(file), 'utf-8');
    } else if (!process.stdin.isTTY) {
      content = readFileSync(0, 'utf-8');
    } else {
      process.stderr.write('Error: provide a file argument or pipe content to stdin\n');
      process.exitCode = 1;
      return;
    }

    if (!hasFrontmatter(content)) {
      const fm = buildFrontmatter(opts);
      content = fm + '\n\n' + content;
    }

    const parsed = parseMarkdown(file ?? 'untitled.md', content);
    const id = parsed.id;
    const tier = (opts.tier ?? parsed.frontmatter.tier ?? 'slow') as NoteTier;
    const type = (opts.type ?? parsed.frontmatter.type ?? 'note') as NoteType;

    const config = loadConfig();
    const outPath = resolveOutputPath(config.notesDir, tier, type, id);
    const dir = dirname(outPath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    try {
      writeFileSync(outPath, content, 'utf-8');
    } catch (err) {
      process.stderr.write(
        `Error: failed to write ${outPath}: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(outPath + '\n');
  });
