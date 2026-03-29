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
import { getInstanceByDisplayId } from '../../../src/modules/workflow/data/queries.js';
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
  notesDir = join(tmpdir(), `wf-expand-${randomUUID()}`);
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

describe('expandWorkflow bug fixes', () => {
  test('CO-03.35: child task notes have correct step_id metadata after expand', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('research', 'Research'), step('implement', 'Implement'), step('review', 'Review')],
      [edge('research', 'implement'), edge('implement', 'review')]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {
      workstream: '1',
    });
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;

    const expandResult = await expandWorkflow(db, config, embedder, instResult.data.display_id);
    expect(expandResult.ok).toBe(true);
    if (!expandResult.ok) return;
    expect(expandResult.data.tasksCreated).toBe(3);

    const status = getWorkflowStatus(db, instResult.data.display_id);
    expect(status.ok).toBe(true);
    if (!status.ok) return;

    const stepIds = status.data.steps.map((s) => s.stepId).sort();
    expect(stepIds).toEqual(['implement', 'research', 'review']);

    // Verify no step_id is empty
    for (const s of status.data.steps) {
      expect(s.stepId).toBeTruthy();
      expect(s.stepId.length).toBeGreaterThan(0);
    }
  });

  test('CO-03.36: dependency relations only exist for unconditional edges', async () => {
    const workflowId = await createAndRegisterWorkflow(
      [step('research', 'Research'), step('critic', 'Critic'), step('implement', 'Implement')],
      [
        edge('research', 'critic'),
        edge('critic', 'implement'),
        edge('critic', 'research', 'has_open_questions'), // conditional feedback loop
      ]
    );

    const instResult = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {
      workstream: '1',
    });
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;

    const expandResult = await expandWorkflow(db, config, embedder, instResult.data.display_id);
    expect(expandResult.ok).toBe(true);
    if (!expandResult.ok) return;

    // Only 2 unconditional edges should create dependencies (not the conditional one)
    expect(expandResult.data.edges).toBe(2);

    // Verify research task has no depends_on relations
    // (the conditional edge critic->research should NOT create a dependency)
    const instanceResult = getInstanceByDisplayId(db, instResult.data.display_id);
    expect(instanceResult.ok).toBe(true);
    if (!instanceResult.ok) return;

    const instanceNote = instanceResult.data.note;
    const expandsTo = db.getRelationsFrom(instanceNote.id).filter((r) => r.type === 'expands-to');

    // Find the research child task note
    const childNotes = db.getNotesByIds(expandsTo.map((r) => r.targetId));
    let researchNoteId: string | undefined;
    for (const [, childNote] of childNotes) {
      if (!childNote.metadata) continue;
      const meta = JSON.parse(childNote.metadata) as Record<string, unknown>;
      if (meta.step_id === 'research') {
        researchNoteId = childNote.id;
        break;
      }
    }
    expect(researchNoteId).toBeDefined();

    // Research should have NO depends_on relations
    const researchRelations = db.getRelationsFrom(researchNoteId!);
    const dependsOnRelations = researchRelations.filter((r) => r.type === 'depends_on');
    expect(dependsOnRelations).toHaveLength(0);
  });
});
