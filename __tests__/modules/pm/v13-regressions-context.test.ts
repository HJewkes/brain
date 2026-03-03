import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';

import { assembleContext } from '../../../src/modules/pm/engine/dispatch.js';
import { createTestTask } from '../../helpers.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('reg-ctx'));
  notesDir = join(tmpdir(), `reg-ctx-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath: '', embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
  await createProject(db, config, embedder, { name: 'Volt', prefix: 'VOLT' });
  await createWorkstream(db, config, embedder, { project: 'VOLT', name: 'Core' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
});

describe('context regressions', () => {
  // O-50: context assembly returns task metadata
  it('O-50: assembleContext returns task metadata', async () => {
    await createTestTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'Context test' });
    const result = assembleContext(db, 'VOLT-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.task).toBeDefined();
    expect(result.data.task.display_id).toBe('VOLT-01.01');
  });

  // O-51: context includes workstream info
  it('O-51: context includes workstream', async () => {
    await createTestTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'WS test' });
    const result = assembleContext(db, 'VOLT-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.workstream).toBeDefined();
    expect(result.data.workstream!.displayId).toBe('VOLT-01');
    expect(result.data.workstream!.title).toBeTruthy();
  });

  // O-64: context includes dependencies
  it('O-64: context includes dependency info', async () => {
    await createTestTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'First' });
    await createTestTask(db, config, embedder, {
      project: 'VOLT', workstream: 1, name: 'Second', dependsOn: ['VOLT-01.01'],
    });
    const result = assembleContext(db, 'VOLT-01.02');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.dependencies).toBeDefined();
    expect(result.data.dependencies.length).toBeGreaterThan(0);
    expect(result.data.dependencies[0].displayId).toBe('VOLT-01.01');
    expect(result.data.dependencies[0].direction).toBe('upstream');
  });

  // O-65: context for non-existent task returns error
  it('O-65: context for missing task fails gracefully', () => {
    const result = assembleContext(db, 'VOLT-99.99');
    expect(result.ok).toBe(false);
  });

  // O-75: context includes task body
  it('O-75: context includes task body', async () => {
    await createTestTask(db, config, embedder, {
      project: 'VOLT', workstream: 1, name: 'With body',
      description: 'This is the body content',
    });
    const result = assembleContext(db, 'VOLT-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.body).toBeDefined();
    expect(result.data.body).toContain('This is the body content');
  });

  // O-76: context hash is deterministic for same state
  it('O-76: context hash is deterministic', async () => {
    await createTestTask(db, config, embedder, { project: 'VOLT', workstream: 1, name: 'Hash test' });
    const r1 = assembleContext(db, 'VOLT-01.01');
    const r2 = assembleContext(db, 'VOLT-01.01');
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.data.contextHash).toBe(r2.data.contextHash);
    expect(typeof r1.data.contextHash).toBe('string');
    expect(r1.data.contextHash.length).toBeGreaterThan(0);
  });
});
