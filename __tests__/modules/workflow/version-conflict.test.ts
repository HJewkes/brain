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
  getWorkflowStatus,
} from '../../../src/modules/workflow/data/workflow-ops.js';

import type { WorkflowDefinition } from '../../../src/modules/workflow/types.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('wf-version');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `wf-ver-${randomUUID()}`);
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

// --- AC-E9: Version Conflict Query ---

describe('version conflict queries', () => {
  test('AC-E9: instances from different versions are listed with correct version numbers', async () => {
    const def: WorkflowDefinition = {
      version: 1,
      name: 'versioned-wf',
      description: 'Versioned workflow',
      steps: [{ id: 'work', name: 'Work' }],
      edges: [],
    };

    const noteFilePath = join(notesDir, `wf-${randomUUID().slice(0, 8)}.md`);
    writeFileSync(noteFilePath, `---\ntype: workflow\n---\n\n${JSON.stringify(def)}`);
    const noteId = await indexNoteFile(db, embedder, noteFilePath);
    const reg1 = await registerWorkflow(db, config, embedder, noteId!);
    expect(reg1.ok).toBe(true);
    if (!reg1.ok) return;

    const inst1 = await instantiateWorkflow(db, config, embedder, reg1.data.display_id, 'TST', {});
    expect(inst1.ok).toBe(true);

    const reg2 = await registerWorkflow(db, config, embedder, noteId!);
    expect(reg2.ok).toBe(true);
    if (!reg2.ok) return;
    expect(reg2.data.version).toBe(2);

    const inst2 = await instantiateWorkflow(db, config, embedder, reg2.data.display_id, 'TST', {});
    expect(inst2.ok).toBe(true);

    if (inst1.ok) {
      const status1 = getWorkflowStatus(db, inst1.data.display_id);
      expect(status1.ok).toBe(true);
      if (status1.ok) {
        expect(status1.data.instance.workflow_version).toBe(1);
      }
    }

    if (inst2.ok) {
      const status2 = getWorkflowStatus(db, inst2.data.display_id);
      expect(status2.ok).toBe(true);
      if (status2.ok) {
        expect(status2.data.instance.workflow_version).toBe(2);
      }
    }
  });
});
