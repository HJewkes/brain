import { Command } from '@commander-js/extra-typings';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { loadConfig } from '../services/config.js';
import { parseMarkdown } from '../services/markdown-parser.js';
import type { NoteType, NoteTier } from '../types.js';
import {
  VALID_NOTE_TYPES,
  VALID_NOTE_TIERS,
  VALID_NOTE_CONFIDENCES,
  VALID_NOTE_STATUSES,
} from '../types.js';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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

function validateEnum<T extends string>(
  value: string | undefined,
  valid: readonly T[],
  label: string
): T | null {
  if (!value) return null;
  if (valid.includes(value as T)) return value as T;
  console.error(`Error: invalid ${label} "${value}". Valid values: ${valid.join(', ')}`);
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
  .action(async (file, opts) => {
    if (opts.type && !VALID_NOTE_TYPES.includes(opts.type as NoteType)) {
      console.error(
        `Error: invalid type "${opts.type}". Valid types: ${VALID_NOTE_TYPES.join(', ')}`
      );
      process.exitCode = 1;
      return;
    }

    if (opts.tier && !VALID_NOTE_TIERS.includes(opts.tier as NoteTier)) {
      console.error(
        `Error: invalid tier "${opts.tier}". Valid tiers: ${VALID_NOTE_TIERS.join(', ')}`
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
      console.error(
        `Error: invalid review-interval "${opts.reviewInterval}". Use format like 30d, 4w, 3m`
      );
      process.exitCode = 1;
      return;
    }

    let content: string;

    if (file) {
      content = readFileSync(resolve(file), 'utf-8');
    } else if (!process.stdin.isTTY) {
      content = readFileSync(0, 'utf-8');
    } else {
      console.error('Error: provide a file argument or pipe content to stdin');
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

    writeFileSync(outPath, content, 'utf-8');
    console.log(outPath);
  });
