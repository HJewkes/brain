import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import {
  writeResource,
  readResourceFastPath,
} from '../../../src/modules/workflow/engine/fast-path.js';
import type { ResourceMetadata } from '../../../src/modules/workflow/types.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(() => {
  ({ dbPath, db } = createTestDb());
  notesDir = join(tmpdir(), `wf-resource-${randomUUID()}`);
  mkdirSync(join(notesDir, 'modules', 'workflow', 'resources'), { recursive: true });
  config = { notesDir, dbPath, embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

function makeResource(overrides: Partial<ResourceMetadata> = {}): ResourceMetadata {
  return {
    display_id: overrides.display_id ?? `RES-${randomUUID().slice(0, 4)}`,
    resource_type: overrides.resource_type ?? 'worktree',
    project: overrides.project ?? 'SDK',
    status: overrides.status ?? 'active',
    data: overrides.data ?? {
      path: '/tmp/sdk-worktree',
      branch: 'feat/mock-infra',
      task: 'SDK-02.01',
    },
  };
}

// --- AC-11: Resource Notes ---

describe('writeResource (dual-write)', () => {
  test('AC-11: creates resource note in DB and JSON sidecar file', async () => {
    const resource = makeResource();
    const result = await writeResource(db, config, embedder, resource);

    expect(result.ok).toBe(true);

    const sidecarPath = join(
      notesDir,
      'modules',
      'workflow',
      'resources',
      `${resource.display_id}.json`
    );
    expect(existsSync(sidecarPath)).toBe(true);

    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
    expect(sidecar.type).toBe('worktree');
    expect(sidecar.project).toBe('SDK');
    expect(sidecar.status).toBe('active');
  });

  test('AC-11: sidecar is written atomically via temp file + rename', async () => {
    const resource = makeResource();
    const result = await writeResource(db, config, embedder, resource);
    expect(result.ok).toBe(true);

    const sidecarPath = join(
      notesDir,
      'modules',
      'workflow',
      'resources',
      `${resource.display_id}.json`
    );
    const content = readFileSync(sidecarPath, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  test('AC-11: resource data is readable via fast-path after write', async () => {
    const resource = makeResource({ display_id: 'RES-fp01' });
    await writeResource(db, config, embedder, resource);

    const fastPathResult = readResourceFastPath(notesDir, 'RES-fp01');
    expect(fastPathResult).not.toBeNull();
    expect(fastPathResult!.type).toBe('worktree');
    expect(fastPathResult!.project).toBe('SDK');
  });
});

// --- AC-E7: Resource Dual-Write Failure ---

describe('dual-write failure handling', () => {
  test('AC-E7: DB is rolled back when sidecar write fails', async () => {
    const readOnlyDir = join(tmpdir(), `wf-ro-${randomUUID()}`);
    mkdirSync(join(readOnlyDir, 'modules', 'workflow', 'resources'), { recursive: true });
    const roConfig: BrainConfig = { ...config, notesDir: readOnlyDir };

    const { chmodSync } = await import('node:fs');
    chmodSync(join(readOnlyDir, 'modules', 'workflow', 'resources'), 0o444);

    const resource = makeResource();
    const result = await writeResource(db, roConfig, embedder, resource);

    expect(result.ok).toBe(false);

    chmodSync(join(readOnlyDir, 'modules', 'workflow', 'resources'), 0o755);
    rmSync(readOnlyDir, { recursive: true, force: true });
  });
});
