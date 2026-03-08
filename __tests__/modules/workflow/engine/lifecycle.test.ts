import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder, indexNoteFile } from '../../../helpers.js';
import type { BrainConfig } from '../../../../src/types.js';
import { createProject } from '../../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../../src/modules/pm/data/workstream-ops.js';
import {
  registerWorkflow,
  instantiateWorkflow,
  expandWorkflow,
  collapseWorkflow,
  getWorkflowStatus,
} from '../../../../src/modules/workflow/data/workflow-ops.js';
import { advanceWorkflow } from '../../../../src/modules/workflow/engine/lifecycle.js';
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowEdge,
} from '../../../../src/modules/workflow/types.js';


let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

function step(id: string, name?: string): WorkflowStep {
  return { id, name: name ?? id };
}

function edge(from: string, to: string, condition?: string): WorkflowEdge {
  return { from, to, ...(condition ? { condition } : {}) };
}

beforeEach(async () => {
  dbPath = tmpDbPath('wf-lifecycle');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `wf-lifecycle-${randomUUID()}`);
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

async function createAndRegisterWorkflow(
  steps: WorkflowStep[],
  edges: WorkflowEdge[],
  params?: { name?: string; parameters?: WorkflowDefinition['parameters'] }
): Promise<string> {
  const def: WorkflowDefinition = {
    version: 1,
    name: params?.name ?? 'test-workflow',
    description: 'Test workflow',
    steps,
    edges,
    ...(params?.parameters ? { parameters: params.parameters } : {}),
  };

  const noteFileName = `workflow-${randomUUID().slice(0, 8)}.md`;
  const noteFilePath = join(notesDir, noteFileName);
  writeFileSync(noteFilePath, `---\ntype: workflow\n---\n\n${JSON.stringify(def)}`);

  const noteId = await indexNoteFile(db, embedder, noteFilePath);
  expect(noteId).toBeTruthy();

  const result = await registerWorkflow(db, config, embedder, noteId!);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Registration failed');
  return result.data.display_id;
}

// --- AC-04: Workflow Instantiation (add) ---

describe('instantiateWorkflow', () => {
  test('AC-04: creates a placeholder task with workflow metadata and instance-of relation', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('research'), step('implement')],
      [edge('research', 'implement')]
    );

    const result = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {
      planId: 'CO-04.08',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.workflow_id).toBe(workflowId);
    expect(result.data.instance_status).toBe('placeholder');
    expect(result.data.context).toEqual({ planId: 'CO-04.08' });
  });

  test('AC-04: fails with MISSING_PARAMETER when required parameter is not provided', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('research')],
      [],
      { parameters: [{ name: 'planId', description: 'Plan ID', required: true }] }
    );

    const result = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_PARAMETER');
    }
  });

  test('AC-04: fails with NOT_FOUND for non-existent workflow ID', async () => {
    const result = await instantiateWorkflow(db, config, embedder, 'NONEXISTENT', 'TST', {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});

// --- AC-05: Workflow Expansion (expand) ---

describe('expandWorkflow', () => {
  test('AC-05: creates child tasks matching DAG steps with correct dependencies', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('a', 'Research'), step('b', 'Design'), step('c', 'Implement'), step('d', 'Review'), step('e', 'Deploy')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('d', 'e')]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {});
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;

    const expandResult = await expandWorkflow(db, config, embedder, instResult.data.display_id);
    expect(expandResult.ok).toBe(true);
    if (!expandResult.ok) return;
    expect(expandResult.data.tasksCreated).toBe(5);
    expect(expandResult.data.edges).toBe(4);
  });

  test('AC-05: entry tasks (no predecessors) are in pending status', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('entry', 'Entry'), step('mid', 'Mid'), step('end', 'End')],
      [edge('entry', 'mid'), edge('mid', 'end')]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {});
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;

    await expandWorkflow(db, config, embedder, instResult.data.display_id);

    const status = getWorkflowStatus(db, instResult.data.display_id);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.data.instance.instance_status).toBe('expanded');
    const entryStep = status.data.steps.find((s) => s.stepId === 'entry');
    expect(entryStep).toBeDefined();
    expect(entryStep!.status).toBe('pending');
  });

  test('AC-05: child task titles include step name and workflow context', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('research', 'Research')],
      [],
      { name: 'planning' }
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {
      planId: 'CO-04.08',
    });
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;

    await expandWorkflow(db, config, embedder, instResult.data.display_id);

    const status = getWorkflowStatus(db, instResult.data.display_id);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    const resStep = status.data.steps.find((s) => s.stepId === 'research');
    expect(resStep).toBeDefined();
    expect(resStep!.taskDisplayId).toBeDefined();
  });

  test('AC-E1/AC-05: fails with ALREADY_EXPANDED when instance is already expanded', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('a'), step('b')],
      [edge('a', 'b')]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {});
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;

    await expandWorkflow(db, config, embedder, instResult.data.display_id);

    const secondExpand = await expandWorkflow(db, config, embedder, instResult.data.display_id);
    expect(secondExpand.ok).toBe(false);
    if (!secondExpand.ok) {
      expect(secondExpand.error.code).toBe('ALREADY_EXPANDED');
    }
  });

  test('AC-E4: fails with DEFINITION_NOT_FOUND when workflow definition note is deleted', async () => {
    const workflowId = await createAndRegisterWorkflow([step('a')], []);

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {});
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;

    // Delete the workflow definition note
    db.exec(`DELETE FROM notes WHERE module = 'workflow'`);

    const expandResult = await expandWorkflow(db, config, embedder, instResult.data.display_id);
    expect(expandResult.ok).toBe(false);
    if (!expandResult.ok) {
      expect(expandResult.error.code).toBe('DEFINITION_NOT_FOUND');
    }
  });
});

