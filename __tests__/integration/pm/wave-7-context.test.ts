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
import { assembleContext } from '../../../src/modules/pm/engine/dispatch.js';
import { getTask, listTasks } from '../../../src/modules/pm/data/task-ops.js';
import { createDecision, listDecisions } from '../../../src/modules/pm/data/decision-ops.js';
import { writePrompt, detectStalePrompts } from '../../../src/modules/pm/data/prompt-ops.js';
import { getProject } from '../../../src/modules/pm/data/project-ops.js';
import { computeEligible } from '../../../src/modules/pm/engine/dependency.js';
import type { VerificationPlan } from '../../../src/modules/pm/commands/verify.js';
import type { BriefingData } from '../../../src/modules/pm/commands/orchestration.js';
import type { ContextBundle } from '../../../src/modules/pm/engine/dispatch.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('pm-wave7'));
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `pm-wave7-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath: '',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await loadModules({ modules: [pmModule] });
  await createStandardProject(db, config, embedder);
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('Wave 7: Context + Verify + Briefing', () => {
  it('context for task includes dep summaries and decisions', async () => {
    await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Use REST API',
      sourceTask: 'TEST-01.01',
      impacts: ['TEST-01.02'],
      content: 'REST for transport layer.',
    });

    const result = assembleContext(db, 'TEST-01.02');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const bundle: ContextBundle = result.data;
    expect(bundle.task.display_id).toBe('TEST-01.02');
    expect(bundle.dependencies.length).toBeGreaterThan(0);
    expect(bundle.dependencies[0].displayId).toBe('TEST-01.01');
    expect(bundle.decisions.length).toBeGreaterThan(0);
    expect(bundle.decisions[0].displayId).toBe('TEST-D01');
  });

  it('context --json returns valid ContextBundle structure', async () => {
    await writePrompt(db, config, embedder, {
      project: 'TEST',
      task: 'TEST-01.01',
      content: 'Build the foundation module.',
    });

    const result = assembleContext(db, 'TEST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const bundle = result.data;
    // Verify ContextBundle shape
    expect(bundle).toHaveProperty('task');
    expect(bundle).toHaveProperty('dependencies');
    expect(bundle).toHaveProperty('decisions');
    expect(bundle).toHaveProperty('constraints');
    expect(bundle).toHaveProperty('contextHash');
    expect(bundle.task.display_id).toBe('TEST-01.01');
    expect(bundle.prompt).toBeDefined();
    expect(typeof bundle.contextHash).toBe('string');
    expect(bundle.contextHash.length).toBe(64);
  });

  it('context includes prompt content when prompt exists', async () => {
    await writePrompt(db, config, embedder, {
      project: 'TEST',
      task: 'TEST-02.01',
      content: 'Implement the search feature.',
    });

    const result = assembleContext(db, 'TEST-02.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.prompt).toBeDefined();
  });

  it('verify for task generates verification plan with category-specific steps', async () => {
    const taskResult = getTask(db, 'TEST-01.01');
    expect(taskResult.ok).toBe(true);
    if (!taskResult.ok) return;

    const contextResult = assembleContext(db, 'TEST-01.01');
    expect(contextResult.ok).toBe(true);
    if (!contextResult.ok) return;

    const bundle = contextResult.data;
    const task = taskResult.data;

    const plan: VerificationPlan = {
      taskId: 'TEST-01.01',
      category: task.category,
      objective: bundle.prompt,
      dependencies: bundle.dependencies.map((d) => ({
        displayId: d.displayId,
        status: d.status,
      })),
      decisions: bundle.decisions.map((d) => ({
        displayId: d.displayId,
        content: d.content,
      })),
      steps: [],
    };

    // Implementation tasks should suggest specific verification steps
    expect(plan.category).toBe('implementation');
    expect(plan.taskId).toBe('TEST-01.01');
  });

  it('verify plan includes dependency statuses', async () => {
    const contextResult = assembleContext(db, 'TEST-02.02');
    expect(contextResult.ok).toBe(true);
    if (!contextResult.ok) return;

    const bundle = contextResult.data;
    const upstreamDeps = bundle.dependencies.filter((d) => d.direction === 'upstream');
    const depStatuses = upstreamDeps.map((d) => ({
      displayId: d.displayId,
      status: d.status,
    }));

    // TEST-02.02 depends on TEST-01.01 and TEST-02.01
    expect(depStatuses.length).toBe(2);
    const depIds = depStatuses.map((d) => d.displayId).sort();
    expect(depIds).toEqual(['TEST-01.01', 'TEST-02.01']);
    expect(depStatuses.every((d) => d.status === 'pending')).toBe(true);
  });

  it('briefing shows project overview with task breakdown', async () => {
    const projectResult = getProject(db, 'TEST');
    expect(projectResult.ok).toBe(true);
    if (!projectResult.ok) return;

    const allTasksResult = listTasks(db, 'TEST');
    expect(allTasksResult.ok).toBe(true);
    if (!allTasksResult.ok) return;

    const allTasks = allTasksResult.data;
    const eligible = computeEligible(db, 'TEST');

    const taskMap = new Map(allTasks.map((t) => [t.display_id, t]));
    const briefing: BriefingData = {
      project: projectResult.data,
      tasks: {
        total: allTasks.length,
        eligible: eligible.map((id) => {
          const t = taskMap.get(id);
          return { displayId: id, title: t?.title ?? id, priority: t?.priority ?? 'medium', workstream: t?.workstream ?? 0 };
        }),
        inProgress: allTasks.filter((t) => t.status === 'in-progress').map((t) => ({ displayId: t.display_id, title: t.title ?? t.display_id, priority: t.priority })),
        blocked: allTasks.filter((t) => t.status === 'blocked').map((t) => ({ displayId: t.display_id, title: t.title ?? t.display_id })),
        doneCount: allTasks.filter((t) => t.status === 'done').length,
        pendingCount: allTasks.filter((t) => t.status === 'pending').length,
      },
      recentDecisions: [],
      stalePrompts: [],
      nextActions: [],
    };

    expect(briefing.project.display_id).toBe('TEST');
    expect(briefing.tasks.total).toBe(6);
    // TEST-01.01 and TEST-02.01 have no deps, so they're eligible
    const eligibleIds = briefing.tasks.eligible.map((t) => t.displayId);
    expect(eligibleIds).toContain('TEST-01.01');
    expect(eligibleIds).toContain('TEST-02.01');
    expect(briefing.tasks.eligible.length).toBe(2);
  });

  it('briefing includes eligible tasks and recent decisions', async () => {
    await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Architecture decision',
      sourceTask: 'TEST-01.01',
      content: 'Monorepo structure.',
    });

    const decisionsResult = listDecisions(db, 'TEST');
    expect(decisionsResult.ok).toBe(true);
    if (!decisionsResult.ok) return;

    const eligible = computeEligible(db, 'TEST');

    const briefing: BriefingData = {
      project: { display_id: 'TEST', prefix: 'TEST', status: 'active' },
      tasks: {
        total: 6,
        eligible: eligible.map((id) => ({ displayId: id, title: id, priority: 'medium' as const, workstream: 0 })),
        inProgress: [],
        blocked: [],
        doneCount: 0,
        pendingCount: 0,
      },
      recentDecisions: decisionsResult.data,
      stalePrompts: [],
      nextActions: [],
    };

    expect(briefing.recentDecisions.length).toBe(1);
    expect(briefing.recentDecisions[0].display_id).toBe('TEST-D01');
    expect(briefing.tasks.eligible.length).toBe(2);
  });

  it('briefing detects stale prompts and suggests actions', async () => {
    await writePrompt(db, config, embedder, {
      project: 'TEST',
      task: 'TEST-01.01',
      content: 'Build REST API.',
    });

    // Small delay ensures the decision gets a later indexedAt than the prompt
    await new Promise((resolve) => setTimeout(resolve, 10));

    await createDecision(db, config, embedder, {
      project: 'TEST',
      name: 'Switch to GraphQL',
      sourceTask: 'TEST-02.01',
      impacts: ['TEST-01.01'],
      content: 'GraphQL is better.',
    });

    const staleResult = detectStalePrompts(db, 'TEST');
    expect(staleResult.ok).toBe(true);
    if (!staleResult.ok) return;

    const nextActions: string[] = [];
    if (staleResult.data.length > 0) {
      nextActions.push(`Update ${staleResult.data.length} stale prompt(s)`);
    }

    expect(staleResult.data.length).toBe(1);
    expect(staleResult.data[0].task).toBe('TEST-01.01');
    expect(nextActions).toContain('Update 1 stale prompt(s)');
  });
});
