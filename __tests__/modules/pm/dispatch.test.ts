import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { makeNote, createTestDb } from '../../helpers.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { assembleContext, isContextStale } from '../../../src/modules/pm/engine/dispatch.js';

let db: BrainDB;
let tempDir: string;

function taskMeta(displayId: string, project: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    display_id: displayId,
    project,
    workstream: 1,
    number: parseInt(displayId.split('-').pop()!, 10) || 1,
    status: 'pending',
    mode: 'auto',
    category: 'implementation',
    priority: 'medium',
    ...overrides,
  });
}

function decisionMeta(displayId: string, project: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    display_id: displayId,
    project,
    status: 'accepted',
    source_task: 'WEB-01-001',
    ...overrides,
  });
}

function promptMeta(
  displayId: string,
  project: string,
  task: string,
  overrides: Record<string, unknown> = {}
) {
  return JSON.stringify({
    display_id: displayId,
    project,
    task,
    prompt_status: 'current',
    ...overrides,
  });
}

beforeEach(() => {
  ({ db } = createTestDb());
  tempDir = join(tmpdir(), `brain-dispatch-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('assembleContext', () => {
  test('returns NOT_FOUND for non-existent task', () => {
    const result = assembleContext(db, 'WEB-01-999');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  test('assembles context for task with no deps, decisions, or prompt', () => {
    db.upsertNote(
      makeNote({
        id: 'task-001',
        title: 'Setup project',
        module: 'pm',
        type: 'task',
        metadata: taskMeta('WEB-01-001', 'WEB'),
      })
    );

    const result = assembleContext(db, 'WEB-01-001');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.task.display_id).toBe('WEB-01-001');
    expect(result.data.dependencies).toEqual([]);
    expect(result.data.decisions).toEqual([]);
    expect(result.data.prompt).toBeUndefined();
    expect(result.data.contextHash).toBeTruthy();
  });

  test('includes dependency summaries', () => {
    db.upsertNote(
      makeNote({
        id: 'task-dep',
        title: 'Dependency Task',
        module: 'pm',
        type: 'task',
        metadata: taskMeta('WEB-01-001', 'WEB', { status: 'done' }),
      })
    );

    db.upsertNote(
      makeNote({
        id: 'task-main',
        title: 'Main Task',
        module: 'pm',
        type: 'task',
        metadata: taskMeta('WEB-01-002', 'WEB', { depends_on: ['WEB-01-001'] }),
      })
    );

    const result = assembleContext(db, 'WEB-01-002');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.dependencies).toHaveLength(1);
    expect(result.data.dependencies[0]).toEqual({
      displayId: 'WEB-01-001',
      name: 'Dependency Task',
      status: 'done',
      summary: undefined,
      direction: 'upstream',
    });
  });

  test('reads summary.md from content dir when available', () => {
    const contentDir = join(tempDir, 'task-dep-content');
    mkdirSync(contentDir, { recursive: true });
    writeFileSync(join(contentDir, 'summary.md'), 'This task set up the auth layer.');

    db.upsertNote(
      makeNote({
        id: 'task-dep',
        title: 'Auth Setup',
        module: 'pm',
        type: 'task',
        contentDir,
        metadata: taskMeta('WEB-01-001', 'WEB', { status: 'done' }),
      })
    );

    db.upsertNote(
      makeNote({
        id: 'task-main',
        title: 'Build API',
        module: 'pm',
        type: 'task',
        metadata: taskMeta('WEB-01-002', 'WEB', { depends_on: ['WEB-01-001'] }),
      })
    );

    const result = assembleContext(db, 'WEB-01-002');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.dependencies[0].summary).toBe('This task set up the auth layer.');
  });

  test('includes impacting decisions', () => {
    db.upsertNote(
      makeNote({
        id: 'task-001',
        title: 'Build Feature',
        module: 'pm',
        type: 'task',
        metadata: taskMeta('WEB-01-001', 'WEB'),
      })
    );

    db.upsertNote(
      makeNote({
        id: 'dec-001',
        title: 'Use PostgreSQL for storage',
        module: 'pm',
        type: 'decision',
        metadata: decisionMeta('WEB-D001', 'WEB', { impacts: ['WEB-01-001'] }),
      })
    );

    const result = assembleContext(db, 'WEB-01-001');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.decisions).toHaveLength(1);
    expect(result.data.decisions[0]).toEqual({
      displayId: 'WEB-D001',
      status: 'accepted',
      content: 'Use PostgreSQL for storage',
    });
  });

  test('includes prompt content when prompt note exists', () => {
    db.upsertNote(
      makeNote({
        id: 'task-001',
        title: 'Build Feature',
        module: 'pm',
        type: 'task',
        metadata: taskMeta('WEB-01-001', 'WEB'),
      })
    );

    db.upsertNote(
      makeNote({
        id: 'prompt-001',
        title: 'Implement the user login flow using OAuth2',
        module: 'pm',
        type: 'prompt',
        metadata: promptMeta('WEB-P001', 'WEB', 'WEB-01-001'),
      })
    );

    const result = assembleContext(db, 'WEB-01-001');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.prompt).toBe('Implement the user login flow using OAuth2');
  });

  test('prompt is undefined when no prompt note exists', () => {
    db.upsertNote(
      makeNote({
        id: 'task-001',
        title: 'Build Feature',
        module: 'pm',
        type: 'task',
        metadata: taskMeta('WEB-01-001', 'WEB'),
      })
    );

    const result = assembleContext(db, 'WEB-01-001');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.prompt).toBeUndefined();
  });

  test('context hash is deterministic', () => {
    db.upsertNote(
      makeNote({
        id: 'task-001',
        title: 'Build Feature',
        module: 'pm',
        type: 'task',
        metadata: taskMeta('WEB-01-001', 'WEB'),
      })
    );

    const r1 = assembleContext(db, 'WEB-01-001');
    const r2 = assembleContext(db, 'WEB-01-001');
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    expect(r1.data.contextHash).toBe(r2.data.contextHash);
  });
});

describe('assembleContext enriched fields', () => {
  test('returns body text from task note markdown', () => {
    const noteId = `task-body-${randomUUID()}`;
    const filePath = join(tempDir, 'TST-01.01.md');
    writeFileSync(
      filePath,
      [
        '---',
        'title: "Setup CI"',
        'type: task',
        'module: pm',
        'project: TST',
        'workstream: 1',
        'display_id: TST-01.01',
        'number: 1',
        'status: pending',
        'mode: auto',
        'category: implementation',
        'priority: medium',
        '---',
        '',
        '# Setup CI',
        '',
        'Configure GitHub Actions for the main repo.',
        'Need to handle matrix builds for Node 18/20.',
        '',
      ].join('\n')
    );

    db.upsertNote({
      ...makeNote({ id: noteId }),
      filePath,
      title: 'Setup CI',
      type: 'task',
      module: 'pm',
      metadata: taskMeta('TST-01.01', 'TST'),
    });

    const result = assembleContext(db, 'TST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.body).toBeDefined();
    expect(result.data.body).toContain('Configure GitHub Actions');
    expect(result.data.body).toContain('matrix builds');
  });

  test('returns empty string for body when note has no content after heading', () => {
    const noteId = `task-empty-${randomUUID()}`;
    const filePath = join(tempDir, 'TST-01.02.md');
    writeFileSync(
      filePath,
      [
        '---',
        'title: "Empty Task"',
        'type: task',
        'module: pm',
        'display_id: TST-01.02',
        'project: TST',
        'workstream: 1',
        'number: 2',
        'status: pending',
        'mode: auto',
        'category: implementation',
        'priority: medium',
        '---',
        '',
        '# Empty Task',
        '',
      ].join('\n')
    );

    db.upsertNote({
      ...makeNote({ id: noteId }),
      filePath,
      title: 'Empty Task',
      type: 'task',
      module: 'pm',
      metadata: taskMeta('TST-01.02', 'TST'),
    });

    const result = assembleContext(db, 'TST-01.02');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.body).toBe('');
  });

  test('includes workstream info in bundle', () => {
    const wsNoteId = `ws-${randomUUID()}`;
    db.upsertNote({
      ...makeNote({ id: wsNoteId }),
      title: 'Mobile App',
      type: 'workstream',
      module: 'pm',
      metadata: JSON.stringify({
        display_id: 'TST-01',
        project: 'TST',
        number: 1,
        status: 'active',
        title: 'Mobile App',
      }),
    });

    const taskNoteId = `task-ws-${randomUUID()}`;
    const filePath = join(tempDir, 'TST-01.03.md');
    writeFileSync(
      filePath,
      '---\ntitle: "Test"\ntype: task\nmodule: pm\ndisplay_id: TST-01.03\nproject: TST\nworkstream: 1\nnumber: 3\nstatus: pending\nmode: auto\ncategory: implementation\npriority: medium\n---\n\n# Test\n'
    );
    db.upsertNote({
      ...makeNote({ id: taskNoteId }),
      filePath,
      title: 'Test',
      type: 'task',
      module: 'pm',
      metadata: taskMeta('TST-01.03', 'TST'),
    });

    const result = assembleContext(db, 'TST-01.03');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.workstream).toBeDefined();
    expect(result.data.workstream?.displayId).toBe('TST-01');
    expect(result.data.workstream?.title).toBe('Mobile App');
  });
});

describe('isContextStale', () => {
  test('returns false when nothing changed', () => {
    db.upsertNote(
      makeNote({
        id: 'task-001',
        title: 'Build Feature',
        module: 'pm',
        type: 'task',
        metadata: taskMeta('WEB-01-001', 'WEB'),
      })
    );

    const result = assembleContext(db, 'WEB-01-001');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(isContextStale(result.data, db)).toBe(false);
  });

  test('returns true when a decision is added after dispatch', () => {
    db.upsertNote(
      makeNote({
        id: 'task-001',
        title: 'Build Feature',
        module: 'pm',
        type: 'task',
        metadata: taskMeta('WEB-01-001', 'WEB'),
      })
    );

    const result = assembleContext(db, 'WEB-01-001');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    db.upsertNote(
      makeNote({
        id: 'dec-new',
        title: 'New Decision',
        module: 'pm',
        type: 'decision',
        metadata: decisionMeta('WEB-D002', 'WEB', { impacts: ['WEB-01-001'] }),
      })
    );

    expect(isContextStale(result.data, db)).toBe(true);
  });

  test('returns true when dependency status changes', () => {
    db.upsertNote(
      makeNote({
        id: 'task-dep',
        title: 'Dep Task',
        module: 'pm',
        type: 'task',
        metadata: taskMeta('WEB-01-001', 'WEB', { status: 'in-progress' }),
      })
    );

    db.upsertNote(
      makeNote({
        id: 'task-main',
        title: 'Main Task',
        module: 'pm',
        type: 'task',
        metadata: taskMeta('WEB-01-002', 'WEB', { depends_on: ['WEB-01-001'] }),
      })
    );

    const result = assembleContext(db, 'WEB-01-002');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    db.upsertNote(
      makeNote({
        id: 'task-dep',
        title: 'Dep Task',
        module: 'pm',
        type: 'task',
        metadata: taskMeta('WEB-01-001', 'WEB', { status: 'done' }),
      })
    );

    expect(isContextStale(result.data, db)).toBe(true);
  });

  test('returns true when task is deleted', () => {
    db.upsertNote(
      makeNote({
        id: 'task-001',
        title: 'Build Feature',
        module: 'pm',
        type: 'task',
        metadata: taskMeta('WEB-01-001', 'WEB'),
      })
    );

    const result = assembleContext(db, 'WEB-01-001');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    db.deleteNote('task-001');

    expect(isContextStale(result.data, db)).toBe(true);
  });
});
