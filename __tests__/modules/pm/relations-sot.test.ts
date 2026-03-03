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
import { createTask, listTasks, getTask } from '../../../src/modules/pm/data/task-ops.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('relations-sot'));
  notesDir = join(tmpdir(), `relations-sot-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath: '', embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
  await createProject(db, config, embedder, { name: 'Test', prefix: 'TST' });
  await createWorkstream(db, config, embedder, { project: 'TST', name: 'Core' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) rmSync(notesDir, { recursive: true, force: true });
});

describe('relations as single source of truth', () => {
  it('createTask creates relation edges for depends_on', async () => {
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'First' });
    const t2 = await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Second',
      dependsOn: ['TST-01.01'],
    });
    expect(t2.ok).toBe(true);

    // Verify relation exists
    const note = db
      .getAllNotes()
      .find((n) => JSON.parse(n.metadata ?? '{}').display_id === 'TST-01.02');
    const rels = db.getRelationsFrom(note!.id);
    expect(rels.some((r) => r.type === 'depends_on')).toBe(true);
  });

  it('listTasks shows depends_on from relations even without frontmatter', async () => {
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'First' });
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'Second' });

    // Add relation directly (simulating inferDependencies)
    const notes = db.getAllNotes().filter((n) => JSON.parse(n.metadata ?? '{}').module === 'pm');
    const t1 = notes.find((n) => JSON.parse(n.metadata ?? '{}').display_id === 'TST-01.01');
    const t2 = notes.find((n) => JSON.parse(n.metadata ?? '{}').display_id === 'TST-01.02');
    db.upsertRelations(t2!.id, [{ sourceId: t2!.id, targetId: t1!.id, type: 'depends_on' }]);

    const result = listTasks(db, 'TST');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const second = result.data.find((t) => t.display_id === 'TST-01.02');
    expect(second?.depends_on).toContain('TST-01.01');
  });

  it('getTask shows depends_on from relations', async () => {
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'First' });
    await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Second',
      dependsOn: ['TST-01.01'],
    });
    const result = getTask(db, 'TST-01.02');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.depends_on).toContain('TST-01.01');
  });

  it('virtual state +BLOCKED computed from relations', async () => {
    await createTask(db, config, embedder, { project: 'TST', workstream: 1, name: 'First' });
    await createTask(db, config, embedder, {
      project: 'TST',
      workstream: 1,
      name: 'Second',
      dependsOn: ['TST-01.01'],
    });
    const result = listTasks(db, 'TST');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const second = result.data.find((t) => t.display_id === 'TST-01.02');
    expect(second?.virtualStates).toContain('+BLOCKED');
  });
});
