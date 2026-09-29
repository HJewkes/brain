import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import matter from 'gray-matter';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb } from '../../helpers.js';
import { indexSingleFile } from '../../../src/services/indexing.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { createTask, getTask } from '../../../src/modules/pm/data/task-ops.js';
import { setTaskFields } from '../../../src/modules/pm/data/task-fields.js';

const TASK_ID = 'DEMO-01.01';
const DONE_WHEN = 'A client says "ok": twice';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

function taskFile(): string {
  return join(notesDir, 'modules', 'pm', 'DEMO', `${TASK_ID}.md`);
}

function parseTaskFile(): Record<string, unknown> {
  return matter(readFileSync(taskFile(), 'utf-8')).data;
}

async function rewriteTaskFile(content: string): Promise<void> {
  writeFileSync(taskFile(), content, 'utf-8');
  const hash = createHash('sha256').update(content).digest('hex');
  await indexSingleFile(db, embedder, taskFile(), content, hash, Date.now());
}

beforeEach(async () => {
  ({ dbPath, db } = createTestDb());
  notesDir = join(tmpdir(), `pm-task-fields-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await createProject(db, config, embedder, { name: 'Demo', prefix: 'DEMO' });
  await createWorkstream(db, config, embedder, { project: 'DEMO', name: 'Widgets' });
  await createTask(db, config, embedder, {
    project: 'DEMO',
    workstream: 1,
    name: 'Wire widget',
    description: 'Connect the widget to the client.',
  });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('setTaskFields round-trip', () => {
  it('writes estimate, a quoted done_when, and a tag readable through the file and getTask', async () => {
    const result = await setTaskFields(db, config, embedder, TASK_ID, {
      estimate: 8,
      doneWhen: DONE_WHEN,
      addTags: ['kind:platform'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.changed).toEqual(['estimate', 'done_when', 'tags']);

    const fm = parseTaskFile();
    expect(fm.estimate).toBe(8);
    expect(fm.done_when).toBe(DONE_WHEN);
    expect(fm.tags).toEqual(['kind:platform']);

    const task = getTask(db, TASK_ID);
    expect(task.ok).toBe(true);
    if (!task.ok) return;
    expect(task.data.estimate).toBe(8);
    expect(task.data.done_when).toBe(DONE_WHEN);
    expect(task.data.tags).toEqual(['kind:platform']);
  });

  it('round-trips a multi-line done_when as a single frontmatter line', async () => {
    const multiLine = 'First: "one"\nSecond: two';

    await setTaskFields(db, config, embedder, TASK_ID, { doneWhen: multiLine });

    expect(parseTaskFile().done_when).toBe(multiLine);
    const task = getTask(db, TASK_ID);
    expect(task.ok && task.data.done_when).toBe(multiLine);
  });

  it('adds and removes tags without duplicating an existing tag', async () => {
    await setTaskFields(db, config, embedder, TASK_ID, { addTags: ['kind:platform'] });

    const result = await setTaskFields(db, config, embedder, TASK_ID, {
      addTags: ['kind:platform', 'area:alpha'],
    });
    expect(result.ok && result.data.changed).toEqual(['tags']);
    expect(parseTaskFile().tags).toEqual(['kind:platform', 'area:alpha']);

    await setTaskFields(db, config, embedder, TASK_ID, { removeTags: ['kind:platform'] });
    expect(parseTaskFile().tags).toEqual(['area:alpha']);
    const task = getTask(db, TASK_ID);
    expect(task.ok && task.data.tags).toEqual(['area:alpha']);
  });

  it('removes the tags key when the last tag is removed', async () => {
    await setTaskFields(db, config, embedder, TASK_ID, { addTags: ['kind:platform'] });

    await setTaskFields(db, config, embedder, TASK_ID, { removeTags: ['kind:platform'] });

    expect(readFileSync(taskFile(), 'utf-8')).not.toMatch(/^tags:/m);
  });

  it('clears estimate and done_when when given null', async () => {
    await setTaskFields(db, config, embedder, TASK_ID, { estimate: 3, doneWhen: DONE_WHEN });

    const result = await setTaskFields(db, config, embedder, TASK_ID, {
      estimate: null,
      doneWhen: null,
    });

    expect(result.ok && result.data.changed).toEqual(['estimate', 'done_when']);
    const fm = parseTaskFile();
    expect(fm).not.toHaveProperty('estimate');
    expect(fm).not.toHaveProperty('done_when');
  });
});

describe('setTaskFields with block-list tags', () => {
  it('rewrites a block-list tags key into valid YAML', async () => {
    const original = readFileSync(taskFile(), 'utf-8');
    const withBlockList = original.replace(
      'status: pending\n',
      'status: pending\ntags:\n  - kind:platform\n  - area:alpha\n'
    );
    await rewriteTaskFile(withBlockList);

    const result = await setTaskFields(db, config, embedder, TASK_ID, {
      addTags: ['area:beta'],
    });

    expect(result.ok).toBe(true);
    const content = readFileSync(taskFile(), 'utf-8');
    expect(content).not.toMatch(/^\s+- /m);
    const fm = parseTaskFile();
    expect(fm.tags).toEqual(['kind:platform', 'area:alpha', 'area:beta']);
    expect(fm.mode).toBe('auto');
    expect(fm.status).toBe('pending');
  });
});

describe('setTaskFields idempotence', () => {
  it('reports no changes and leaves the file untouched when values are identical', async () => {
    await setTaskFields(db, config, embedder, TASK_ID, {
      estimate: 8,
      doneWhen: DONE_WHEN,
      addTags: ['kind:platform'],
    });
    const before = readFileSync(taskFile(), 'utf-8');

    const result = await setTaskFields(db, config, embedder, TASK_ID, {
      estimate: 8,
      doneWhen: DONE_WHEN,
      addTags: ['kind:platform'],
      removeTags: ['area:alpha'],
    });

    expect(result.ok && result.data.changed).toEqual([]);
    expect(readFileSync(taskFile(), 'utf-8')).toBe(before);
  });
});

describe('setTaskFields validation', () => {
  const invalidCases: Array<[string, Parameters<typeof setTaskFields>[4]]> = [
    ['no fields', {}],
    ['a fractional estimate', { estimate: 2.5 }],
    ['an estimate above 100', { estimate: 101 }],
    ['a negative estimate', { estimate: -1 }],
    ['a blank done_when', { doneWhen: '   ' }],
    ['a done_when over 500 chars', { doneWhen: 'x'.repeat(501) }],
    ['an uppercase tag', { addTags: ['Kind:Platform'] }],
    ['a tag with a space', { removeTags: ['kind platform'] }],
    ['a tag in both add and remove', { addTags: ['area:alpha'], removeTags: ['area:alpha'] }],
    ['more than 20 tags', { addTags: Array.from({ length: 21 }, (_, i) => `t${i}`) }],
  ];

  it.each(invalidCases)('rejects %s with INVALID_INPUT and writes nothing', async (_, updates) => {
    const before = readFileSync(taskFile(), 'utf-8');

    const result = await setTaskFields(db, config, embedder, TASK_ID, updates);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(readFileSync(taskFile(), 'utf-8')).toBe(before);
  });

  it('returns NOT_FOUND for an unknown task', async () => {
    const result = await setTaskFields(db, config, embedder, 'DEMO-01.99', { estimate: 1 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });
});
