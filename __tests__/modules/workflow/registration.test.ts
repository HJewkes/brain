import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder, indexNoteFile } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { registerWorkflow } from '../../../src/modules/workflow/data/workflow-ops.js';

import type { WorkflowDefinition } from '../../../src/modules/workflow/types.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(() => {
  dbPath = tmpDbPath('wf-registration');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `wf-reg-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = { notesDir, dbPath, embedder: 'local', fusionWeights: { bm25: 0.3, vector: 0.7 } };
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

async function createWorkflowNote(def: WorkflowDefinition): Promise<string> {
  const noteFileName = `workflow-${randomUUID().slice(0, 8)}.md`;
  const noteFilePath = join(notesDir, noteFileName);
  writeFileSync(
    noteFilePath,
    `---\ntype: workflow\n---\n\n${JSON.stringify(def)}`
  );
  const noteId = await indexNoteFile(db, embedder, noteFilePath);
  expect(noteId).toBeTruthy();
  return noteId!;
}

function validDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    version: 1,
    name: 'test-workflow',
    description: 'A test workflow',
    steps: [
      { id: 'research', name: 'Research' },
      { id: 'implement', name: 'Implement' },
    ],
    edges: [{ from: 'research', to: 'implement' }],
    ...overrides,
  };
}

// --- AC-03: Workflow Registration ---

describe('registerWorkflow', () => {
  test('AC-03: registers valid workflow and sets metadata', async () => {
    const noteId = await createWorkflowNote(validDefinition());
    const result = await registerWorkflow(db, config, embedder, noteId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.registration_status).toBe('registered');
    expect(result.data.version).toBe(1);
    expect(result.data.step_count).toBe(2);
    expect(result.data.edge_count).toBe(1);
  });

  test('AC-03: rejects workflow with cycle', async () => {
    const noteId = await createWorkflowNote(
      validDefinition({
        steps: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' },
        ],
      })
    );

    const result = await registerWorkflow(db, config, embedder, noteId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CYCLE_DETECTED');
    }
  });

  test('AC-03: rejects workflow with dangling edge reference', async () => {
    const noteId = await createWorkflowNote(
      validDefinition({
        edges: [{ from: 'research', to: 'nonexistent' }],
      })
    );

    const result = await registerWorkflow(db, config, embedder, noteId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_DEFINITION');
    }
  });

  test('AC-E3: rejects registration of non-workflow note type', async () => {
    const noteFileName = `task-${randomUUID().slice(0, 8)}.md`;
    const noteFilePath = join(notesDir, noteFileName);
    writeFileSync(noteFilePath, `---\ntype: task\n---\n\nSome task content`);
    const noteId = await indexNoteFile(db, embedder, noteFilePath);
    expect(noteId).toBeTruthy();

    const result = await registerWorkflow(db, config, embedder, noteId!);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_NOTE_TYPE');
    }
  });

  test('AC-E8: rejects workflow with empty steps array', async () => {
    const noteId = await createWorkflowNote(
      validDefinition({ steps: [], edges: [] })
    );

    const result = await registerWorkflow(db, config, embedder, noteId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_DEFINITION');
    }
  });
});

// --- AC-10: Workflow Versioning ---

describe('workflow versioning', () => {
  test('AC-10: re-registering increments version to 2', async () => {
    const noteId = await createWorkflowNote(validDefinition());
    const first = await registerWorkflow(db, config, embedder, noteId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.version).toBe(1);

    const second = await registerWorkflow(db, config, embedder, noteId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.version).toBe(2);
  });

  test('AC-10: running instance uses pinned version after definition update', async () => {
    const noteId = await createWorkflowNote(validDefinition());
    await registerWorkflow(db, config, embedder, noteId);

    const { instantiateWorkflow, getWorkflowStatus } = await import(
      '../../../src/modules/workflow/data/workflow-ops.js'
    );
    const { createProject } = await import('../../../src/modules/pm/data/project-ops.js');
    const { createWorkstream } = await import('../../../src/modules/pm/data/workstream-ops.js');
    await createProject(db, config, embedder, { name: 'Test', prefix: 'TST' });
    await createWorkstream(db, config, embedder, { project: 'TST', name: 'Main' });

    const instResult = await instantiateWorkflow(db, config, embedder, noteId, 'TST', {});
    expect(instResult.ok).toBe(true);
    if (!instResult.ok) return;

    // Re-register (version 2)
    await registerWorkflow(db, config, embedder, noteId);

    // Instance should still show version 1
    const status = getWorkflowStatus(db, instResult.data.display_id);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.data.instance.workflow_version).toBe(1);
  });
});
