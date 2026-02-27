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
import { createStandardProject } from '../../fixtures/pm-project.js';
import { computeRouting, isAgentDispatchable } from '../../../src/modules/pm/engine/routing.js';
import type { RoutingResult } from '../../../src/modules/pm/engine/routing.js';
import {
  renderAgentPrompt,
  renderVerificationPrompt,
  renderBriefingSummary,
} from '../../../src/modules/pm/engine/template.js';
import type { ContextBundle } from '../../../src/modules/pm/engine/dispatch.js';
import { assembleContext } from '../../../src/modules/pm/engine/dispatch.js';
import {
  allocateWorktree,
  releaseWorktree,
  getBudget,
  checkWorktreePath,
} from '../../../src/modules/pm/engine/worktree.js';

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
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-wave9');
  db = new BrainDB(dbPath);
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `pm-wave9-${randomUUID()}`);
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

describe('V8: Orchestrator Dry Run', () => {
  describe('routing computation', () => {
    it('routes implementation task to opus with worktree', () => {
      const result: RoutingResult = computeRouting('implementation', 'agent');

      expect(result.model).toBe('opus');
      expect(result.isolation).toBe('worktree');
      expect(result.agentType).toBe('general-purpose');
      expect(result.verify).toBe(true);
      expect(result.concurrency).toBe('sequential-within-workstream');
    });

    it('routes research task to sonnet with Explore', () => {
      const result: RoutingResult = computeRouting('research', 'agent');

      expect(result.model).toBe('sonnet');
      expect(result.agentType).toBe('Explore');
      expect(result.isolation).toBe('none');
      expect(result.verify).toBe(false);
      expect(result.concurrency).toBe('parallel');
    });

    it('returns non-dispatchable routing for assisted mode', () => {
      expect(isAgentDispatchable('assisted')).toBe(false);
      expect(isAgentDispatchable('human')).toBe(false);

      const result: RoutingResult = computeRouting('implementation', 'assisted');

      expect(result.model).toBe('sonnet');
      expect(result.isolation).toBe('none');
      expect(result.verify).toBe(false);
      expect(result.concurrency).toBe('parallel');
    });
  });

  describe('template rendering', () => {
    function makeBundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
      return {
        task: {
          display_id: 'TEST-01.01',
          project: 'TEST',
          workstream: 1,
          number: 1,
          status: 'pending',
          mode: 'agent',
          category: 'implementation',
          priority: 'high',
          depends_on: [],
          ...overrides.task,
        },
        prompt: overrides.prompt ?? 'Implement the feature',
        dependencies: overrides.dependencies ?? [],
        decisions: overrides.decisions ?? [],
        constraints: overrides.constraints ?? [],
        contextHash: overrides.contextHash ?? 'abc123',
      };
    }

    it('renders agent prompt with dependencies and decisions', () => {
      const bundle = makeBundle({
        dependencies: [
          { displayId: 'TEST-01.00', name: 'Setup', status: 'done', summary: 'Completed setup' },
        ],
        decisions: [
          { displayId: 'TEST-D1', status: 'accepted', content: 'Use SQLite for storage' },
        ],
      });

      const prompt = renderAgentPrompt(bundle);

      expect(prompt).toContain('# Task TEST-01.01');
      expect(prompt).toContain('## Dependencies');
      expect(prompt).toContain('TEST-01.00');
      expect(prompt).toContain('Setup');
      expect(prompt).toContain('done');
      expect(prompt).toContain('## Decisions');
      expect(prompt).toContain('TEST-D1');
      expect(prompt).toContain('Use SQLite for storage');
      expect(prompt).toContain('Implement the feature');
    });

    it('renders verification prompt with check commands', () => {
      const bundle = makeBundle();
      const prompt = renderVerificationPrompt(bundle);

      expect(prompt).toContain('# Verification: TEST-01.01');
      expect(prompt).toContain('npm test');
      expect(prompt).toContain('npm run typecheck');
      expect(prompt).toContain('npm run lint');
      expect(prompt).toContain('npm run build');
      expect(prompt).toContain('PASS or FAIL');
    });

    it('renders briefing summary from project state', () => {
      const briefingJson = {
        projectName: 'Brain',
        status: 'active',
        tasks: [
          { displayId: 'B-01.01', name: 'Setup', status: 'done' },
          { displayId: 'B-01.02', name: 'Implement', status: 'in-progress' },
          { displayId: 'B-01.03', name: 'Test', status: 'pending' },
          { displayId: 'B-02.01', name: 'Deploy', status: 'blocked' },
        ],
        recommendations: ['Focus on B-01.02 first'],
      };

      const summary = renderBriefingSummary(briefingJson);

      expect(summary).toContain('# Brain');
      expect(summary).toContain('Status: **active**');
      expect(summary).toContain('| Done | 1 |');
      expect(summary).toContain('| In Progress | 1 |');
      expect(summary).toContain('| Eligible | 1 |');
      expect(summary).toContain('| Blocked | 1 |');
      expect(summary).toContain('**Total** | **4**');
      expect(summary).toContain('## Eligible Tasks');
      expect(summary).toContain('B-01.03: Test');
      expect(summary).toContain('## Recommendations');
      expect(summary).toContain('Focus on B-01.02 first');
    });

    it('includes worktree path when provided', () => {
      const bundle = makeBundle();

      const withWorktree = renderAgentPrompt(bundle, {
        worktreePath: '/fake/repo/.worktrees/ws1',
      });
      expect(withWorktree).toContain('Work in: `/fake/repo/.worktrees/ws1`');

      const withoutWorktree = renderAgentPrompt(bundle);
      expect(withoutWorktree).toContain('No isolation');
    });
  });

  describe('worktree budget', () => {
    it('allocates worktree within budget', () => {
      const result = allocateWorktree(db, 'task-1', 'ws-1', 'token-1', 3);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.taskId).toBe('task-1');
      expect(result.data.workstream).toBe('ws-1');
      expect(result.data.path).toBe('/fake/repo/.worktrees/ws-1');
      expect(result.data.branch).toBe('worktree/ws-1');

      const budget = getBudget(db, 3);
      expect(budget.used).toBe(1);
      expect(budget.available).toBe(2);
    });

    it('rejects allocation when budget exceeded', () => {
      allocateWorktree(db, 'task-1', 'ws-1', 'token-1', 2);
      allocateWorktree(db, 'task-2', 'ws-2', 'token-2', 2);

      const result = allocateWorktree(db, 'task-3', 'ws-3', 'token-3', 2);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('WIP_LIMIT');
    });

    it('reuses worktree for same workstream', () => {
      const first = allocateWorktree(db, 'task-1', 'ws-1', 'token-1', 3);
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const second = allocateWorktree(db, 'task-2', 'ws-1', 'token-2', 3);
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      expect(second.data.path).toBe(first.data.path);
      expect(second.data.branch).toBe(first.data.branch);

      const budget = getBudget(db, 3);
      expect(budget.used).toBe(2);
      // Only 1 unique worktree path, so next different workstream should still work
      const third = allocateWorktree(db, 'task-3', 'ws-2', 'token-3', 3);
      expect(third.ok).toBe(true);
    });

    it('releases worktree and frees budget slot', () => {
      allocateWorktree(db, 'task-1', 'ws-1', 'token-1', 3);
      allocateWorktree(db, 'task-2', 'ws-2', 'token-2', 3);

      const budgetBefore = getBudget(db, 3);
      expect(budgetBefore.used).toBe(2);

      const released = releaseWorktree(db, 'task-1');
      expect(released.ok).toBe(true);
      if (!released.ok) return;
      expect(released.data.released).toBe(true);

      const budgetAfter = getBudget(db, 3);
      expect(budgetAfter.used).toBe(1);
      expect(budgetAfter.available).toBe(2);
    });
  });

  describe('context assembly + routing integration', () => {
    it('assembles context and routes in sequence', async () => {
      await createStandardProject(db, config, embedder);

      const ctxResult = assembleContext(db, 'TEST-01.01');
      expect(ctxResult.ok).toBe(true);
      if (!ctxResult.ok) return;

      const bundle = ctxResult.data;
      expect(bundle.task.display_id).toBe('TEST-01.01');
      expect(bundle.task.project).toBe('TEST');
      expect(bundle.task.category).toBe('implementation');

      // Default mode is 'auto' which is non-dispatchable
      expect(bundle.task.mode).toBe('auto');
      expect(isAgentDispatchable(bundle.task.mode)).toBe(false);

      const defaultRouting = computeRouting(bundle.task.category, bundle.task.mode);
      expect(defaultRouting.model).toBe('sonnet');
      expect(defaultRouting.isolation).toBe('none');

      // Override to agent mode to get full routing
      const agentRouting = computeRouting(bundle.task.category, 'agent');
      expect(agentRouting.model).toBe('opus');
      expect(agentRouting.isolation).toBe('worktree');

      const prompt = renderAgentPrompt(bundle, {
        worktreePath: '/fake/repo/.worktrees/ws-1',
      });

      expect(prompt).toContain('# Task TEST-01.01');
      expect(prompt).toContain('## Instructions');
      expect(prompt).toContain('Work in: `/fake/repo/.worktrees/ws-1`');
    });
  });
});

