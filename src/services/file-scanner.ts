import { createHash } from 'node:crypto';
import { readFile, stat, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { FileRecord } from '../types.js';

export const INDEXABLE_EXTENSIONS = new Set(['.md', '.csv', '.txt']);

export interface ScanResult {
  new: Array<{ path: string; hash: string; mtime: number }>;
  modified: Array<{ path: string; hash: string; mtime: number }>;
  deleted: string[];
  unchanged: number;
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function scanForChanges(
  rootDir: string,
  knownFiles: Map<string, FileRecord>
): Promise<ScanResult> {
  const result: ScanResult = {
    new: [],
    modified: [],
    deleted: [],
    unchanged: 0,
  };

  const entries = await readdir(rootDir, { recursive: true });
  const files = entries
    .filter((e) => {
      const ext = extname(e).toLowerCase();
      return INDEXABLE_EXTENSIONS.has(ext) && !e.includes('node_modules') && !e.includes('.git');
    })
    .map((e) => join(rootDir, e));

  const seen = new Set<string>();

  for (const filePath of files) {
    seen.add(filePath);
    const fileStat = await stat(filePath);
    const mtime = fileStat.mtimeMs;
    const known = knownFiles.get(filePath);

    if (!known) {
      const content = await readFile(filePath, 'utf-8');
      const hash = hashContent(content);
      result.new.push({ path: filePath, hash, mtime });
      continue;
    }

    if (mtime === known.mtime) {
      result.unchanged++;
      continue;
    }

    const content = await readFile(filePath, 'utf-8');
    const hash = hashContent(content);

    if (hash === known.hash) {
      result.unchanged++;
    } else {
      result.modified.push({ path: filePath, hash, mtime });
    }
  }

  for (const [path] of knownFiles) {
    if (!seen.has(path)) {
      result.deleted.push(path);
    }
  }

  return result;
}

export async function listUnsupportedFiles(
  rootDir: string
): Promise<Array<{ path: string; ext: string }>> {
  const entries = await readdir(rootDir, { recursive: true });
  return entries
    .filter((e) => {
      if (e.includes('node_modules') || e.includes('.git')) return false;
      const ext = extname(e).toLowerCase();
      return ext !== '' && !INDEXABLE_EXTENSIONS.has(ext);
    })
    .map((e) => ({ path: join(rootDir, e), ext: extname(e).toLowerCase() }));
}
