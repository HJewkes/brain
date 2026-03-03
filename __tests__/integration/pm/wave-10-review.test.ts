import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { loadModules } from '../../../src/modules/loader.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { pmModule } from '../../../src/modules/pm/index.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { getTask, updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';
import { createDecision } from '../../../src/modules/pm/data/decision-ops.js';
import {
  writePrompt,
  getPrompt,
  getPromptHistory,
} from '../../../src/modules/pm/data/prompt-ops.js';
import { assembleContext } from '../../../src/modules/pm/engine/dispatch.js';
import { computeEligible } from '../../../src/modules/pm/engine/dependency.js';
import { allocateWorktree, getBudget } from '../../../src/modules/pm/engine/worktree.js';
import { createTestTask } from '../../helpers.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    if (typeof cmd === 'string' && cmd.includes('rev-parse --show-toplevel')) {
      return '/fake/repo\n';
    }
    if (typeof cmd === 'string' && cmd.includes('worktree add')) {
      return '';
    }
    return '';
  }),
}));

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  const dbPath = tmpDbPath('pm-wave10');
  db = new BrainDB(dbPath);
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `pm-wave10-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath: '',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await loadModules({ modules: [pmModule] });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('Wave 10: Code Review Lifecycle Tests', () => {
  describe('full task lifecycle', () => {
    it('create -> claim -> start -> complete with dependents unblocked', async () => {
      await createProject(db, config, embedder, { name: 'Lifecycle', prefix: 'LC' });
      await createWorkstream(db, config, embedder, { project: 'LC', name: 'WS1' });

      const t1 = await createTestTask(db, config, embedder, {
        project: 'LC',
        workstream: 1,
        name: 'First task',
      });
      expect(t1.ok).toBe(true);
      if (!t1.ok) return;

      const t2 = await createTestTask(db, config, embedder, {
        project: 'LC',
        workstream: 1,
        name: 'Second task',
        dependsOn: ['LC-01.01'],
      });
      expect(t2.ok).toBe(true);

      // t1 is eligible, t2 is not (depends on t1)
      let eligible = computeEligible(db, 'LC');
      expect(eligible).toContain('LC-01.01');
      expect(eligible).not.toContain('LC-01.02');

      // Transition t1 through lifecycle: pending -> claimed -> in-progress -> done
      const claimed = await updateTaskStatus(db, config, embedder, 'LC-01.01', 'claimed');
      expect(claimed.ok).toBe(true);
      if (!claimed.ok) return;
      expect(claimed.data.status).toBe('claimed');

      const started = await updateTaskStatus(db, config, embedder, 'LC-01.01', 'in-progress');
      expect(started.ok).toBe(true);

      const done = await updateTaskStatus(db, config, embedder, 'LC-01.01', 'done');
      expect(done.ok).toBe(true);

      // Verify t1 is done
      const t1Final = getTask(db, 'LC-01.01');
      expect(t1Final.ok).toBe(true);
      if (!t1Final.ok) return;
      expect(t1Final.data.status).toBe('done');

      // t2 should now be eligible
      eligible = computeEligible(db, 'LC');
      expect(eligible).toContain('LC-01.02');
    });
  });

  describe('decision propagation', () => {
    it('decision impacting a task appears in its dispatch context', async () => {
      await createProject(db, config, embedder, { name: 'DecTest', prefix: 'DT' });
      await createWorkstream(db, config, embedder, { project: 'DT', name: 'WS1' });

      await createTestTask(db, config, embedder, {
        project: 'DT',
        workstream: 1,
        name: 'Task A',
      });
      await createTestTask(db, config, embedder, {
        project: 'DT',
        workstream: 1,
        name: 'Task B',
        dependsOn: ['DT-01.01'],
      });

      // Add decision on Task A that impacts Task B
      const dec = await createDecision(db, config, embedder, {
        project: 'DT',
        name: 'Use SQLite',
        sourceTask: 'DT-01.01',
        impacts: ['DT-01.02'],
        content: 'Decided to use SQLite for storage',
      });
      expect(dec.ok).toBe(true);

      // Verify decision appears in Task B's context
      const ctx = assembleContext(db, 'DT-01.02');
      expect(ctx.ok).toBe(true);
      if (!ctx.ok) return;

      expect(ctx.data.decisions.length).toBeGreaterThan(0);
      expect(ctx.data.decisions.some((d) => d.content === 'Use SQLite')).toBe(true);
    });
  });

  describe('prompt versioning', () => {
    it('v1 is superseded when v2 is written, history shows both', async () => {
      await createProject(db, config, embedder, { name: 'PromptTest', prefix: 'PT' });
      await createWorkstream(db, config, embedder, { project: 'PT', name: 'WS1' });
      await createTestTask(db, config, embedder, {
        project: 'PT',
        workstream: 1,
        name: 'Prompt task',
      });

      // Write v1
      const v1 = await writePrompt(db, config, embedder, {
        project: 'PT',
        task: 'PT-01.01',
        content: 'First version',
      });
      expect(v1.ok).toBe(true);
      if (!v1.ok) return;
      expect(v1.data.version).toBe(1);
      expect(v1.data.prompt_status).toBe('current');

      // Write v2 (supersedes v1)
      const v2 = await writePrompt(db, config, embedder, {
        project: 'PT',
        task: 'PT-01.01',
        content: 'Second version',
      });
      expect(v2.ok).toBe(true);
      if (!v2.ok) return;
      expect(v2.data.version).toBe(2);
      expect(v2.data.prompt_status).toBe('current');

      // Current prompt should be v2
      const current = getPrompt(db, 'PT-01.01');
      expect(current.ok).toBe(true);
      if (!current.ok) return;
      expect(current.data.version).toBe(2);
      expect(current.data.content).toContain('Second version');

      // v1 should be superseded
      const v1Check = getPrompt(db, 'PT-01.01', 1);
      expect(v1Check.ok).toBe(true);
      if (!v1Check.ok) return;
      expect(v1Check.data.prompt_status).toBe('superseded');

      // History should show both
      const history = getPromptHistory(db, 'PT-01.01');
      expect(history.ok).toBe(true);
      if (!history.ok) return;
      expect(history.data).toHaveLength(2);
      expect(history.data[0].version).toBe(1);
      expect(history.data[1].version).toBe(2);
    });
  });

  describe('worktree budget enforcement', () => {
    it('rejects allocation beyond budget limit', () => {
      const budget = 2;

      const a1 = allocateWorktree(db, 'task-a', 'ws-a', 'tok-a', budget);
      expect(a1.ok).toBe(true);

      const a2 = allocateWorktree(db, 'task-b', 'ws-b', 'tok-b', budget);
      expect(a2.ok).toBe(true);

      // Budget is full
      const budgetStatus = getBudget(db, budget);
      expect(budgetStatus.used).toBe(2);
      expect(budgetStatus.available).toBe(0);

      // Third allocation should fail
      const a3 = allocateWorktree(db, 'task-c', 'ws-c', 'tok-c', budget);
      expect(a3.ok).toBe(false);
      if (a3.ok) return;
      expect(a3.error.code).toBe('WIP_LIMIT');
    });
  });
});