describe('V9: Session Lifecycle', () => {
  describe('worktree lifecycle', () => {
    it('alloc, check (in-worktree), release cycle', () => {
      const allocResult = allocateWorktree(db, 'task-a', 'ws-a', 'tok-a', 3);
      expect(allocResult.ok).toBe(true);
      if (!allocResult.ok) return;

      const worktreePath = allocResult.data.path;

      const checkInside = checkWorktreePath(worktreePath, join(worktreePath, 'src/index.ts'));
      expect(checkInside.ok).toBe(true);

      const checkExact = checkWorktreePath(worktreePath, worktreePath);
      expect(checkExact.ok).toBe(true);

      const releaseResult = releaseWorktree(db, 'task-a');
      expect(releaseResult.ok).toBe(true);
      if (!releaseResult.ok) return;
      expect(releaseResult.data.released).toBe(true);
      expect(releaseResult.data.path).toBe(worktreePath);

      const budget = getBudget(db, 3);
      expect(budget.used).toBe(0);
      expect(budget.available).toBe(3);
    });

    it('check rejects path outside worktree', () => {
      const result = checkWorktreePath(
        '/fake/repo/.worktrees/ws-a',
        '/some/other/path/file.ts',
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('outside expected worktree');
    });

    it('multiple allocations respect budget', () => {
      const a1 = allocateWorktree(db, 'task-1', 'ws-1', 'tok-1', 2);
      expect(a1.ok).toBe(true);

      const a2 = allocateWorktree(db, 'task-2', 'ws-2', 'tok-2', 2);
      expect(a2.ok).toBe(true);

      const a3 = allocateWorktree(db, 'task-3', 'ws-3', 'tok-3', 2);
      expect(a3.ok).toBe(false);
      if (a3.ok) return;
      expect(a3.error.code).toBe('WIP_LIMIT');

      const budget = getBudget(db, 2);
      expect(budget.max).toBe(2);
      expect(budget.used).toBe(2);
      expect(budget.available).toBe(0);
    });
  });

  describe('budget tracking across operations', () => {
    it('tracks allocations across multiple alloc/release cycles', () => {
      allocateWorktree(db, 'task-1', 'ws-1', 'tok-1', 2);
      allocateWorktree(db, 'task-2', 'ws-2', 'tok-2', 2);

      expect(getBudget(db, 2).available).toBe(0);

      releaseWorktree(db, 'task-1');
      expect(getBudget(db, 2).available).toBe(1);

      const a3 = allocateWorktree(db, 'task-3', 'ws-3', 'tok-3', 2);
      expect(a3.ok).toBe(true);
      expect(getBudget(db, 2).available).toBe(0);

      releaseWorktree(db, 'task-2');
      releaseWorktree(db, 'task-3');
      expect(getBudget(db, 2).used).toBe(0);
      expect(getBudget(db, 2).available).toBe(2);
    });

    it('persists in db_meta across db reopen', () => {
      allocateWorktree(db, 'task-1', 'ws-1', 'tok-1', 3);
      allocateWorktree(db, 'task-2', 'ws-2', 'tok-2', 3);

      const budgetBefore = getBudget(db, 3);
      expect(budgetBefore.used).toBe(2);

      db.close();

      const db2 = new BrainDB(dbPath);
      db2.setEmbeddingModel(embedder.model, embedder.dimensions);

      const budgetAfter = getBudget(db2, 3);
      expect(budgetAfter.used).toBe(2);
      expect(budgetAfter.allocations).toHaveLength(2);
      expect(budgetAfter.allocations[0].taskId).toBe('task-1');
      expect(budgetAfter.allocations[1].taskId).toBe('task-2');

      db2.close();

      // Reopen original for afterEach cleanup
      db = new BrainDB(dbPath);
    });
  });
});
