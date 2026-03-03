import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { createTask, listTasks, getTask } from '../../../src/modules/pm/data/task-ops.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-task-template');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-task-template-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });
  await createWorkstream(db, config, embedder, { project: 'WEB', name: 'Frontend' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('task creation template fields', () => {
  it('--done-when is stored in frontmatter and returned in task metadata', async () => {
    const result = await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Build login page',
      doneWhen: 'Endpoint returns 200 with valid payload',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.done_when).toBe('Endpoint returns 200 with valid payload');

    const getResult = getTask(db, result.data.display_id);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.data.done_when).toBe('Endpoint returns 200 with valid payload');

    // Verify frontmatter file contains the field
    const filePath = join(notesDir, 'modules', 'pm', 'WEB', `${result.data.display_id}.md`);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('done_when: "Endpoint returns 200 with valid payload"');
  });

  it('--ac items are stored as acceptance_criteria array in frontmatter', async () => {
    const criteria = ['Implements POST /api', 'Validates body', 'Returns errors'];
    const result = await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'API endpoint',
      acceptanceCriteria: criteria,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.acceptance_criteria).toEqual(criteria);

    const getResult = getTask(db, result.data.display_id);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.data.acceptance_criteria).toEqual(criteria);

    // Verify frontmatter
    const filePath = join(notesDir, 'modules', 'pm', 'WEB', `${result.data.display_id}.md`);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('acceptance_criteria:');
    expect(content).toContain('  - "Implements POST /api"');
    expect(content).toContain('  - "Validates body"');
    expect(content).toContain('  - "Returns errors"');
  });

  it('--refs is stored as references array in frontmatter', async () => {
    const refs = ['src/api/routes.ts', 'docs/api-spec.md'];
    const result = await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Refactor routes',
      references: refs,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.references).toEqual(refs);

    const getResult = getTask(db, result.data.display_id);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.data.references).toEqual(refs);

    // Verify frontmatter
    const filePath = join(notesDir, 'modules', 'pm', 'WEB', `${result.data.display_id}.md`);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('references:');
    expect(content).toContain('  - "src/api/routes.ts"');
    expect(content).toContain('  - "docs/api-spec.md"');
  });

  it('acceptance_criteria from frontmatter takes precedence over body regex', async () => {
    const result = await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Mixed criteria',
      acceptanceCriteria: ['From CLI flag'],
      description: 'Acceptance Criteria:\\n- From body regex',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const listResult = listTasks(db, 'WEB', undefined, 'default');
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;

    const task = listResult.data.find((t) => t.display_id === result.data.display_id);
    expect(task).toBeDefined();
    expect(task!.acceptance_criteria).toEqual(['From CLI flag']);
  });

  it('listTasks includes acceptance_criteria in default mode', async () => {
    const criteria = ['Unit tests pass', 'No regressions'];
    await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Add tests',
      acceptanceCriteria: criteria,
    });

    const listResult = listTasks(db, 'WEB', undefined, 'default');
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;

    expect(listResult.data).toHaveLength(1);
    expect(listResult.data[0].acceptance_criteria).toEqual(criteria);
  });

  it('done_when with quotes is escaped in frontmatter', async () => {
    const result = await createTask(db, config, embedder, {
      project: 'WEB',
      workstream: 1,
      name: 'Test quoting',
      doneWhen: 'Response includes "success" field',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const getResult = getTask(db, result.data.display_id);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.data.done_when).toBe('Response includes "success" field');
  });
});
