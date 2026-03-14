import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb, createTestTask } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { renameProjectPrefix } from '../../../src/modules/pm/engine/rename-prefix.js';
import { getPmNotes } from '../../../src/modules/pm/data/queries.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  ({ dbPath, db } = createTestDb());
  notesDir = join(tmpdir(), `pm-rename-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await createProject(db, config, embedder, { name: 'Viking', prefix: 'VNM' });
  await createWorkstream(db, config, embedder, { project: 'VNM', name: 'Core' });
  await createWorkstream(db, config, embedder, { project: 'VNM', name: 'UI' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('renameProjectPrefix', () => {
  it('renames a project with workstreams and tasks', async () => {
    await createTestTask(db, config, embedder, {
      project: 'VNM',
      workstream: 1,
      name: 'Build API',
    });
    await createTestTask(db, config, embedder, {
      project: 'VNM',
      workstream: 2,
      name: 'Build UI',
    });

    const result = await renameProjectPrefix(db, config, embedder, 'VNM', 'BRN');

    expect(result.projectsRenamed).toBe(1);
    expect(result.workstreamsRenamed).toBe(2);
    expect(result.tasksRenamed).toBe(2);
    expect(result.filesRenamed.length).toBe(5);

    // Verify new files exist
    const newProjectFile = join(notesDir, 'modules', 'pm', 'BRN', 'project.md');
    expect(existsSync(newProjectFile)).toBe(true);

    const newTaskFile = join(notesDir, 'modules', 'pm', 'BRN', 'BRN-01.01.md');
    expect(existsSync(newTaskFile)).toBe(true);

    const newWsFile = join(notesDir, 'modules', 'pm', 'BRN', 'BRN-01.md');
    expect(existsSync(newWsFile)).toBe(true);

    // Verify old files do not exist
    const oldProjectFile = join(notesDir, 'modules', 'pm', 'VNM', 'project.md');
    expect(existsSync(oldProjectFile)).toBe(false);

    // Verify frontmatter was rewritten
    const projectContent = readFileSync(newProjectFile, 'utf-8');
    expect(projectContent).toContain('prefix: BRN');
    expect(projectContent).toContain('display_id: BRN');
    expect(projectContent).not.toContain('prefix: VNM');

    const taskContent = readFileSync(newTaskFile, 'utf-8');
    expect(taskContent).toContain('display_id: BRN-01.01');
    expect(taskContent).toContain('project: BRN');
    expect(taskContent).not.toContain('VNM');

    // Verify database was re-indexed
    const newProjects = getPmNotes(db, 'project', { prefix: 'BRN' });
    expect(newProjects.length).toBe(1);

    const oldProjects = getPmNotes(db, 'project', { prefix: 'VNM' });
    expect(oldProjects.length).toBe(0);

    const newTasks = getPmNotes(db, 'task', { project: 'BRN' });
    expect(newTasks.length).toBe(2);
  });

  it('updates depends_on references in task frontmatter', async () => {
    const t1 = await createTestTask(db, config, embedder, {
      project: 'VNM',
      workstream: 1,
      name: 'First task',
    });

    await createTestTask(db, config, embedder, {
      project: 'VNM',
      workstream: 1,
      name: 'Second task',
      dependsOn: [t1.ok ? t1.data.display_id : 'VNM-01.01'],
    });

    const result = await renameProjectPrefix(db, config, embedder, 'VNM', 'BRN');
    expect(result.tasksRenamed).toBe(2);

    const taskFile = join(notesDir, 'modules', 'pm', 'BRN', 'BRN-01.02.md');
    const content = readFileSync(taskFile, 'utf-8');

    // depends_on should reference the new prefix
    expect(content).not.toContain('VNM-01.01');
  });

  it('renames files on disk', async () => {
    await createTestTask(db, config, embedder, {
      project: 'VNM',
      workstream: 1,
      name: 'Test task',
    });

    const oldFile = join(notesDir, 'modules', 'pm', 'VNM', 'VNM-01.01.md');
    expect(existsSync(oldFile)).toBe(true);

    await renameProjectPrefix(db, config, embedder, 'VNM', 'BRN');

    expect(existsSync(oldFile)).toBe(false);
    const newFile = join(notesDir, 'modules', 'pm', 'BRN', 'BRN-01.01.md');
    expect(existsSync(newFile)).toBe(true);
  });

  it('returns preview in dry-run mode without making changes', async () => {
    await createTestTask(db, config, embedder, {
      project: 'VNM',
      workstream: 1,
      name: 'Test task',
    });

    const result = await renameProjectPrefix(db, config, embedder, 'VNM', 'BRN', { dryRun: true });

    expect(result.projectsRenamed).toBe(1);
    expect(result.workstreamsRenamed).toBe(2);
    expect(result.tasksRenamed).toBe(1);
    expect(result.filesRenamed.length).toBeGreaterThan(0);

    // Verify no actual changes were made
    const oldProjectFile = join(notesDir, 'modules', 'pm', 'VNM', 'project.md');
    expect(existsSync(oldProjectFile)).toBe(true);

    const oldProjects = getPmNotes(db, 'project', { prefix: 'VNM' });
    expect(oldProjects.length).toBe(1);

    const newProjects = getPmNotes(db, 'project', { prefix: 'BRN' });
    expect(newProjects.length).toBe(0);
  });

  it('throws when old prefix does not exist', async () => {
    await expect(renameProjectPrefix(db, config, embedder, 'ZZZ', 'BRN')).rejects.toThrow(
      'Project with prefix "ZZZ" not found'
    );
  });

  it('throws when new prefix already exists', async () => {
    await createProject(db, config, embedder, { name: 'Brain', prefix: 'BRN' });

    await expect(renameProjectPrefix(db, config, embedder, 'VNM', 'BRN')).rejects.toThrow(
      'Project with prefix "BRN" already exists'
    );
  });
});
