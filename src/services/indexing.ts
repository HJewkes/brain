import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { parseMarkdown, extractNoteLinks } from './markdown-parser.js';
import type { BrainDB } from './brain-db.js';
import type { Chunk, Embedder, InboxItem, NoteRecord, RawChunk, Relation } from '../types.js';
import { scanForChanges } from './file-scanner.js';
import { readIndexableContent } from './content-dir.js';
import { computeAutoLinks } from './graph.js';
import { slugify } from '../utils.js';
export { slugify };

export function isSkippedFile(filePath: string): boolean {
  return filePath.includes('/_templates/') || basename(filePath) === '_index.md';
}

export function addFrontmatterField(filePath: string, field: string, value: string): void {
  const content = readFileSync(filePath, 'utf-8');
  const endOfFrontmatter = content.indexOf('\n---', 4);
  if (endOfFrontmatter === -1) return;

  const frontmatter = content.slice(0, endOfFrontmatter);
  const fieldRegex = new RegExp(`^${field}:.*$`, 'm');
  let updated: string;
  if (fieldRegex.test(frontmatter)) {
    updated =
      frontmatter.replace(fieldRegex, `${field}: ${value}`) + content.slice(endOfFrontmatter);
  } else {
    updated = frontmatter + `\n${field}: ${value}` + content.slice(endOfFrontmatter);
  }
  writeFileSync(filePath, updated, 'utf-8');
}

export interface IndexResult {
  indexed: number;
  deleted: number;
  unchanged: number;
  indexedNoteIds: string[];
}

export function frontmatterToRecord(parsed: ReturnType<typeof parseMarkdown>): NoteRecord {
  const fm = parsed.frontmatter;

  // Preserve all raw frontmatter as metadata so custom fields (e.g., architecture-layer,
  // enforcement-strength) are available for filtering, not just module-specific fields
  const metadata = JSON.stringify(parsed.rawFrontmatter);

  return {
    id: parsed.id,
    filePath: parsed.filePath,
    title: fm.title,
    type: fm.type,
    tier: fm.tier,
    category: fm.category ?? null,
    tags: fm.tags ? fm.tags.join(',') : null,
    summary: fm.summary ?? null,
    confidence: fm.confidence ?? null,
    status: fm.status ?? 'current',
    sources: fm.sources ? JSON.stringify(fm.sources) : null,
    createdAt: fm.created ?? null,
    modifiedAt: fm.modified ?? null,
    lastReviewed: fm['last-reviewed'] ?? null,
    reviewInterval: fm['review-interval'] ?? null,
    expires: fm.expires ?? null,
    metadata,
    module: fm.module ?? null,
    moduleInstance: fm['module-instance'] ?? null,
    contentDir: fm['content-dir'] ?? null,
  };
}

export function chunkId(noteId: string, content: string): string {
  const hash = createHash('sha256').update(`${noteId}:${content}`).digest('hex').slice(0, 16);
  return `${noteId}::${hash}`;
}

export function rawChunksToChunks(noteId: string, rawChunks: RawChunk[]): Chunk[] {
  return rawChunks.map((rc) => ({
    id: chunkId(noteId, rc.text),
    noteId,
    heading: rc.heading,
    headingAncestry: rc.headingAncestry,
    content: rc.text,
    tokenCount: rc.tokenCount,
    chunkType: rc.chunkType,
    cutType: rc.cutType,
    position: rc.position,
  }));
}

