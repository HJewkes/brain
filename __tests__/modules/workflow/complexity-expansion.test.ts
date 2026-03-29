import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, indexNoteFile, createTestDb } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import {
  registerWorkflow,
  instantiateWorkflow,
  expandWorkflow,
  getWorkflowStatus,
} from '../../../src/modules/workflow/data/workflow-ops.js';
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowEdge,
} from '../../../src/modules/workflow/types.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

function step(id: string, name?: string, mode?: string): WorkflowStep {
  return { id, name: name ?? id, ...(mode ? { metadata: { mode } } : {}) };
}

function edge(from: string, to: string, condition?: string): WorkflowEdge {
  return { from, to, ...(condition ? { condition } : {}) };
}

beforeEach(async () => {
  ({ dbPath, db } = createTestDb());
  notesDir = join(tmpdir(), `wf-complexity-${randomUUID()}`);
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

/** Full planning workflow definition matching the design's 8-step pipeline */
function planningSteps(): WorkflowStep[] {
  return [
    step('research', 'Research'),
    step('interview', 'Interview'),
    step('design', 'Design'),
    step('critic', 'Critic'),
    step('spec-tests', 'Spec Tests'),
    step('decompose', 'Decompose'),
    step('implement', 'Implement'),
    step('review', 'Review'),
  ];
}

function planningEdges(): WorkflowEdge[] {
  return [
    edge('research', 'interview'),
    edge('interview', 'design'),
    edge('design', 'critic'),
    edge('critic', 'spec-tests'),
    edge('spec-tests', 'decompose'),
    edge('decompose', 'implement'),
    edge('implement', 'review'),
  ];
}

async function createAndRegisterWorkflow(
  steps: WorkflowStep[],
  edges: WorkflowEdge[],
  params?: { name?: string; parameters?: WorkflowDefinition['parameters'] }
): Promise<string> {
  const def: WorkflowDefinition = {
    version: 1,
    name: params?.name ?? 'planning',
    description: 'Planning workflow',
    steps,
    edges,
    ...(params?.parameters ? { parameters: params.parameters } : {}),
  };

  const noteFileName = `workflow-${randomUUID().slice(0, 8)}.md`;
  const noteFilePath = join(notesDir, noteFileName);
  writeFileSync(
    noteFilePath,
    `---\ntype: workflow\nmodule: workflow\n---\n\n${JSON.stringify(def)}`
  );

  const noteId = await indexNoteFile(db, embedder, noteFilePath);
  expect(noteId).toBeTruthy();

  const result = await registerWorkflow(db, config, embedder, noteId!);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Registration failed');
  return result.data.display_id;
}

async function instantiateAndExpand(
  workflowId: string,
  context: Record<string, string>
): Promise<{ instanceId: string; expandResult: { tasksCreated: number; edges: number } }> {
  const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {
    workstream: '1',
    ...context,
  });
  expect(instResult.ok).toBe(true);
  if (!instResult.ok) throw new Error('Instantiation failed');

  const expandResult = await expandWorkflow(db, config, embedder, instResult.data.display_id);
  expect(expandResult.ok).toBe(true);
  if (!expandResult.ok) throw new Error('Expansion failed');

  return { instanceId: instResult.data.display_id, expandResult: expandResult.data };
}

// --- AC-16: High complexity creates all steps ---

describe('complexity-based expansion', () => {
  test('AC-16: high complexity creates all 8 steps with 7 edges', async () => {
    const workflowId = await createAndRegisterWorkflow(planningSteps(), planningEdges());

    const { expandResult, instanceId } = await instantiateAndExpand(workflowId, {
      complexity: 'high',
    });

    expect(expandResult.tasksCreated).toBe(8);
    expect(expandResult.edges).toBe(7);

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

  // --- AC-17: Medium complexity skips interview ---

  test('AC-17: medium complexity creates 7 steps (no interview) with bridge edge research->design', async () => {
    const workflowId = await createAndRegisterWorkflow(planningSteps(), planningEdges());

    const { expandResult, instanceId } = await instantiateAndExpand(workflowId, {
      complexity: 'medium',
    });

    expect(expandResult.tasksCreated).toBe(7);
    expect(expandResult.edges).toBe(6);

    const status = getWorkflowStatus(db, instanceId);
    expect(status.ok).toBe(true);
    if (!status.ok) return;

    const stepIds = status.data.steps.map((s) => s.stepId).sort();
    expect(stepIds).toEqual([
      'critic',
      'decompose',
      'design',
      'implement',
      'research',
      'review',
      'spec-tests',
    ]);
    // interview must NOT be present
    expect(stepIds).not.toContain('interview');
  });

  // --- AC-18: Low complexity creates only implement and review ---

  test('AC-18: low complexity creates only implement and review with 1 edge', async () => {
    const workflowId = await createAndRegisterWorkflow(planningSteps(), planningEdges());

    const { expandResult, instanceId } = await instantiateAndExpand(workflowId, {
      complexity: 'low',
    });

    expect(expandResult.tasksCreated).toBe(2);
    expect(expandResult.edges).toBe(1);

    const status = getWorkflowStatus(db, instanceId);
    expect(status.ok).toBe(true);
    if (!status.ok) return;

    const stepIds = status.data.steps.map((s) => s.stepId).sort();
    expect(stepIds).toEqual(['implement', 'review']);
  });

  // --- AC-05 (default): No complexity key defaults to high ---

  test('AC-20: missing complexity key defaults to high (all steps created)', async () => {
    const workflowId = await createAndRegisterWorkflow(planningSteps(), planningEdges());

    // No complexity in context
    const { expandResult } = await instantiateAndExpand(workflowId, {});

    expect(expandResult.tasksCreated).toBe(8);
    expect(expandResult.edges).toBe(7);
  });

  // --- EC-05: Invalid complexity falls back to high ---

  test('EC-05: invalid complexity value falls back to high (all steps created)', async () => {
    const workflowId = await createAndRegisterWorkflow(planningSteps(), planningEdges());

    const { expandResult } = await instantiateAndExpand(workflowId, {
      complexity: 'extreme',
    });

    expect(expandResult.tasksCreated).toBe(8);
    expect(expandResult.edges).toBe(7);
  });

  // --- AC-19: Filtered DAG is valid for all complexity levels ---

  test('AC-19: filtered DAG is valid for medium complexity', async () => {
    const workflowId = await createAndRegisterWorkflow(planningSteps(), planningEdges());

    // If DAG were invalid, expandWorkflow would fail or fall back
    const { expandResult } = await instantiateAndExpand(workflowId, {
      complexity: 'medium',
    });

    // Expansion succeeds (valid DAG)
    expect(expandResult.tasksCreated).toBeGreaterThan(0);
  });

  test('AC-19: filtered DAG is valid for low complexity', async () => {
    const workflowId = await createAndRegisterWorkflow(planningSteps(), planningEdges());

    const { expandResult } = await instantiateAndExpand(workflowId, {
      complexity: 'low',
    });

    expect(expandResult.tasksCreated).toBeGreaterThan(0);
  });
});
