import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../src/services/brain-db.js';
import { createMockEmbedder, indexNoteFile, setTestTaskStatus, createTestDb } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';
import { createProject } from '../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../src/modules/pm/data/workstream-ops.js';
import {
  registerWorkflow,
  instantiateWorkflow,
  expandWorkflow,
  getWorkflowStatus,
} from '../../src/modules/workflow/data/workflow-ops.js';
import { advanceWorkflow } from '../../src/modules/workflow/engine/lifecycle.js';
import {
  signalCondition,
  getConditionSignals,
} from '../../src/modules/workflow/engine/condition.js';
import { dispatchTemplate } from '../../src/modules/workflow/engine/dispatch.js';
import type { WorkflowDefinition } from '../../src/modules/workflow/types.js';

const DEFS_DIR = join(import.meta.dirname, '..', '..', 'src', 'modules', 'workflow', 'definitions');

const embedder = createMockEmbedder();

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;

beforeEach(async () => {
  ({ dbPath, db } = createTestDb());
  notesDir = join(tmpdir(), `wf-e2e-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath, embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
  await createProject(db, config, embedder, { name: 'Test', prefix: 'TST' });
  await createWorkstream(db, config, embedder, { project: 'TST', name: 'Main' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

/**
 * Register the real planning workflow definition from disk.
 * Returns the workflow display_id.
 */
async function registerPlanningWorkflow(): Promise<string> {
  const raw = readFileSync(join(DEFS_DIR, 'planning-workflow.json'), 'utf-8');
  const def = JSON.parse(raw) as WorkflowDefinition;

  const noteFilePath = join(notesDir, `planning-workflow-${randomUUID().slice(0, 8)}.md`);
  writeFileSync(
    noteFilePath,
    `---\ntype: workflow\nmodule: workflow\n---\n\n${JSON.stringify(def)}`
  );

  const noteId = await indexNoteFile(db, embedder, noteFilePath);
  expect(noteId).toBeTruthy();

  const result = await registerWorkflow(db, config, embedder, noteId!);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Workflow registration failed');
  return result.data.display_id;
}

async function instantiateAndExpand(
  workflowId: string,
  context: Record<string, string>
): Promise<{ instanceId: string; tasksCreated: number; edges: number }> {
  const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {
    workstream: '1',
    ...context,
  });
  expect(instResult.ok).toBe(true);
  if (!instResult.ok) throw new Error('Instantiation failed');

  const expandResult = await expandWorkflow(db, config, embedder, instResult.data.display_id);
  expect(expandResult.ok).toBe(true);
  if (!expandResult.ok) throw new Error('Expansion failed');

  return {
    instanceId: instResult.data.display_id,
    tasksCreated: expandResult.data.tasksCreated,
    edges: expandResult.data.edges,
  };
}

function getStepTaskDisplayId(
  statusData: { steps: Array<{ stepId: string; taskDisplayId: string }> },
  stepId: string
): string {
  const found = statusData.steps.find((s) => s.stepId === stepId);
  if (!found) throw new Error(`Step "${stepId}" not found in status`);
  return found.taskDisplayId;
}

describe('Workflow activation e2e', () => {
  describe('complexity routing', () => {
    it('planning workflow expands to 8 steps at high complexity', async () => {
      const workflowId = await registerPlanningWorkflow();
      const { tasksCreated, edges, instanceId } = await instantiateAndExpand(workflowId, {
        complexity: 'high',
      });

      expect(tasksCreated).toBe(8);
      expect(edges).toBe(7);

      const status = getWorkflowStatus(db, instanceId);
      expect(status.ok).toBe(true);
      if (!status.ok) return;

      const stepIds = status.data.steps.map((s) => s.stepId).sort();
      expect(stepIds).toEqual([
        'critic',
        'decompose',
        'design',
        'implement',
        'interview',
        'research',
        'review',
        'spec-tests',
      ]);
    });

    it('planning workflow expands to 7 steps at medium complexity (no interview)', async () => {
      const workflowId = await registerPlanningWorkflow();
      const { tasksCreated, edges, instanceId } = await instantiateAndExpand(workflowId, {
        complexity: 'medium',
      });

      expect(tasksCreated).toBe(7);
      expect(edges).toBe(6);

      const status = getWorkflowStatus(db, instanceId);
      expect(status.ok).toBe(true);
      if (!status.ok) return;

      const stepIds = status.data.steps.map((s) => s.stepId).sort();
      expect(stepIds).not.toContain('interview');
      expect(stepIds).toContain('research');
      expect(stepIds).toContain('design');
    });

    it('planning workflow expands to 2 steps at low complexity (implement + review)', async () => {
      const workflowId = await registerPlanningWorkflow();
      const { tasksCreated, edges, instanceId } = await instantiateAndExpand(workflowId, {
        complexity: 'low',
      });

      expect(tasksCreated).toBe(2);
      expect(edges).toBe(1);

      const status = getWorkflowStatus(db, instanceId);
      expect(status.ok).toBe(true);
      if (!status.ok) return;

      const stepIds = status.data.steps.map((s) => s.stepId).sort();
      expect(stepIds).toEqual(['implement', 'review']);
    });
  });

  describe('condition routing', () => {
    it('signaling needs_revision suppresses spec-tests and activates the critic->design loop', async () => {
      const workflowId = await registerPlanningWorkflow();
      // Use high complexity so critic, design, and spec-tests are all present
      const { instanceId } = await instantiateAndExpand(workflowId, { complexity: 'high' });

      // Signal needs_revision on critic BEFORE completing it
      const signalResult = signalCondition(db, instanceId, 'critic', 'needs_revision');
      expect(signalResult.ok).toBe(true);

      // Mark all steps preceding critic as done so critic is unblocked
      const status = getWorkflowStatus(db, instanceId);
      expect(status.ok).toBe(true);
      if (!status.ok) return;

      for (const stepId of ['research', 'interview', 'design']) {
        setTestTaskStatus(db, getStepTaskDisplayId(status.data, stepId), 'done');
      }
      setTestTaskStatus(db, getStepTaskDisplayId(status.data, 'critic'), 'done');

      const advResult = await advanceWorkflow(db, config, instanceId);
      expect(advResult.ok).toBe(true);
      if (!advResult.ok) return;

      // spec-tests must NOT advance: critic has a signal, triggering exclusive routing
      expect(advResult.data.advanced).not.toContain('spec-tests');

      // The critic->design conditional edge signals a loop, but the V1 engine can't
      // re-advance an already-done step. The key assertion is that spec-tests is blocked
      // (exclusive routing). The V2 runtime handles the actual design re-queue.
      // Verify the signal was stored correctly.
      const signals = getConditionSignals(db, instanceId, 'critic');
      expect(signals).toContain('needs_revision');
    });

    it('without a condition signal, critic advances spec-tests (default path)', async () => {
      const workflowId = await registerPlanningWorkflow();
      const { instanceId } = await instantiateAndExpand(workflowId, { complexity: 'high' });

      // NO signal — critic takes the default unconditional path to spec-tests
      const status = getWorkflowStatus(db, instanceId);
      expect(status.ok).toBe(true);
      if (!status.ok) return;

      for (const stepId of ['research', 'interview', 'design']) {
        setTestTaskStatus(db, getStepTaskDisplayId(status.data, stepId), 'done');
      }
      setTestTaskStatus(db, getStepTaskDisplayId(status.data, 'critic'), 'done');

      const advResult = await advanceWorkflow(db, config, instanceId);
      expect(advResult.ok).toBe(true);
      if (!advResult.ok) return;

      expect(advResult.data.advanced).toContain('spec-tests');
    });
  });

  describe('template variables', () => {
    it('camelCase context keys become UPPER_SNAKE_CASE template variables', async () => {
      const workflowId = await registerPlanningWorkflow();
      const { instanceId } = await instantiateAndExpand(workflowId, {
        complexity: 'low',
        planId: 'TST-04.08',
        researchFocus: 'performance',
      });

      const status = getWorkflowStatus(db, instanceId);
      expect(status.ok).toBe(true);
      if (!status.ok) return;

      // Dispatch the implement step task (created by low-complexity expansion)
      const implementTaskId = getStepTaskDisplayId(status.data, 'implement');
      const stepDef = status.data.steps.find((s) => s.stepId === 'implement');
      expect(stepDef).toBeDefined();

      const result = await dispatchTemplate(
        db,
        config,
        embedder,
        implementTaskId,
        'implementation-compact'
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Original camelCase keys should be present
      expect(result.data.variables['planId']).toBe('TST-04.08');
      expect(result.data.variables['researchFocus']).toBe('performance');

      // UPPER_SNAKE_CASE equivalents must also be injected
      expect(result.data.variables['PLAN_ID']).toBe('TST-04.08');
      expect(result.data.variables['RESEARCH_FOCUS']).toBe('performance');
    });
  });
});
