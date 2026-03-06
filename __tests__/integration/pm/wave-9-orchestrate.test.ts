import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  const dbPath = tmpDbPath('pm-wave9');
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
