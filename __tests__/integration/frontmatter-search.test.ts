import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { BrainDB } from '../../src/services/brain-db.js';
import { indexSingleFile } from '../../src/services/indexing.js';
import { search, computeFacets } from '../../src/services/search.js';
import { tmpDbPath, createMockEmbedder } from '../helpers.js';

let db: BrainDB;
let notesDir: string;
const embedder = createMockEmbedder();

function hashOf(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function writeNote(filename: string, frontmatter: Record<string, unknown>, body: string): string {
  const yamlLines = Object.entries(frontmatter).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}: [${v.join(', ')}]`;
    return `${k}: ${v}`;
  });
  const content = `---\n${yamlLines.join('\n')}\n---\n\n${body}`;
  const filePath = join(notesDir, filename);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

async function indexNote(filePath: string): Promise<void> {
  const content = readFileSync(filePath, 'utf-8');
  await indexSingleFile(db, embedder, filePath, content, hashOf(content), Date.now());
}

beforeEach(() => {
  db = new BrainDB(tmpDbPath('fm-search'));
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `fm-search-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('Frontmatter-aware search filtering (integration)', () => {
  it('indexes custom frontmatter fields into metadata column', async () => {
    const filePath = writeNote('insight-1.md', {
      title: 'WIP Limits Enforcement',
      type: 'insight',
      tier: 'fast',
      'enforcement-strength': 'deterministic',
      'architecture-layer': [1, 3],
    }, 'WIP limits prevent overload by enforcing hard gates.');

    await indexNote(filePath);

    const notes = db.getAllNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].metadata).not.toBeNull();
    const meta = JSON.parse(notes[0].metadata!);
    expect(meta['enforcement-strength']).toBe('deterministic');
    expect(meta['architecture-layer']).toEqual([1, 3]);
  });

  it('--filter narrows search results by scalar metadata field', async () => {
    const f1 = writeNote('insight-det.md', {
      title: 'Deterministic Enforcement',
      type: 'insight',
      tier: 'fast',
      'enforcement-strength': 'deterministic',
    }, 'Hard gates prevent violations deterministically.');

    const f2 = writeNote('insight-struct.md', {
      title: 'Structural Enforcement',
      type: 'insight',
      tier: 'fast',
      'enforcement-strength': 'structural',
    }, 'Structural patterns guide behavior through architecture.');

    await indexNote(f1);
    await indexNote(f2);

    const results = await search(db, embedder, 'enforcement', {
      limit: 10,
      filters: [{ field: 'enforcement-strength', value: 'deterministic' }],
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      const note = db.getNoteById(r.noteId)!;
      const meta = JSON.parse(note.metadata!);
      expect(meta['enforcement-strength']).toBe('deterministic');
    }
  });

  it('--filter matches array field values', async () => {
    const f1 = writeNote('layer-13.md', {
      title: 'Multi-layer insight',
      type: 'insight',
      tier: 'fast',
      'architecture-layer': [1, 3],
    }, 'Spans layer 1 and layer 3.');

    const f2 = writeNote('layer-2.md', {
      title: 'Layer 2 only',
      type: 'insight',
      tier: 'fast',
      'architecture-layer': [2],
    }, 'Only layer 2.');

    await indexNote(f1);
    await indexNote(f2);

    const results = await search(db, embedder, 'layer', {
      limit: 10,
      filters: [{ field: 'architecture-layer', value: '3' }],
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    const noteIds = results.map((r) => r.noteId);
    // layer-13 should match, layer-2 should not
    const allNotes = db.getAllNotes();
    const layer2Note = allNotes.find((n) => n.title === 'Layer 2 only');
    if (layer2Note) {
      expect(noteIds).not.toContain(layer2Note.id);
    }
  });

  it('multiple --filter flags apply AND logic', async () => {
    const f1 = writeNote('both.md', {
      title: 'Both match',
      type: 'insight',
      tier: 'fast',
      'enforcement-strength': 'deterministic',
      'research-quality': 'empirical',
    }, 'Empirically validated deterministic enforcement.');

    const f2 = writeNote('one.md', {
      title: 'One match',
      type: 'insight',
      tier: 'fast',
      'enforcement-strength': 'deterministic',
      'research-quality': 'anecdotal',
    }, 'Anecdotal deterministic enforcement.');

    await indexNote(f1);
    await indexNote(f2);

    const results = await search(db, embedder, 'enforcement', {
      limit: 10,
      filters: [
        { field: 'enforcement-strength', value: 'deterministic' },
        { field: 'research-quality', value: 'empirical' },
      ],
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      const note = db.getNoteById(r.noteId)!;
      const meta = JSON.parse(note.metadata!);
      expect(meta['enforcement-strength']).toBe('deterministic');
      expect(meta['research-quality']).toBe('empirical');
    }
  });

  it('facet computation returns correct distribution', async () => {
    let idx = 0;
    for (const strength of ['deterministic', 'deterministic', 'structural', 'structural', 'procedural']) {
      idx += 1;
      const f = writeNote(`facet-${strength}-${randomUUID().slice(0, 4)}.md`, {
        title: `${strength} insight ${idx}`,
        type: 'insight',
        tier: 'fast',
        'enforcement-strength': strength,
      }, `Insight about ${strength} enforcement.`);
      await indexNote(f);
    }

    const allNotes = db.getAllNotes();
    const noteIds = new Set(allNotes.map((n) => n.id));

    const facets = computeFacets(db, ['enforcement-strength'], noteIds);
    expect(facets).toHaveLength(1);
    expect(facets[0].field).toBe('enforcement-strength');

    const values = facets[0].values;
    expect(values).toHaveLength(3);

    const byValue = Object.fromEntries(values.map((v) => [v.value, v.count]));
    expect(byValue['deterministic']).toBe(2);
    expect(byValue['structural']).toBe(2);
    expect(byValue['procedural']).toBe(1);
  });
});
