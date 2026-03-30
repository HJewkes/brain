import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../../src/services/brain-db.js';
import {
  createMockEmbedder,
  indexNoteFile,
  setTestTaskStatus,
  createTestDb,
} from '../../../helpers.js';
import type { BrainConfig } from '../../../../src/types.js';
import { createProject } from '../../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../../src/modules/pm/data/workstream-ops.js';
import {
  registerWorkflow,
  instantiateWorkflow,
  expandWorkflow,
} from '../../../../src/modules/workflow/data/workflow-ops.js';
import { advanceWorkflow } from '../../../../src/modules/workflow/engine/lifecycle.js';
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowEdge,
} from '../../../../src/modules/workflow/types.js';
import { parseConditionSignals } from '../../../../src/modules/workflow/engine/executor.js';
import { captureStepOutput } from '../../../../src/modules/workflow/engine/output-capture.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

function step(id: string, opts?: Partial<WorkflowStep>): WorkflowStep {
  return { id, name: opts?.name ?? id, ...opts };
}

function edge(from: string, to: string, condition?: string): WorkflowEdge {
  return { from, to, ...(condition ? { condition } : {}) };
}

beforeEach(async () => {
  ({ dbPath, db } = createTestDb());
  notesDir = join(tmpdir(), `wf-executor-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath, embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
  await createProject(db, config, embedder, { name: 'Test', prefix: 'TST', path: notesDir });
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

// --- parseConditionSignals ---

describe('parseConditionSignals', () => {
  const criticDef: WorkflowDefinition = {
    version: 1,
    name: 'test',
    description: 'test',
    steps: [
      { id: 'design', name: 'Design' },
      { id: 'critic', name: 'Critic' },
      { id: 'spec-tests', name: 'Spec Tests' },
      { id: 'research', name: 'Research' },
    ],
    edges: [
      { from: 'design', to: 'critic' },
      { from: 'critic', to: 'design', condition: 'needs_revision' },
      { from: 'critic', to: 'spec-tests' },
      { from: 'critic', to: 'research', condition: 'has_open_questions' },
    ],
  };

  test('returns needs_revision when critic report has NEEDS REVISION verdict', () => {
    const plansDir = join(notesDir, '.plans', 'test-plan');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(
      join(plansDir, 'critic-report.md'),
      '# Critic Report\n\n## Verdict: NEEDS REVISION\n\n## Findings\n...'
    );

    const signals = parseConditionSignals(
      notesDir, 'instance-1', 'critic', criticDef,
      { planId: 'test-plan' }
    );

    expect(signals).toContain('needs_revision');
  });

  test('returns has_open_questions when Open Questions section has content', () => {
    const plansDir = join(notesDir, '.plans', 'test-plan');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(
      join(plansDir, 'critic-report.md'),
      '# Critic Report\n\n## Verdict: READY\n\n## Open Questions\n\n1. How should X work?\n2. What about Y?\n'
    );

    const signals = parseConditionSignals(
      notesDir, 'instance-1', 'critic', criticDef,
      { planId: 'test-plan' }
    );

    expect(signals).toContain('has_open_questions');
    expect(signals).not.toContain('needs_revision');
  });

  test('returns empty when verdict is READY and no open questions', () => {
    const plansDir = join(notesDir, '.plans', 'test-plan');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(
      join(plansDir, 'critic-report.md'),
      '# Critic Report\n\n## Verdict: READY\n\n## Open Questions\n\n'
    );

    const signals = parseConditionSignals(
      notesDir, 'instance-1', 'critic', criticDef,
      { planId: 'test-plan' }
    );

    expect(signals).toHaveLength(0);
  });

  test('returns empty for steps with no outgoing conditional edges', () => {
    const signals = parseConditionSignals(
      notesDir, 'instance-1', 'design', criticDef,
      { planId: 'test-plan' },
      'some agent output'
    );

    expect(signals).toHaveLength(0);
  });

  test('falls back to agentOutput when file not found', () => {
    const signals = parseConditionSignals(
      notesDir, 'instance-1', 'critic', criticDef,
      { planId: 'nonexistent-plan' },
      '## Verdict: NEEDS REVISION\n\nSome output from agent'
    );

    expect(signals).toContain('needs_revision');
  });

  test('returns both signals when both conditions match', () => {
    const plansDir = join(notesDir, '.plans', 'test-plan');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(
      join(plansDir, 'critic-report.md'),
      '# Critic Report\n\n## Verdict: NEEDS REVISION\n\n## Open Questions\n\n1. Unresolved question\n'
    );

    const signals = parseConditionSignals(
      notesDir, 'instance-1', 'critic', criticDef,
      { planId: 'test-plan' }
    );

    expect(signals).toContain('needs_revision');
    expect(signals).toContain('has_open_questions');
  });

  test('returns empty when no planId in context', () => {
    const signals = parseConditionSignals(
      notesDir, 'instance-1', 'critic', criticDef, {}
    );

    expect(signals).toHaveLength(0);
  });
});

// --- Integration: workflow expansion + advancement ---

describe('workflow expansion and advancement integration', () => {
  test('expanded workflow has correct step states', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('a'), step('b'), step('c')],
      [edge('a', 'b'), edge('b', 'c')]
    );

    const instResult = await instantiateWorkflow(
      db, config, embedder, workflowId, 'TST',
      { workstream: '1' }
    );
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;

    const expandResult = await expandWorkflow(
      db, config, embedder, instResult.data.display_id
    );
    expect(expandResult.ok).toBe(true);
    if (!expandResult.ok) return;
    expect(expandResult.data.tasksCreated).toBe(3);

    const { getInstanceStepStates } = await import(
      '../../../../src/modules/workflow/data/queries.js'
    );
    const stepsResult = getInstanceStepStates(db, instResult.data.display_id);
    expect(stepsResult.ok).toBe(true);
    if (!stepsResult.ok) return;

    expect(stepsResult.data.steps).toHaveLength(3);
    expect(stepsResult.data.progress.pending).toBe(3);
  });

  test('advancement includes successors of entry steps (entry nodes are inherently ready)', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('a'), step('b')],
      [edge('a', 'b')]
    );

    const instResult = await instantiateWorkflow(
      db, config, embedder, workflowId, 'TST',
      { workstream: '1' }
    );
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;

    await expandWorkflow(db, config, embedder, instResult.data.display_id);

    const advResult = await advanceWorkflow(db, config, instResult.data.display_id);
    expect(advResult.ok).toBe(true);
    if (!advResult.ok) return;

    // Entry nodes (no predecessors) are in readySet, so their successors are advanceable
    // The executor's executeWorkflowStep handles dispatch ordering via task status checks
    expect(advResult.data.advanced).toContain('b');
  });

  test('completing entry step and advancing reveals successor', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('a'), step('b')],
      [edge('a', 'b')]
    );

    const instResult = await instantiateWorkflow(
      db, config, embedder, workflowId, 'TST',
      { workstream: '1' }
    );
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;

    await expandWorkflow(db, config, embedder, instResult.data.display_id);

    const { getInstanceStepStates } = await import(
      '../../../../src/modules/workflow/data/queries.js'
    );
    const stepsResult = getInstanceStepStates(db, instResult.data.display_id);
    if (!stepsResult.ok) return;

    const stepA = stepsResult.data.steps.find((s) => s.stepId === 'a');
    expect(stepA).toBeTruthy();
    setTestTaskStatus(db, stepA!.taskDisplayId, 'done');

    const advResult = await advanceWorkflow(db, config, instResult.data.display_id);
    expect(advResult.ok).toBe(true);
    if (!advResult.ok) return;

    expect(advResult.data.advanced).toContain('b');
  });
});

// --- Output capture integration ---

describe('output capture in project directory', () => {
  test('captureStepOutput and getStepOutput round-trip', async () => {
    captureStepOutput(notesDir, 'TST-01.05', 'research', 'Research brief content');

    const { getStepOutput } = await import(
      '../../../../src/modules/workflow/engine/output-capture.js'
    );

    const output = getStepOutput(notesDir, 'TST-01.05', 'research');
    expect(output).toBe('Research brief content');
  });
});
