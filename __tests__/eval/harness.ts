import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import jsYaml from 'js-yaml';
import { BrainDB } from '../../src/services/brain-db.js';
import { LocalEmbedder } from '../../src/adapters/local-embedder.js';
import { parseMarkdown, estimateTokens } from '../../src/services/markdown-parser.js';
import { search } from '../../src/services/search.js';
import type { Chunk, RawChunk, SearchResult } from '../../src/types.js';
import type { EvalCorpus, CorpusNote } from '../fixtures/corpus-types.js';

export interface EvalEnvironment {
  dbPath: string;
  notesDir: string;
  cleanup: () => void;
  db: BrainDB;
  embedder: LocalEmbedder;
  search: (query: string, k?: number) => Promise<SearchResult[]>;
}

export interface EvalResult {
  queryId: string;
  queryType: string;
  retrieved: string[];
  relevant: Set<string>;
  scores: number[];
}

function noteToMarkdown(note: CorpusNote): string {
  const fm: Record<string, unknown> = { ...note.frontmatter };
  if (note.id) fm.id = note.id;
  const yamlBlock = jsYaml.dump(fm).trim();
  return `---\n${yamlBlock}\n---\n\n${note.body}`;
}

function rawChunksToChunks(
  noteId: string,
  rawChunks: Array<{ heading: string | null; text: string; tokenCount: number }>
): Chunk[] {
  return rawChunks.map((rc, i) => ({
    id: `${noteId}::chunk-${i}`,
    noteId,
    heading: rc.heading,
    content: rc.text,
    tokenCount: rc.tokenCount,
    chunkType: 'section' as const,
  }));
}

function rechunkBody(body: string, maxTokens: number): RawChunk[] {
  const lines = body.split('\n');
  const sections: Array<{ heading: string | null; lines: string[] }> = [];
  let current: { heading: string | null; lines: string[] } = { heading: null, lines: [] };

  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      sections.push(current);
      current = { heading: match[2], lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);

  const chunks: RawChunk[] = [];
  const MIN_CHUNK_LENGTH = 20;

  for (const section of sections) {
    const text = section.lines.join('\n').trim();
    if (text.length < MIN_CHUNK_LENGTH) continue;

    const tokens = estimateTokens(text);
    if (tokens <= maxTokens) {
      chunks.push({ heading: section.heading, text, tokenCount: tokens });
    } else {
      const paragraphs = text.split(/\n\n+/);
      let buffer = '';

      for (const para of paragraphs) {
        const candidate = buffer.length > 0 ? buffer + '\n\n' + para : para;
        if (estimateTokens(candidate) > maxTokens && buffer.length > 0) {
          const tokenCount = estimateTokens(buffer);
          chunks.push({ heading: section.heading, text: buffer.trim(), tokenCount });
          buffer = para;
        } else {
          buffer = candidate;
        }
      }

      if (buffer.trim().length >= MIN_CHUNK_LENGTH) {
        const tokenCount = estimateTokens(buffer);
        chunks.push({ heading: section.heading, text: buffer.trim(), tokenCount });
      }
    }
  }

  return chunks;
}

export async function setupEvalEnvironment(
  corpus: EvalCorpus,
  options?: { chunkSize?: number }
): Promise<EvalEnvironment> {
  const tempDir = mkdtempSync(join(tmpdir(), 'brain-eval-'));
  const notesDir = join(tempDir, 'notes');
  const dbPath = join(tempDir, 'eval.db');

  mkdirSync(notesDir, { recursive: true });

  for (const note of corpus.notes) {
    const filePath = join(notesDir, note.filename);
    writeFileSync(filePath, noteToMarkdown(note), 'utf-8');
  }

  const db = new BrainDB(dbPath);
  const embedder = new LocalEmbedder();

  db.setEmbeddingModel(embedder.model, embedder.dimensions);

  for (const note of corpus.notes) {
    const filePath = join(notesDir, note.filename);
    const content = noteToMarkdown(note);
    const parsed = parseMarkdown(filePath, content);

    const noteRecord = {
      id: parsed.id,
      filePath: parsed.filePath,
      title: parsed.frontmatter.title,
      type: parsed.frontmatter.type,
      tier: parsed.frontmatter.tier,
      category: parsed.frontmatter.category ?? null,
      tags: parsed.frontmatter.tags ? parsed.frontmatter.tags.join(',') : null,
      summary: parsed.frontmatter.summary ?? null,
      confidence: parsed.frontmatter.confidence ?? null,
      status: parsed.frontmatter.status ?? ('current' as const),
      sources: parsed.frontmatter.sources ? JSON.stringify(parsed.frontmatter.sources) : null,
      createdAt: parsed.frontmatter.created ?? null,
      modifiedAt: parsed.frontmatter.modified ?? null,
      lastReviewed: parsed.frontmatter['last-reviewed'] ?? null,
      reviewInterval: parsed.frontmatter['review-interval'] ?? null,
      expires: parsed.frontmatter.expires ?? null,
      metadata: null,
    };

    db.upsertNote(noteRecord);
    db.upsertNoteFTS(
      parsed.id,
      parsed.frontmatter.title,
      parsed.frontmatter.summary ?? '',
      parsed.content
    );

    const rawChunks = options?.chunkSize
      ? rechunkBody(parsed.content, options.chunkSize)
      : parsed.chunks;
    const chunks = rawChunksToChunks(parsed.id, rawChunks);
    if (chunks.length > 0) {
      const texts = chunks.map((c) => c.content);
      const embeddings = await embedder.embed(texts);
      const vectors = embeddings.map((e) => new Float32Array(e));
      db.upsertChunks(parsed.id, chunks, vectors);
    }

    if (parsed.relations.length > 0) {
      db.upsertRelations(parsed.id, parsed.relations);
    }
  }

  const searchHelper = async (query: string, k = 5): Promise<SearchResult[]> => {
    return search(db, embedder, query, { limit: k });
  };

  const cleanup = (): void => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  };

  return { dbPath, notesDir, cleanup, db, embedder, search: searchHelper };
}

export async function runEvalSuite(
  corpus: EvalCorpus,
  env: EvalEnvironment,
  options?: {
    k?: number;
    fusionWeights?: { bm25: number; vector: number };
    chunkSize?: number;
  }
): Promise<EvalResult[]> {
  const k = options?.k ?? 5;
  const fusionWeights = options?.fusionWeights;

  const results: EvalResult[] = [];

  for (const query of corpus.queries) {
    const searchResults = await search(
      env.db,
      env.embedder,
      query.text,
      { limit: k },
      fusionWeights
    );

    results.push({
      queryId: query.id,
      queryType: query.type,
      retrieved: searchResults.map((r) => r.noteId),
      relevant: new Set(query.relevantNoteIds),
      scores: searchResults.map((r) => r.score),
    });
  }

  return results;
}
