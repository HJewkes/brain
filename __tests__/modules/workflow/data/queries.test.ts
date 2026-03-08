import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../../src/services/brain-db.js';
import { tmpDbPath, makeNote, makeChunk } from '../../../helpers.js';
import {
  getWorkflowDefinition,
  listWorkflows,
  getInstanceByDisplayId,
  getInstanceStepStates,
} from '../../../../src/modules/workflow/data/queries.js';
import type { WorkflowDefinition } from '../../../../src/modules/workflow/types.js';
import type { Relation } from '../../../../src/types.js';

let db: BrainDB;

beforeEach(() => {
  db = new BrainDB(tmpDbPath('wf-queries'));
  db.setEmbeddingModel('test', 3);
});

afterEach(() => {
  db.close();
});

function seedWorkflowNote(
  overrides: { display_id?: string; name?: string; registration_status?: string; project?: string } = {},
): string {
  const id = `wf-${overrides.display_id ?? 'WF-01'}`;
  const meta = {
    display_id: overrides.display_id ?? 'WF-01',
    name: overrides.name ?? 'Test Workflow',
    version: 1,
    registration_status: overrides.registration_status ?? 'registered',
    step_count: 2,
    edge_count: 1,
    ...(overrides.project ? { project: overrides.project } : {}),
  };

  db.upsertNote(
    makeNote({
      id,
      module: 'workflow',
      type: 'workflow',
      title: meta.name,
      metadata: JSON.stringify(meta),
    }),
  );
  return id;
}

function seedWorkflowContent(noteId: string, def: WorkflowDefinition): void {
  const chunk = makeChunk({
    noteId,
    content: JSON.stringify(def),
  });
  db.upsertChunks(noteId, [chunk], [new Float32Array([0.1, 0.2, 0.3])]);
}

function validDefinition(): WorkflowDefinition {
  return {
    version: 1,
    name: 'test-workflow',
    description: 'A test workflow',
    steps: [
      { id: 'research', name: 'Research' },
      { id: 'implement', name: 'Implement' },
    ],
    edges: [{ from: 'research', to: 'implement' }],
  };
}

function seedInstanceNote(displayId: string, workflowId: string, instanceStatus = 'expanded'): string {
  const id = `task-${displayId}`;
  const meta = {
    display_id: displayId,
    project: 'TST',
    status: 'pending',
    workflow_id: workflowId,
    workflow_version: 1,
    instance_status: instanceStatus,
    context: { branch: 'feat/test' },
  };

  db.upsertNote(
    makeNote({
      id,
      module: 'pm',
      type: 'task',
      title: `Instance ${displayId}`,
      metadata: JSON.stringify(meta),
    }),
  );
  return id;
}

function seedStepTasks(
  instanceNoteId: string,
  steps: Array<{ stepId: string; displayId: string; status: string }>,
): void {
  const relations: Relation[] = [];
  for (const step of steps) {
    const id = `task-${step.displayId}`;
    const meta = {
      display_id: step.displayId,
      project: 'TST',
      status: step.status,
      step_id: step.stepId,
    };

    db.upsertNote(
      makeNote({
        id,
        module: 'pm',
        type: 'task',
        title: `Step ${step.stepId}`,
        metadata: JSON.stringify(meta),
      }),
    );

    relations.push({ sourceId: instanceNoteId, targetId: id, type: 'expands-to' });
  }

  db.upsertRelations(instanceNoteId, relations);
}

// --- getWorkflowDefinition ---

describe('getWorkflowDefinition', () => {
  it('returns definition when workflow exists', () => {
    const noteId = seedWorkflowNote({ display_id: 'WF-01' });
    const def = validDefinition();
    seedWorkflowContent(noteId, def);

    const result = getWorkflowDefinition(db, 'WF-01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.metadata.display_id).toBe('WF-01');
    expect(result.data.definition.name).toBe('test-workflow');
    expect(result.data.definition.steps).toHaveLength(2);
    expect(result.data.note.id).toBe(noteId);
  });

  it('returns NOT_FOUND when no workflow notes exist', () => {
    const result = getWorkflowDefinition(db, 'WF-99');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns NOT_FOUND when display_id does not match', () => {
    seedWorkflowNote({ display_id: 'WF-01' });

    const result = getWorkflowDefinition(db, 'WF-99');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns NOT_FOUND when workflow has no chunk content', () => {
    seedWorkflowNote({ display_id: 'WF-EMPTY' });

    const result = getWorkflowDefinition(db, 'WF-EMPTY');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('no content');
    }
  });

  it('returns INVALID_INPUT when body is not valid JSON', () => {
    const noteId = seedWorkflowNote({ display_id: 'WF-BAD' });
    const chunk = makeChunk({ noteId, content: 'not json {{{' });
    db.upsertChunks(noteId, [chunk], [new Float32Array([0.1, 0.2, 0.3])]);

    const result = getWorkflowDefinition(db, 'WF-BAD');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });
});

