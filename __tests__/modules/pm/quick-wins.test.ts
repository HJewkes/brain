import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createStandardProject } from '../../fixtures/pm-project.js';
import { getTask } from '../../../src/modules/pm/data/task-ops.js';
import { computeImpact } from '../../../src/modules/pm/engine/dependency.js';
import { resolveWorkstreamFilter } from '../../../src/modules/pm/ids.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-quick-wins');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-qw-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('resolveWorkstreamFilter accepts display IDs', () => {
  it('accepts plain integer', () => {
    const result = resolveWorkstreamFilter('3');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(3);
  });

  it('accepts display ID like VW-01', () => {
    const result = resolveWorkstreamFilter('VW-01');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(1);
  });

  it('accepts display ID like TEST-06', () => {
    const result = resolveWorkstreamFilter('TEST-06');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(6);
  });

  it('rejects invalid input with dynamic example', () => {
    const result = resolveWorkstreamFilter('not-valid');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain('VOLT-06');
      expect(result.error.message).toContain('PREFIX-NN');
    }
  });
});

describe('complete surfaces newly unblocked tasks', () => {
  it('computeImpact returns newly eligible task IDs after completing a dependency', async () => {
    await createStandardProject(db, config, embedder);

    // Before completing TEST-01.01, impact should show TEST-01.02 (depends only on 01.01)
    // but not TEST-02.02 (also depends on 02.01 which is still pending)
    const impact = computeImpact(db, 'TEST', 'TEST-01.01');
    expect(impact).toContain('TEST-01.02');
    expect(impact).not.toContain('TEST-02.02');
  });

  it('enriched impact includes task details when fetched via getTask', async () => {
    await createStandardProject(db, config, embedder);

    const impact = computeImpact(db, 'TEST', 'TEST-01.01');
    expect(impact.length).toBeGreaterThan(0);

    // Each impacted task should be resolvable via getTask for enriched output
    for (const id of impact) {
      const taskResult = getTask(db, id);
      expect(taskResult.ok).toBe(true);
      if (taskResult.ok) {
        expect(taskResult.data.display_id).toBe(id);
        expect(taskResult.data.priority).toBeDefined();
      }
    }
  });
});

describe('no hardcoded project prefixes in error messages', () => {
  it('resolveWorkstreamFilter error uses generic placeholder', () => {
    const result = resolveWorkstreamFilter('bad-input');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Should not contain VOLT-06 or any specific project prefix
      expect(result.error.message).not.toMatch(/VOLT-\d{2}/);
      // Should use a generic placeholder like PREFIX-NN
      expect(result.error.message).toContain('PREFIX-NN');
    }
  });
});
