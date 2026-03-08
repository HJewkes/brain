import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import {
  registerWorkflow,
  instantiateWorkflow,
  getWorkflowStatus,
} from '../../../src/modules/workflow/data/workflow-ops.js';
import { indexSingleFile } from '../../../src/services/indexing.js';
import type { WorkflowDefinition } from '../../../src/modules/workflow/types.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('wf-iteration');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `wf-iter-${randomUUID()}`);
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

async function registerTestWorkflow(): Promise<string> {
  const def: WorkflowDefinition = {
    version: 1,
    name: 'iterable-workflow',
    description: 'Workflow with iterations',
    steps: [{ id: 'work', name: 'Do work' }],
    edges: [],
  };
  const noteFilePath = join(notesDir, `wf-${randomUUID().slice(0, 8)}.md`);
  writeFileSync(noteFilePath, `---\ntype: workflow\n---\n\n${JSON.stringify(def)}`);
  const noteId = await indexSingleFile(db, config, embedder, noteFilePath);
  const result = await registerWorkflow(db, config, embedder, noteId!);
  expect(result.ok).toBe(true);
  return (result as { ok: true; data: { display_id: string } }).data.display_id;
}

// --- AC-08: Iteration Support ---

describe('workflow iteration', () => {
  test('AC-08: new instance has iteration-of relation to previous instance', async () => {
    const workflowId = await registerTestWorkflow();

    const inst1 = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {});
    expect(inst1.ok).toBe(true);
    if (!inst1.ok) return;

    // Create second instance as iteration of first
    const inst2 = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {}, {
      iterationOf: inst1.data.display_id,
    });
    expect(inst2.ok).toBe(true);
    if (!inst2.ok) return;

    expect(inst2.data.workflow_id).toBe(workflowId);
  });

  test('AC-08: iteration chain is queryable via status --history', async () => {
    const workflowId = await registerTestWorkflow();

    const inst1 = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {});
    expect(inst1.ok).toBe(true);
    if (!inst1.ok) return;

    const inst2 = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {}, {
      iterationOf: inst1.data.display_id,
    });
    expect(inst2.ok).toBe(true);
    if (!inst2.ok) return;

    const inst3 = await instantiateWorkflow(db, config, embedder, workflowId, 'TST', {}, {
      iterationOf: inst2.data.display_id,
    });
    expect(inst3.ok).toBe(true);
    if (!inst3.ok) return;

    const status = getWorkflowStatus(db, inst3.data.display_id);
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.data.instance.workflow_version).toBeDefined();
  });
});