// --- listWorkflows ---

describe('listWorkflows', () => {
  it('returns empty array when no workflows exist', () => {
    const result = listWorkflows(db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([]);
  });

  it('returns all workflows without filters', () => {
    seedWorkflowNote({ display_id: 'WF-A', name: 'Alpha' });
    seedWorkflowNote({ display_id: 'WF-B', name: 'Beta' });

    const result = listWorkflows(db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);
  });

  it('filters by project', () => {
    seedWorkflowNote({ display_id: 'WF-A', project: 'SDK' });
    seedWorkflowNote({ display_id: 'WF-B', project: 'VLT' });

    const result = listWorkflows(db, { project: 'SDK' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].display_id).toBe('WF-A');
  });

  it('filters by registration status', () => {
    seedWorkflowNote({ display_id: 'WF-A', registration_status: 'registered' });
    seedWorkflowNote({ display_id: 'WF-B', registration_status: 'draft' });

    const result = listWorkflows(db, { status: 'draft' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].display_id).toBe('WF-B');
  });

  it('filters by both project and status', () => {
    seedWorkflowNote({ display_id: 'WF-A', project: 'SDK', registration_status: 'registered' });
    seedWorkflowNote({ display_id: 'WF-B', project: 'SDK', registration_status: 'draft' });
    seedWorkflowNote({ display_id: 'WF-C', project: 'VLT', registration_status: 'registered' });

    const result = listWorkflows(db, { project: 'SDK', status: 'registered' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].display_id).toBe('WF-A');
  });
});

// --- getInstanceByDisplayId ---

describe('getInstanceByDisplayId', () => {
  it('returns instance metadata for a workflow task', () => {
    seedInstanceNote('TST-01.01', 'WF-01');

    const result = getInstanceByDisplayId(db, 'TST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.metadata.workflow_id).toBe('WF-01');
    expect(result.data.metadata.instance_status).toBe('expanded');
    expect(result.data.metadata.context).toEqual({ branch: 'feat/test' });
  });

  it('returns NOT_FOUND when task does not exist', () => {
    const result = getInstanceByDisplayId(db, 'TST-99.99');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns NOT_FOUND when task is not a workflow instance', () => {
    const meta = { display_id: 'TST-01.01', project: 'TST', status: 'pending' };
    db.upsertNote(
      makeNote({
        id: 'task-plain',
        module: 'pm',
        type: 'task',
        title: 'Plain task',
        metadata: JSON.stringify(meta),
      }),
    );

    const result = getInstanceByDisplayId(db, 'TST-01.01');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('not a workflow instance');
    }
  });
});

// --- getInstanceStepStates ---

describe('getInstanceStepStates', () => {
  it('returns step states computed from child tasks', () => {
    const instanceId = seedInstanceNote('TST-01.01', 'WF-01');
    seedStepTasks(instanceId, [
      { stepId: 'research', displayId: 'TST-01.02', status: 'done' },
      { stepId: 'implement', displayId: 'TST-01.03', status: 'pending' },
    ]);

    const result = getInstanceStepStates(db, 'TST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.steps).toHaveLength(2);
    expect(result.data.progress).toEqual({
      total: 2,
      done: 1,
      pruned: 0,
      active: 0,
      pending: 1,
    });
  });

  it('returns empty steps when instance has no expands-to relations', () => {
    seedInstanceNote('TST-02.01', 'WF-01');

    const result = getInstanceStepStates(db, 'TST-02.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.steps).toEqual([]);
    expect(result.data.progress.total).toBe(0);
  });

  it('counts pruned and cancelled steps correctly', () => {
    const instanceId = seedInstanceNote('TST-03.01', 'WF-01');
    seedStepTasks(instanceId, [
      { stepId: 'step-a', displayId: 'TST-03.02', status: 'pruned' },
      { stepId: 'step-b', displayId: 'TST-03.03', status: 'cancelled' },
      { stepId: 'step-c', displayId: 'TST-03.04', status: 'done' },
    ]);

    const result = getInstanceStepStates(db, 'TST-03.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.progress).toEqual({
      total: 3,
      done: 1,
      pruned: 2,
      active: 0,
      pending: 0,
    });
  });

  it('counts active steps (claimed, in-progress) correctly', () => {
    const instanceId = seedInstanceNote('TST-04.01', 'WF-01');
    seedStepTasks(instanceId, [
      { stepId: 'step-a', displayId: 'TST-04.02', status: 'claimed' },
      { stepId: 'step-b', displayId: 'TST-04.03', status: 'in-progress' },
    ]);

    const result = getInstanceStepStates(db, 'TST-04.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.progress).toEqual({
      total: 2,
      done: 0,
      pruned: 0,
      active: 2,
      pending: 0,
    });
  });

  it('propagates NOT_FOUND when instance does not exist', () => {
    const result = getInstanceStepStates(db, 'TST-99.99');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});
