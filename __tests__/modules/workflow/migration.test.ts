import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder, indexNoteFile } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import {
  registerWorkflow,
  instantiateWorkflow,
  expandWorkflow,
  getWorkflowStatus,
} from '../../../src/modules/workflow/data/workflow-ops.js';

import type { WorkflowDefinition } from '../../../src/modules/workflow/types.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('wf-migration');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `wf-mig-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath, embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
  await createProject(db, config, embedder, { name: 'CO', prefix: 'CO' });
  await createWorkstream(db, config, embedder, { project: 'CO', name: 'Coordination' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

async function registerDefinition(def: WorkflowDefinition): Promise<string> {
  const noteFilePath = join(notesDir, `wf-${randomUUID().slice(0, 8)}.md`);
  writeFileSync(noteFilePath, `---\ntype: workflow\nmodule: workflow\n---\n\n${JSON.stringify(def)}`);
  const noteId = await indexNoteFile(db, embedder, noteFilePath);
  const result = await registerWorkflow(db, config, embedder, noteId!);
  expect(result.ok).toBe(true);
  return (result as { ok: true; data: { display_id: string } }).data.display_id;
}

// --- AC-14: Planning Workflow Migration ---

describe('planning workflow migration', () => {
  const planningDef: WorkflowDefinition = {
    version: 1,
    name: 'planning',
    description: 'Planning workflow matching startup.md state machine',
    steps: [
      { id: 'research', name: 'Research', category: 'research', mode: 'agent' },
      { id: 'interview', name: 'Interview', category: 'research', mode: 'human' },
      { id: 'design', name: 'Design', category: 'design', mode: 'agent' },
      { id: 'critic', name: 'Critic', category: 'review', mode: 'agent' },
      { id: 'spec-tests', name: 'Spec Tests', category: 'testing', mode: 'agent' },
      { id: 'decompose', name: 'Decompose', category: 'design', mode: 'agent' },
      { id: 'implement', name: 'Implement', category: 'implementation', mode: 'agent' },
      { id: 'review', name: 'Review', category: 'review', mode: 'review' },
    ],
    edges: [
      { from: 'research', to: 'interview' },
      { from: 'interview', to: 'design' },
      { from: 'design', to: 'critic' },
      { from: 'critic', to: 'spec-tests', condition: 'all_resolved' },
      { from: 'critic', to: 'interview', condition: 'has_open_questions' },
      { from: 'spec-tests', to: 'decompose' },
      { from: 'decompose', to: 'implement' },
      { from: 'implement', to: 'review' },
    ],
  };

  test('AC-14: planning workflow registers, instantiates, and expands with correct structure', async () => {
    const workflowId = await registerDefinition(planningDef);
    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'CO', {
      planId: 'CO-04.08',
    });
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;

    const expandResult = await expandWorkflow(db, config, embedder, instResult.data.display_id);
    expect(expandResult.ok).toBe(true);
    if (!expandResult.ok) return;

    expect(expandResult.data.tasksCreated).toBe(8);

    const status = getWorkflowStatus(db, instResult.data.display_id);
    expect(status.ok).toBe(true);
    if (!status.ok) return;

    const stepIds = status.data.steps.map((s) => s.stepId);
    expect(stepIds).toContain('research');
    expect(stepIds).toContain('critic');
    expect(stepIds).toContain('spec-tests');
    expect(stepIds).toContain('review');

    const researchStep = status.data.steps.find((s) => s.stepId === 'research');
    expect(researchStep!.status).toBe('pending');
  });
});

// --- AC-15: Implementation Workflow Migration ---

describe('implementation workflow migration', () => {
  const implDef: WorkflowDefinition = {
    version: 1,
    name: 'implementation',
    description: 'Implementation lifecycle workflow',
    steps: [
      { id: 'dispatch', name: 'Dispatch', category: 'infrastructure', mode: 'agent' },
      { id: 'implement', name: 'Implement', category: 'implementation', mode: 'agent' },
      { id: 'review', name: 'Review', category: 'review', mode: 'review' },
      { id: 'fix', name: 'Fix', category: 'implementation', mode: 'agent' },
      { id: 'merge', name: 'Merge', category: 'infrastructure', mode: 'agent' },
    ],
    edges: [
      { from: 'dispatch', to: 'implement' },
      { from: 'implement', to: 'review' },
      { from: 'review', to: 'fix', condition: 'needs_fixes' },
      { from: 'review', to: 'merge', condition: 'approved' },
      { from: 'fix', to: 'merge' },
    ],
  };

  test('AC-14/AC-15: implementation workflow expands with correct dependency structure', async () => {
    const workflowId = await registerDefinition(implDef);
    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'CO', {});
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;

    const expandResult = await expandWorkflow(db, config, embedder, instResult.data.display_id);
    expect(expandResult.ok).toBe(true);
    if (!expandResult.ok) return;

    expect(expandResult.data.tasksCreated).toBe(5);

    const status = getWorkflowStatus(db, instResult.data.display_id);
    expect(status.ok).toBe(true);
    if (!status.ok) return;

    const dispatchStep = status.data.steps.find((s) => s.stepId === 'dispatch');
    expect(dispatchStep).toBeDefined();
    expect(dispatchStep!.status).toBe('pending');
  });

  test('AC-15: implementation workflow can be instantiated as sub-workflow', async () => {
    const planningDef: WorkflowDefinition = {
      version: 1,
      name: 'planning',
      description: 'Planning workflow',
      steps: [{ id: 'implement', name: 'Implement' }],
      edges: [],
    };
    await registerDefinition(planningDef);
    const implWorkflowId = await registerDefinition(implDef);

    const result = await instantiateWorkflow(db, config, embedder, implWorkflowId, 'CO', {
      parentStep: 'implement',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.workflow_id).toBe(implWorkflowId);
  });
});
