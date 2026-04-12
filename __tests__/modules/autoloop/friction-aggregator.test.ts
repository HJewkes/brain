import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { aggregateFrictionPatterns } from '../../../src/modules/autoloop/engine/friction-aggregator.js';
import type { BrainDB } from '../../../src/services/brain-db.js';
import type { BrainConfig, Embedder, NoteRecord } from '../../../src/types.js';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

vi.mock('../../../src/services/indexing.js', () => ({
  indexSingleFile: vi.fn().mockResolvedValue('note-promoted-1'),
}));

function makeNote(id: string, title: string, sessions: string[], confidence = 0.8): NoteRecord {
  return {
    id,
    title,
    filePath: `/tmp/notes/${id}.md`,
    hash: 'abc',
    summary: `Friction: ${title}`,
    tags: '',
    tier: 'slow',
    metadata: JSON.stringify({
      category: 'friction',
      confidence,
      source_sessions: sessions,
      source_session_count: sessions.length,
    }),
    indexed_at: Date.now(),
  } as NoteRecord;
}

function mockDb(notes: NoteRecord[]): BrainDB {
  const notesMap = new Map(notes.map((n) => [n.id, n]));
  return {
    getModuleNoteIds: vi.fn().mockReturnValue(notes.map((n) => n.id)),
    getNotesByIds: vi.fn().mockReturnValue(notesMap),
  } as unknown as BrainDB;
}

function mockEmbedder(): Embedder {
  return {
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    dimensions: 768,
  } as unknown as Embedder;
}

describe('aggregateFrictionPatterns', () => {
  let tempDir: string;
  let obsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'friction-agg-'));
    obsDir = join(
      homedir(),
      '.claude',
      'workflow-improvement',
      'observations',
      tempDir.replace(/\//g, '-').replace(/^-/, '')
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (existsSync(obsDir)) {
      rmSync(obsDir, { recursive: true, force: true });
    }
  });

  const config: BrainConfig = {
    notesDir: tempDir,
  } as BrainConfig;

  it('returns empty result when no friction insights exist', async () => {
    const db = mockDb([]);
    const result = await aggregateFrictionPatterns(db, config, mockEmbedder());

    expect(result.insightsScanned).toBe(0);
    expect(result.errors).toContain('No friction insights found');
  });

  it('clusters similar friction titles together', async () => {
    const notes = [
      makeNote('n1', 'ONNX model loading fails consistently in worktrees', ['s1']),
      makeNote('n2', 'ONNX model loading fails consistently in worktrees', ['s2']),
      makeNote('n3', 'ONNX model loading fails consistently in worktrees during tests', ['s3']),
      makeNote('n4', 'Unrelated network timeout hitting external API', ['s4']),
    ];
    const db = mockDb(notes);

    const result = await aggregateFrictionPatterns(
      db,
      { ...config, notesDir: tempDir },
      mockEmbedder(),
      {
        minSessions: 3,
        projectDir: tempDir,
      }
    );

    expect(result.insightsScanned).toBe(4);
    expect(result.clustersFound).toBeGreaterThanOrEqual(2);

    const onnxCluster = result.clusters.find((c) => c.pattern.includes('ONNX'));
    expect(onnxCluster).toBeDefined();
    expect(onnxCluster!.sessionCount).toBe(3);
  });

  it('promotes clusters meeting the threshold', async () => {
    const notes = [
      makeNote('n1', 'Test timeout in CI environment', ['s1']),
      makeNote('n2', 'Test timeout in CI environment', ['s2']),
      makeNote('n3', 'Test timeout in CI environment', ['s3']),
    ];
    const db = mockDb(notes);

    const result = await aggregateFrictionPatterns(
      db,
      { ...config, notesDir: tempDir },
      mockEmbedder(),
      {
        minSessions: 3,
        projectDir: tempDir,
      }
    );

    expect(result.promotedCount).toBe(1);
    expect(result.observationsWritten).toBe(1);
  });

  it('does not promote below threshold', async () => {
    const notes = [makeNote('n1', 'Rare issue A', ['s1']), makeNote('n2', 'Rare issue B', ['s2'])];
    const db = mockDb(notes);

    const result = await aggregateFrictionPatterns(
      db,
      { ...config, notesDir: tempDir },
      mockEmbedder(),
      {
        minSessions: 3,
        projectDir: tempDir,
      }
    );

    expect(result.promotedCount).toBe(0);
    expect(result.observationsWritten).toBe(0);
  });

  it('skips duplicates already in workflow observations', async () => {
    const notes = [
      makeNote('n1', 'Test timeout in CI', ['s1']),
      makeNote('n2', 'Test timeout in CI', ['s2']),
      makeNote('n3', 'Test timeout in CI', ['s3']),
    ];
    const db = mockDb(notes);

    // Pre-create an existing observation with similar description
    const dirHash = tempDir.replace(/\//g, '-').replace(/^-/, '');
    const existingObsDir = join(
      homedir(),
      '.claude',
      'workflow-improvement',
      'observations',
      dirHash
    );
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(existingObsDir, { recursive: true });
    writeFileSync(
      join(existingObsDir, 'pending.jsonl'),
      JSON.stringify({
        date: new Date().toISOString(),
        category: 'friction',
        description: 'Test timeout in CI consistently',
        source: 'manual',
      }) + '\n'
    );

    const result = await aggregateFrictionPatterns(
      db,
      { ...config, notesDir: tempDir },
      mockEmbedder(),
      {
        minSessions: 3,
        projectDir: tempDir,
      }
    );

    expect(result.duplicatesSkipped).toBe(1);
    expect(result.promotedCount).toBe(0);
  });

  it('uses highest confidence from cluster members', async () => {
    const notes = [
      makeNote('n1', 'Slow embedder response', ['s1'], 0.6),
      makeNote('n2', 'Slow embedder response', ['s2'], 0.95),
      makeNote('n3', 'Slow embedder response', ['s3'], 0.7),
    ];
    const db = mockDb(notes);

    const result = await aggregateFrictionPatterns(
      db,
      { ...config, notesDir: tempDir },
      mockEmbedder(),
      {
        minSessions: 3,
        projectDir: tempDir,
      }
    );

    const cluster = result.clusters[0];
    expect(cluster.confidence).toBe(0.95);
  });
});