export function inboxItemToMarkdown(item: InboxItem): string {
  const now = new Date().toISOString().slice(0, 10);
  const title = item.title ?? 'Inbox capture';
  const id = slugify(title) || item.id.slice(0, 8);
  const lines = [
    '---',
    `id: ${id}`,
    `title: "${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    'type: note',
    'tier: fast',
    `status: draft`,
    `created: ${now}`,
    `modified: ${now}`,
  ];
  if (item.sourceUrl) {
    lines.push('sources:');
    lines.push(`  - url: "${item.sourceUrl}"`);
    lines.push(`    accessed: "${now}"`);
    lines.push('    type: "web"');
  }
  lines.push('---', '', item.content);
  return lines.join('\n');
}

export async function indexSingleFile(
  db: BrainDB,
  embedder: Embedder,
  filePath: string,
  content: string,
  hash: string,
  mtime: number
): Promise<string> {
  const parsed = parseMarkdown(filePath, content);

  const noteRecord = frontmatterToRecord(parsed);
  db.upsertNote(noteRecord);

  let ftsContent = parsed.content;
  if (noteRecord.contentDir) {
    const dirContent = readIndexableContent(noteRecord.contentDir);
    if (dirContent) {
      ftsContent = ftsContent + '\n\n' + dirContent;
    }
  }
  db.upsertNoteFTS(
    parsed.id,
    parsed.frontmatter.title,
    parsed.frontmatter.summary ?? '',
    ftsContent
  );
  db.upsertNoteFTSTrigram(parsed.id, parsed.frontmatter.title, ftsContent);

  const chunks = rawChunksToChunks(parsed.id, parsed.chunks);
  let vectors: Float32Array[] = [];
  if (chunks.length > 0) {
    const texts = chunks.map((c) => c.content);
    const embeddings = await embedder.embed(texts);
    vectors = embeddings.map((e) => new Float32Array(e));
    db.upsertChunks(parsed.id, chunks, vectors);
  }

  if (parsed.relations.length > 0) {
    db.upsertRelations(parsed.id, parsed.relations);
  }

  const noteLinks = extractNoteLinks(parsed.content);
  const linkRelations: Relation[] = [];
  for (const targetSlug of noteLinks) {
    const targetNote = db.getNoteById(targetSlug);
    if (targetNote && targetSlug !== parsed.id) {
      linkRelations.push({ sourceId: parsed.id, targetId: targetSlug, type: 'related-to' });
    }
  }
  if (linkRelations.length > 0) {
    db.upsertRelations(parsed.id, linkRelations);
  }

  // Auto-link: create edges for semantically similar notes
  if (vectors.length > 0) {
    const autoLinks = computeAutoLinks(db, parsed.id, 0.85, 5, vectors[0]);
    if (autoLinks.length > 0) {
      const existingRelations = db.getRelationsFrom(parsed.id);
      db.upsertRelations(parsed.id, [...existingRelations, ...autoLinks]);
    }
  }

  db.upsertFile({
    path: filePath,
    hash,
    mtime,
    indexedAt: Date.now(),
  });

  return parsed.id;
}

export async function indexFiles(
  db: BrainDB,
  embedder: Embedder,
  notesDir: string,
  opts: { force?: boolean }
): Promise<IndexResult> {
  if (!opts.force) {
    db.checkModelMatch(embedder.model);
  }

  if (opts.force) {
    const allNotes = db.getAllNotes();
    for (const note of allNotes) {
      db.deleteChunksForNote(note.id);
    }
  }

  db.setEmbeddingModel(embedder.model, embedder.dimensions);

  const knownFiles = opts.force ? new Map() : db.getAllFiles();
  const changes = await scanForChanges(notesDir, knownFiles);

  let indexed = 0;
  let deleted = 0;
  const indexedNoteIds: string[] = [];

  const toProcess = [...changes.new, ...changes.modified].filter((f) => !isSkippedFile(f.path));
  for (const file of toProcess) {
    const content = readFileSync(file.path, 'utf-8');
    const noteId = await indexSingleFile(db, embedder, file.path, content, file.hash, file.mtime);
    indexedNoteIds.push(noteId);
    indexed++;
  }

  for (const filePath of changes.deleted.filter((p) => !isSkippedFile(p))) {
    const note = db.getNoteByFilePath(filePath);
    if (note) {
      db.deleteNote(note.id);
    }
    db.deleteFile(filePath);
    deleted++;
  }

  return { indexed, deleted, unchanged: changes.unchanged, indexedNoteIds };
}

export async function processInbox(
  db: BrainDB,
  notesDir: string,
  embedder: Embedder
): Promise<number> {
  const pending = db.getInboxItems('pending');
  let processed = 0;

  for (const item of pending) {
    db.updateInboxStatus(item.id, 'processing');

    try {
      const markdown = inboxItemToMarkdown(item);
      const parsed = parseMarkdown('inbox-item.md', markdown);

      const now = new Date();
      const yyyy = String(now.getFullYear());
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const outPath = join(notesDir, 'logs', yyyy, mm, `${yyyy}-${mm}-${dd}-${parsed.id}.md`);
      const dir = dirname(outPath);

      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(outPath, markdown, 'utf-8');

      const hash = createHash('sha256').update(markdown).digest('hex');
      await indexSingleFile(db, embedder, outPath, markdown, hash, Date.now());

      db.updateInboxStatus(item.id, 'indexed');
      processed++;
    } catch (err) {
      db.updateInboxStatus(item.id, 'failed');
      process.stderr.write(
        `Failed to process inbox item ${item.id}: ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
  }

  return processed;
}

export function generateNoteIndex(db: BrainDB, notesDir: string): void {
  const notes = db.getAllNotes();
  if (notes.length === 0) return;

  const byCategory = new Map<string, NoteRecord[]>();
  for (const note of notes) {
    const cat = note.category ?? 'uncategorized';
    const list = byCategory.get(cat) ?? [];
    list.push(note);
    byCategory.set(cat, list);
  }

  const lines: string[] = ['# Index', ''];
  const sortedCategories = [...byCategory.keys()].sort();

  for (const cat of sortedCategories) {
    const catNotes = byCategory.get(cat)!;
    lines.push(`## ${cat}`, '');
    for (const note of catNotes) {
      const relPath = relative(notesDir, note.filePath);
      const summary = note.summary ? ` — ${note.summary}` : '';
      lines.push(`- [${note.title}](${relPath})${summary}`);
    }
    lines.push('');
  }

  writeFileSync(join(notesDir, '_index.md'), lines.join('\n'), 'utf-8');
}
