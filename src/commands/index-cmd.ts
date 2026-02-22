import { Command } from '@commander-js/extra-typings';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { loadConfig } from '../services/config.js';
import { BrainDB } from '../services/brain-db.js';
import { createEmbedder } from '../adapters/index.js';
import { scanForChanges } from '../services/file-scanner.js';
import { parseMarkdown } from '../services/markdown-parser.js';
import type { Chunk, InboxItem, NoteRecord, RawChunk } from '../types.js';

export const indexCommand = new Command('index')
  .description('Index new and modified notes')
  .option('--force', 'force full re-index (clears all chunks/vectors)')
  .option('--quiet', 'suppress output')
  .option('--json', 'output result as JSON')
  .option('--inbox', 'also process pending inbox items into notes')
  .action(async (opts) => {
    const config = loadConfig();
    const db = new BrainDB(config.dbPath);
    const embedder = createEmbedder(config);

    try {
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
      const changes = await scanForChanges(config.notesDir, knownFiles);

      const isSkipped = (filePath: string): boolean =>
        filePath.includes('/_templates/') || basename(filePath) === '_index.md';

      let indexed = 0;
      let deleted = 0;

      const toProcess = [...changes.new, ...changes.modified].filter((f) => !isSkipped(f.path));
      for (const file of toProcess) {
        const content = readFileSync(file.path, 'utf-8');
        const parsed = parseMarkdown(file.path, content);

        const noteRecord = frontmatterToRecord(parsed);
        db.upsertNote(noteRecord);
        db.upsertNoteFTS(
          parsed.id,
          parsed.frontmatter.title,
          parsed.frontmatter.summary ?? '',
          parsed.content
        );

        const chunks = rawChunksToChunks(parsed.id, parsed.chunks);
        if (chunks.length > 0) {
          const texts = chunks.map((c) => c.content);
          const embeddings = await embedder.embed(texts);
          const vectors = embeddings.map((e) => new Float32Array(e));
          db.upsertChunks(parsed.id, chunks, vectors);
        }

        if (parsed.relations.length > 0) {
          db.upsertRelations(parsed.id, parsed.relations);
        }

        db.upsertFile({
          path: file.path,
          hash: file.hash,
          mtime: file.mtime,
          indexedAt: Date.now(),
        });

        indexed++;
      }

      for (const filePath of changes.deleted.filter((p) => !isSkipped(p))) {
        const allNotes = db.getAllNotes();
        const note = allNotes.find((n) => n.filePath === filePath);
        if (note) {
          db.deleteNote(note.id);
        }
        db.deleteFile(filePath);
        deleted++;
      }

      let inboxProcessed = 0;
      if (opts.inbox) {
        inboxProcessed = await processInbox(db, config.notesDir, embedder);
      }

      generateIndex(db, config.notesDir);

      const summary = {
        indexed,
        deleted,
        unchanged: changes.unchanged,
        inboxProcessed,
        total: db.getAllNotes().length,
      };

      if (opts.json) {
        process.stdout.write(JSON.stringify(summary) + '\n');
      } else if (!opts.quiet) {
        process.stderr.write(
          `Indexed ${indexed} file(s), deleted ${deleted}, unchanged ${changes.unchanged}\n`
        );
        if (inboxProcessed > 0) {
          process.stderr.write(`Inbox: processed ${inboxProcessed} item(s)\n`);
        }
        process.stderr.write(`Total notes: ${summary.total}\n`);
      }
    } finally {
      db.close();
    }
  });

function frontmatterToRecord(parsed: ReturnType<typeof parseMarkdown>): NoteRecord {
  const fm = parsed.frontmatter;
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
    metadata: null,
  };
}

function chunkId(noteId: string, content: string): string {
  const hash = createHash('sha256').update(`${noteId}:${content}`).digest('hex').slice(0, 16);
  return `${noteId}::${hash}`;
}

function rawChunksToChunks(noteId: string, rawChunks: RawChunk[]): Chunk[] {
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

function generateIndex(db: BrainDB, notesDir: string): void {
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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function inboxItemToMarkdown(item: InboxItem): string {
  const now = new Date().toISOString().slice(0, 10);
  const title = item.title ?? 'Inbox capture';
  const id = slugify(title) || item.id.slice(0, 8);
  const lines = [
    '---',
    `id: ${id}`,
    `title: "${title}"`,
    'type: note',
    'tier: fast',
    `status: draft`,
    `created: ${now}`,
    `modified: ${now}`,
    '---',
    '',
    item.content,
  ];
  if (item.sourceUrl) {
    lines.push('', `Source: ${item.sourceUrl}`);
  }
  return lines.join('\n');
}

async function processInbox(
  db: BrainDB,
  notesDir: string,
  embedder: { embed(texts: string[]): Promise<number[][]>; readonly model: string }
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

      parsed.filePath = outPath;
      const noteRecord = frontmatterToRecord(parsed);
      noteRecord.filePath = outPath;
      db.upsertNote(noteRecord);
      db.upsertNoteFTS(
        parsed.id,
        parsed.frontmatter.title,
        parsed.frontmatter.summary ?? '',
        parsed.content
      );

      const chunks = rawChunksToChunks(parsed.id, parsed.chunks);
      if (chunks.length > 0) {
        const texts = chunks.map((c) => c.content);
        const embeddings = await embedder.embed(texts);
        const vectors = embeddings.map((e) => new Float32Array(e));
        db.upsertChunks(parsed.id, chunks, vectors);
      }

      db.upsertFile({
        path: outPath,
        hash: createHash('sha256').update(markdown).digest('hex'),
        mtime: Date.now(),
        indexedAt: Date.now(),
      });

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
