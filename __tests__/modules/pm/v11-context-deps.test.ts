import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, makeNote } from '../../helpers.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { assembleContext } from '../../../src/modules/pm/engine/dispatch.js';

let db: BrainDB;
let dbPath: string;
let tempDir: string;

function taskMeta(displayId: string, project: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    display_id: displayId,
    project,
    workstream: 1,
    number: parseInt(displayId.split('.').pop()!, 10) || 1,
    status: 'pending',
    mode: 'auto',
    category: 'implementation',
    priority: 'medium',
    title: overrides.title ?? 'Test Task',
    ...overrides,
  });
}

function writeTaskFile(dir: string, displayId: string, title: string): string {
  const filePath = join(dir, `${displayId}.md`);
  writeFileSync(
    filePath,
    [
      '---',
      `title: "${title}"`,
      'type: task',
      'module: pm',
      '---',
      '',
      `# ${title}`,
      '',
      'Task body.',
    ].join('\n')
  );
  return filePath;
}

beforeEach(() => {
  dbPath = tmpDbPath('pm-context-deps');
  db = new BrainDB(dbPath);
  tempDir = join(tmpdir(), `brain-ctx-deps-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('O-149: assembleContext dependencies from relations', () => {
  test('returns upstream dependencies from relations table', () => {
    const depFilePath = writeTaskFile(tempDir, 'TST-01.01', 'Upstream Task');
    db.upsertNote({
      ...makeNote({ id: 'dep-task-001' }),
      filePath: depFilePath,
      title: 'Upstream Task',
      type: 'task',
      module: 'pm',
      metadata: taskMeta('TST-01.01', 'TST', { title: 'Upstream Task', status: 'done' }),
    });

    const mainFilePath = writeTaskFile(tempDir, 'TST-01.02', 'Main Task');
    db.upsertNote({
      ...makeNote({ id: 'main-task-001' }),
      filePath: mainFilePath,
      title: 'Main Task',
      type: 'task',
      module: 'pm',
      metadata: taskMeta('TST-01.02', 'TST', { title: 'Main Task' }),
    });

    // Create a depends_on relation: main depends on dep
    db.upsertRelations('main-task-001', [
      { sourceId: 'main-task-001', targetId: 'dep-task-001', type: 'depends_on' },
    ]);

    const result = assembleContext(db, 'TST-01.02');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.dependencies.length).toBeGreaterThanOrEqual(1);
    const upstream = result.data.dependencies.find((d) => d.displayId === 'TST-01.01');
    expect(upstream).toBeDefined();
    expect(upstream!.status).toBe('done');
    expect(upstream!.direction).toBe('upstream');
  });

  test('returns downstream dependents from relations table', () => {
    const mainFilePath = writeTaskFile(tempDir, 'TST-01.01', 'Main Task');
    db.upsertNote({
      ...makeNote({ id: 'main-task-001' }),
      filePath: mainFilePath,
      title: 'Main Task',
      type: 'task',
      module: 'pm',
      metadata: taskMeta('TST-01.01', 'TST', { title: 'Main Task' }),
    });

    const downFilePath = writeTaskFile(tempDir, 'TST-01.02', 'Downstream Task');
    db.upsertNote({
      ...makeNote({ id: 'down-task-001' }),
      filePath: downFilePath,
      title: 'Downstream Task',
      type: 'task',
      module: 'pm',
      metadata: taskMeta('TST-01.02', 'TST', { title: 'Downstream Task' }),
    });

    // Downstream depends on main
    db.upsertRelations('down-task-001', [
      { sourceId: 'down-task-001', targetId: 'main-task-001', type: 'depends_on' },
    ]);

    const result = assembleContext(db, 'TST-01.01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const downstream = result.data.dependencies.find((d) => d.displayId === 'TST-01.02');
    expect(downstream).toBeDefined();
    expect(downstream!.direction).toBe('downstream');
  });

  test('deps=false omits dependencies', () => {
    const depFilePath = writeTaskFile(tempDir, 'TST-01.01', 'Dep Task');
    db.upsertNote({
      ...makeNote({ id: 'dep-task-001' }),
      filePath: depFilePath,
      title: 'Dep Task',
      type: 'task',
      module: 'pm',
      metadata: taskMeta('TST-01.01', 'TST', { title: 'Dep Task' }),
    });

    const mainFilePath = writeTaskFile(tempDir, 'TST-01.02', 'Main Task');
    db.upsertNote({
      ...makeNote({ id: 'main-task-001' }),
      filePath: mainFilePath,
      title: 'Main Task',
      type: 'task',
      module: 'pm',
      metadata: taskMeta('TST-01.02', 'TST', { title: 'Main Task' }),
    });

    db.upsertRelations('main-task-001', [
      { sourceId: 'main-task-001', targetId: 'dep-task-001', type: 'depends_on' },
    ]);

    const result = assembleContext(db, 'TST-01.02', { deps: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.dependencies).toEqual([]);
  });
});
