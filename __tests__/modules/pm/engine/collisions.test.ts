import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb, createTestTask } from '../../../helpers.js';
import { createProject } from '../../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../../src/modules/pm/data/workstream-ops.js';
import {
  detectFileCollisions,
  extractPathReferences,
} from '../../../../src/modules/pm/engine/collisions.js';
import type { BrainConfig } from '../../../../src/types.js';

describe('extractPathReferences', () => {
  it('pulls top-level dir paths from prose', () => {
    const text = 'Update src/foo/bar.ts and __tests__/foo.test.ts to match.';
    expect(extractPathReferences(text)).toEqual(['__tests__/foo.test.ts', 'src/foo/bar.ts']);
  });

  it('matches paths prefixed by backticks or parens', () => {
    const text = 'Touch `src/a.ts` and (docs/b.md).';
    expect(extractPathReferences(text)).toEqual(['docs/b.md', 'src/a.ts']);
  });

  it('strips trailing punctuation', () => {
    const text = 'See src/foo.ts, src/bar.ts. Also templates/x.';
    expect(extractPathReferences(text)).toEqual(['src/bar.ts', 'src/foo.ts', 'templates/x']);
  });

  it('deduplicates repeated paths', () => {
    const text = 'src/a.ts here. Again src/a.ts in another sentence.';
    expect(extractPathReferences(text)).toEqual(['src/a.ts']);
  });

  it('ignores non-allowlisted roots', () => {
    const text = 'Modify node_modules/pkg/index.js — should not count.';
    expect(extractPathReferences(text)).toEqual([]);
  });

  it('returns empty array for text with no paths', () => {
    expect(extractPathReferences('no paths here')).toEqual([]);
  });
});

describe('detectFileCollisions', () => {
  let db: BrainDB;
  const embedder = createMockEmbedder();
  let config: BrainConfig;

  beforeEach(async () => {
    ({ db } = createTestDb());
    config = {
      notesDir: '/tmp/test-collisions',
      dbPath: ':memory:',
      embedder: 'local',
      fusionWeights: { bm25: 0.3, vector: 0.7 },
    };
    const project = await createProject(db, config, embedder, {
      name: 'Collision Test',
      prefix: 'COL',
    });
    if (!project.ok) throw new Error('project');
    const ws = await createWorkstream(db, config, embedder, { project: 'COL', name: 'WS' });
    if (!ws.ok) throw new Error('ws');
  });

  afterEach(() => {
    db.close();
  });

  it('returns empty when no tasks share paths', async () => {
    const t1 = await createTestTask(db, config, embedder, {
      project: 'COL',
      workstream: 1,
      name: 'T01',
      description: 'Modify src/a.ts only.',
    });
    const t2 = await createTestTask(db, config, embedder, {
      project: 'COL',
      workstream: 1,
      name: 'T02',
      description: 'Modify src/b.ts only.',
    });
    if (!t1.ok || !t2.ok) throw new Error('task');

    const collisions = detectFileCollisions(db, ['COL-01.01', 'COL-01.02']);
    expect(collisions).toEqual([]);
  });

  it('detects when two tasks reference the same file', async () => {
    const t1 = await createTestTask(db, config, embedder, {
      project: 'COL',
      workstream: 1,
      name: 'T01',
      description: 'Create src/shared/delivery-review.ts from scratch.',
    });
    const t2 = await createTestTask(db, config, embedder, {
      project: 'COL',
      workstream: 1,
      name: 'T02',
      description: 'Also create src/shared/delivery-review.ts with validation.',
    });
    if (!t1.ok || !t2.ok) throw new Error('task');

    const collisions = detectFileCollisions(db, ['COL-01.01', 'COL-01.02']);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].pattern).toBe('src/shared/delivery-review.ts');
    expect(collisions[0].taskIds).toEqual(['COL-01.01', 'COL-01.02']);
  });

  it('returns one entry per shared path with every overlapping task', async () => {
    await createTestTask(db, config, embedder, {
      project: 'COL',
      workstream: 1,
      name: 'T01',
      description: 'Edit src/a.ts and docs/x.md.',
    });
    await createTestTask(db, config, embedder, {
      project: 'COL',
      workstream: 1,
      name: 'T02',
      description: 'Edit src/a.ts and __tests__/a.test.ts.',
    });
    await createTestTask(db, config, embedder, {
      project: 'COL',
      workstream: 1,
      name: 'T03',
      description: 'Edit src/a.ts once more.',
    });

    const collisions = detectFileCollisions(db, ['COL-01.01', 'COL-01.02', 'COL-01.03']);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].pattern).toBe('src/a.ts');
    expect(collisions[0].taskIds).toEqual(['COL-01.01', 'COL-01.02', 'COL-01.03']);
  });

  it('ignores tasks outside the provided id set', async () => {
    await createTestTask(db, config, embedder, {
      project: 'COL',
      workstream: 1,
      name: 'T01',
      description: 'Edit src/conflict.ts.',
    });
    await createTestTask(db, config, embedder, {
      project: 'COL',
      workstream: 1,
      name: 'T02',
      description: 'Edit src/conflict.ts.',
    });

    const collisions = detectFileCollisions(db, ['COL-01.01']);
    expect(collisions).toEqual([]);
  });

  it('handles unknown task IDs gracefully', () => {
    const collisions = detectFileCollisions(db, ['COL-99.99', 'COL-88.88']);
    expect(collisions).toEqual([]);
  });
});