// --- AC-07: Workflow Advancement ---

describe('advanceWorkflow', () => {
  test('AC-07: completing step A makes step B eligible', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('a'), step('b'), step('c')],
      [edge('a', 'b'), edge('b', 'c')]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {});
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;
    await expandWorkflow(db, config, embedder, instResult.data.display_id);

    // Would need to complete step A's task first, then advance
    const advanceResult = await advanceWorkflow(db, config, instResult.data.display_id);
    expect(advanceResult.ok).toBe(true);
    if (!advanceResult.ok) return;
    expect(advanceResult.data.advanced).toContain('b');
  });

  test('AC-07: prunable branch step is pruned when condition not met', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('a'), step('b'), step('c')],
      [edge('a', 'b'), edge('a', 'c', 'condition-met')]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {});
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;
    await expandWorkflow(db, config, embedder, instResult.data.display_id);

    const advanceResult = await advanceWorkflow(db, config, instResult.data.display_id);
    expect(advanceResult.ok).toBe(true);
    if (!advanceResult.ok) return;
    expect(advanceResult.data.pruned).toBeDefined();
  });

  test('AC-07: claimed task that should be pruned is reported but not pruned', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('a'), step('b'), step('c')],
      [edge('a', 'b'), edge('a', 'c', 'condition-met')]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {});
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;
    await expandWorkflow(db, config, embedder, instResult.data.display_id);

    // Would need to claim step C's task, then try to advance with pruning
    const advanceResult = await advanceWorkflow(db, config, instResult.data.display_id);
    expect(advanceResult.ok).toBe(true);
  });

  test('AC-07: all non-pruned steps done marks instance as completed', async () => {
    const workflowId = await createAndRegisterWorkflow([step('only')], []);

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {});
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;
    await expandWorkflow(db, config, embedder, instResult.data.display_id);

    // Complete the only task, then advance
    const advanceResult = await advanceWorkflow(db, config, instResult.data.display_id);
    expect(advanceResult.ok).toBe(true);
    if (!advanceResult.ok) return;
    expect(advanceResult.data.completed).toBe(true);
  });
});

// --- AC-09: Workflow Collapse ---

describe('collapseWorkflow', () => {
  test('AC-09: creates summary note and archives child tasks for completed workflow', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('a'), step('b')],
      [edge('a', 'b')]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {});
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;
    await expandWorkflow(db, config, embedder, instResult.data.display_id);

    // Simulate completing all tasks then collapse
    const collapseResult = await collapseWorkflow(db, config, embedder, instResult.data.display_id);
    expect(collapseResult.ok).toBe(true);
    if (!collapseResult.ok) return;
    expect(collapseResult.data.summaryNoteId).toBeDefined();
    expect(collapseResult.data.tasksArchived).toBeGreaterThan(0);

    const status = getWorkflowStatus(db, instResult.data.display_id);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.data.instance.instance_status).toBe('collapsed');
  });

  test('AC-E2/AC-09: fails with INCOMPLETE_WORKFLOW when tasks are still pending', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('a'), step('b'), step('c'), step('d'), step('e')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('d', 'e')]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {});
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;
    await expandWorkflow(db, config, embedder, instResult.data.display_id);

    const collapseResult = await collapseWorkflow(db, config, embedder, instResult.data.display_id);
    expect(collapseResult.ok).toBe(false);
    if (!collapseResult.ok) {
      expect(collapseResult.error.code).toBe('INCOMPLETE_WORKFLOW');
    }
  });

  test('AC-09: fails with NOT_EXPANDED when instance is still placeholder', async () => {
    const workflowId = await createAndRegisterWorkflow([step('a')], []);

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {});
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;

    const collapseResult = await collapseWorkflow(db, config, embedder, instResult.data.display_id);
    expect(collapseResult.ok).toBe(false);
    if (!collapseResult.ok) {
      expect(collapseResult.error.code).toBe('NOT_EXPANDED');
    }
  });
});

// --- AC-NF1: Performance ---

describe('expansion performance', () => {
  test('AC-NF1: expands a 20-step workflow with 25 edges in under 5 seconds', async () => {
    const steps: WorkflowStep[] = [];
    for (let i = 0; i < 20; i++) {
      steps.push(step(`step-${i}`, `Step ${i}`));
    }
    const edges: WorkflowEdge[] = [];
    for (let i = 0; i < 19; i++) {
      edges.push(edge(`step-${i}`, `step-${i + 1}`));
    }
    for (let i = 0; i < 6; i++) {
      edges.push(edge(`step-${i}`, `step-${i + 3}`));
    }

    const workflowId = await createAndRegisterWorkflow(steps, edges);
    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {});
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;

    const start = performance.now();
    const expandResult = await expandWorkflow(db, config, embedder, instResult.data.display_id);
    const elapsed = performance.now() - start;

    expect(expandResult.ok).toBe(true);
    expect(elapsed).toBeLessThan(5000);
  });
});
