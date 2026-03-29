import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import {
  createMockEmbedder,
  indexNoteFile,
  setTestTaskStatus,
  createTestDb,
} from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import {
  registerWorkflow,
  instantiateWorkflow,
  expandWorkflow,
  getWorkflowStatus,
} from '../../../src/modules/workflow/data/workflow-ops.js';
import { advanceWorkflow } from '../../../src/modules/workflow/engine/lifecycle.js';
import {
  signalCondition,
  getConditionSignals,
} from '../../../src/modules/workflow/engine/condition.js';
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

function step(id: string, name?: string): WorkflowStep {
  return { id, name: name ?? id };
}

function edge(from: string, to: string, condition?: string): WorkflowEdge {
  return { from, to, ...(condition ? { condition } : {}) };
}

beforeEach(async () => {
  ({ dbPath, db } = createTestDb());
  notesDir = join(tmpdir(), `wf-condition-${randomUUID()}`);
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

function getStepTaskDisplayId(
  statusData: { steps: Array<{ stepId: string; taskDisplayId: string }> },
  stepId: string
): string {
  const step = statusData.steps.find((s) => s.stepId === stepId);
  if (!step) throw new Error(`Step "${stepId}" not found`);
  return step.taskDisplayId;
}

// --- AC-13: Unsignaled condition results in pruning ---

describe('condition routing', () => {
  test('AC-13: unsignaled conditional edge target is pruned', async () => {
    // critic -> spec-tests (unconditional), critic -> design (conditional: needs_revision)
    const workflowId = await createAndRegisterWorkflow(
      [step('critic'), step('spec-tests'), step('design')],
      [edge('critic', 'spec-tests'), edge('critic', 'design', 'needs_revision')]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {
      workstream: '1',
    });
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;
    const instanceId = instResult.data.display_id;

    await expandWorkflow(db, config, embedder, instanceId);

    // Complete critic step WITHOUT signaling any condition
    const status = getWorkflowStatus(db, instanceId);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    setTestTaskStatus(db, getStepTaskDisplayId(status.data, 'critic'), 'done');

    const advResult = await advanceWorkflow(db, config, instanceId);
    expect(advResult.ok).toBe(true);
    if (!advResult.ok) return;

    // spec-tests should be advanced (unconditional edge)
    expect(advResult.data.advanced).toContain('spec-tests');
    // design should be pruned (conditional edge with no signal)
    expect(advResult.data.pruned).toContain('design');
  });

  // --- AC-14: Condition signal on completed step is rejected ---

  test('AC-14: signaling condition on a done step fails', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('research'), step('design')],
      [edge('research', 'design')]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {
      workstream: '1',
    });
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;
    const instanceId = instResult.data.display_id;

    await expandWorkflow(db, config, embedder, instanceId);

    // Complete the research step
    const status = getWorkflowStatus(db, instanceId);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    setTestTaskStatus(db, getStepTaskDisplayId(status.data, 'research'), 'done');

    // Attempt to signal condition on the completed step
    const result = signalCondition(db, instanceId, 'research', 'has_open_questions');
    expect(result.ok).toBe(false);
  });

  // --- AC-15: Exclusive routing suppresses unconditional forward edges ---

  test('AC-15: when condition is signaled, unconditional forward edges from that step are suppressed', async () => {
    // critic -> spec-tests (unconditional), critic -> design (conditional: needs_revision)
    const workflowId = await createAndRegisterWorkflow(
      [step('critic'), step('spec-tests'), step('design')],
      [edge('critic', 'spec-tests'), edge('critic', 'design', 'needs_revision')]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {
      workstream: '1',
    });
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;
    const instanceId = instResult.data.display_id;

    await expandWorkflow(db, config, embedder, instanceId);

    // Signal condition BEFORE completing critic
    const signalResult = signalCondition(db, instanceId, 'critic', 'needs_revision');
    expect(signalResult.ok).toBe(true);

    // Complete critic step
    const status = getWorkflowStatus(db, instanceId);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    setTestTaskStatus(db, getStepTaskDisplayId(status.data, 'critic'), 'done');

    const advResult = await advanceWorkflow(db, config, instanceId);
    expect(advResult.ok).toBe(true);
    if (!advResult.ok) return;

    // design should be advanced (conditional edge matches signal)
    expect(advResult.data.advanced).toContain('design');
    // spec-tests should NOT be advanced (unconditional edge suppressed by exclusive routing)
    expect(advResult.data.advanced).not.toContain('spec-tests');
  });

  test('AC-15: spec-tests still advances if it has another ready unconditional predecessor without signals', async () => {
    // Two paths to spec-tests: critic -> spec-tests (unconditional) and decompose -> spec-tests (unconditional)
    // critic -> design (conditional: needs_revision)
    const workflowId = await createAndRegisterWorkflow(
      [step('critic'), step('decompose'), step('spec-tests'), step('design')],
      [
        edge('critic', 'spec-tests'),
        edge('decompose', 'spec-tests'),
        edge('critic', 'design', 'needs_revision'),
      ]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {
      workstream: '1',
    });
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;
    const instanceId = instResult.data.display_id;

    await expandWorkflow(db, config, embedder, instanceId);

    // Signal condition on critic
    signalCondition(db, instanceId, 'critic', 'needs_revision');

    // Complete both critic and decompose
    const status = getWorkflowStatus(db, instanceId);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    setTestTaskStatus(db, getStepTaskDisplayId(status.data, 'critic'), 'done');
    setTestTaskStatus(db, getStepTaskDisplayId(status.data, 'decompose'), 'done');

    const advResult = await advanceWorkflow(db, config, instanceId);
    expect(advResult.ok).toBe(true);
    if (!advResult.ok) return;

    // design should be advanced (conditional edge matches signal)
    expect(advResult.data.advanced).toContain('design');
    // spec-tests should STILL advance because decompose (no signals) is a ready unconditional predecessor
    expect(advResult.data.advanced).toContain('spec-tests');
  });

  // --- EC-06: Multiple condition signals on same step ---

  test('EC-06: multiple conditions signaled activates all conditional targets', async () => {
    // critic -> spec-tests (unconditional)
    // critic -> design (conditional: needs_revision)
    // critic -> research (conditional: has_open_questions)
    const workflowId = await createAndRegisterWorkflow(
      [step('critic'), step('spec-tests'), step('design'), step('research')],
      [
        edge('critic', 'spec-tests'),
        edge('critic', 'design', 'needs_revision'),
        edge('critic', 'research', 'has_open_questions'),
      ]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {
      workstream: '1',
    });
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;
    const instanceId = instResult.data.display_id;

    await expandWorkflow(db, config, embedder, instanceId);

    // Signal both conditions
    signalCondition(db, instanceId, 'critic', 'needs_revision');
    signalCondition(db, instanceId, 'critic', 'has_open_questions');

    // Verify signals are stored
    const signals = getConditionSignals(db, instanceId, 'critic');
    expect(signals).toContain('needs_revision');
    expect(signals).toContain('has_open_questions');

    // Complete critic
    const status = getWorkflowStatus(db, instanceId);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    setTestTaskStatus(db, getStepTaskDisplayId(status.data, 'critic'), 'done');

    const advResult = await advanceWorkflow(db, config, instanceId);
    expect(advResult.ok).toBe(true);
    if (!advResult.ok) return;

    // Both conditional targets should be activated
    expect(advResult.data.advanced).toContain('design');
    expect(advResult.data.advanced).toContain('research');
    // Unconditional forward edge should be suppressed (critic has signals)
    expect(advResult.data.advanced).not.toContain('spec-tests');
  });

  // --- Signal read/write basics ---

  test('signalCondition writes and getConditionSignals reads back', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('critic'), step('design')],
      [edge('critic', 'design', 'needs_revision')]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {
      workstream: '1',
    });
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;
    const instanceId = instResult.data.display_id;

    await expandWorkflow(db, config, embedder, instanceId);

    const result = signalCondition(db, instanceId, 'critic', 'needs_revision');
    expect(result.ok).toBe(true);

    const signals = getConditionSignals(db, instanceId, 'critic');
    expect(signals).toEqual(['needs_revision']);
  });

  test('signalCondition deduplicates repeated signals', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('critic'), step('design')],
      [edge('critic', 'design', 'needs_revision')]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {
      workstream: '1',
    });
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;
    const instanceId = instResult.data.display_id;

    await expandWorkflow(db, config, embedder, instanceId);

    signalCondition(db, instanceId, 'critic', 'needs_revision');
    signalCondition(db, instanceId, 'critic', 'needs_revision');

    const signals = getConditionSignals(db, instanceId, 'critic');
    expect(signals).toEqual(['needs_revision']);
  });

  test('getConditionSignals returns empty array when no signals exist', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('critic'), step('design')],
      [edge('critic', 'design')]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {
      workstream: '1',
    });
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;
    const instanceId = instResult.data.display_id;

    await expandWorkflow(db, config, embedder, instanceId);

    const signals = getConditionSignals(db, instanceId, 'critic');
    expect(signals).toEqual([]);
  });
});
