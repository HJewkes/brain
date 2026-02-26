import { mkdirSync, existsSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';

const INDEXABLE_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml']);

/**
 * Resolve content directory path for a note.
 * Convention: sibling directory named `{note-id}.d/` next to the note file.
 */
export function resolveContentDir(notesDir: string, noteId: string): string {
  return join(notesDir, `${noteId}.d`);
}

/**
 * Create a content directory if it doesn't exist.
 * Returns the directory path.
 */
export function createContentDir(notesDir: string, noteId: string): string {
  const dir = resolveContentDir(notesDir, noteId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Archive a content directory by moving it to .archive/.
 * Returns the archive path, or null if no content dir exists.
 */
export function archiveContentDir(notesDir: string, noteId: string): string | null {
  const dir = resolveContentDir(notesDir, noteId);
  if (!existsSync(dir)) return null;
  const archiveDir = join(notesDir, '.archive', `${noteId}.d`);
  mkdirSync(join(notesDir, '.archive'), { recursive: true });
  renameSync(dir, archiveDir);
  return archiveDir;
}

/**
 * Delete a content directory permanently.
 * Returns true if deleted, false if not found.
 */
export function deleteContentDir(notesDir: string, noteId: string): boolean {
  const dir = resolveContentDir(notesDir, noteId);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * Read all indexable text content from a content directory.
 * Returns concatenated text suitable for appending to FTS content.
 */
export function readIndexableContent(contentDir: string): string {
  if (!existsSync(contentDir)) return '';
  const files = readdirSync(contentDir);
  const parts: string[] = [];
  for (const file of files.sort()) {
    const ext = extname(file).toLowerCase();
    if (!INDEXABLE_EXTENSIONS.has(ext)) continue;
    try {
      const content = readFileSync(join(contentDir, file), 'utf-8');
      parts.push(content);
    } catch {
      // Skip unreadable files
    }
  }
  return parts.join('\n\n');
}
