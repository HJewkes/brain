import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, basename, relative, dirname, join } from 'node:path';
import type { ScoredDoc } from '../data/onboard-types.js';

const IGNORED_DIRS = new Set([
  'node_modules', 'vendor', 'dist', 'build', '.git', '.next', '.turbo',
  '__pycache__', '.venv', 'venv', 'target', 'coverage', '.cache',
]);

const HIGH_VALUE_NAMES = new Set([
  'readme', 'architecture', 'contributing', 'changelog', 'design',
  'overview', 'getting-started', 'quickstart', 'api', 'guide',
]);

const DOC_DIRS = new Set(['docs', 'doc', 'documentation']);
const ADR_PATTERNS = [/^adr[-_]\d/i, /^decisions?\//i];

const MAX_FILE_SIZE = 50 * 1024; // 50KB
const MIN_FILE_SIZE = 500; // 500 bytes

export interface DiscoverOptions {
  maxDocs?: number;
}

function scoreDoc(filePath: string, rootDir: string): number {
  let score = 0;
  const rel = relative(rootDir, filePath);
  const name = basename(filePath, '.md').toLowerCase();
  const dir = dirname(rel);

  // Root-level file
  if (dir === '.') score += 30;

  // High-value filename
  if (HIGH_VALUE_NAMES.has(name)) score += 25;

  // In docs/ directory
  const parts = rel.split('/');
  if (parts.some(p => DOC_DIRS.has(p.toLowerCase()))) score += 20;

  // ADR pattern
  if (ADR_PATTERNS.some(p => p.test(rel))) score += 15;

  // File size bonus (reasonable size)
  try {
    const size = statSync(filePath).size;
    if (size >= MIN_FILE_SIZE && size <= MAX_FILE_SIZE) score += 10;
  } catch { /* no bonus */ }

  return score;
}

function walkForDocs(dir: string): string[] {
  const docs: string[] = [];

  function walk(d: string): void {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry)) continue;
      const full = join(d, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }

      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.md')) {
        // Exclude oversized files
        if (stat.size > MAX_FILE_SIZE) continue;
        docs.push(full);
      }
    }
  }

  walk(dir);
  return docs;
}

export function discoverDocs(componentPaths: string[], options?: DiscoverOptions): ScoredDoc[] {
  const maxDocs = options?.maxDocs ?? Infinity;
  const seen = new Set<string>();
  const scored: ScoredDoc[] = [];

  for (const componentPath of componentPaths) {
    if (!existsSync(componentPath)) continue;
    const docs = walkForDocs(componentPath);

    for (const docPath of docs) {
      const canonical = resolve(docPath);
      if (seen.has(canonical)) continue;
      seen.add(canonical);

      scored.push({
        path: docPath,
        score: scoreDoc(docPath, componentPath),
        ingested: false,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxDocs);
}
