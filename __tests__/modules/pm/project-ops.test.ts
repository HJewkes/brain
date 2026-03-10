import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, makeNote, createTestDb } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
} from '../../../src/modules/pm/data/project-ops.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(() => {
  ({ dbPath, db } = createTestDb());
  notesDir = join(tmpdir(), `pm-notes-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('createProject', () => {
  it('writes markdown file and indexes into DB', async () => {
    const result = await createProject(db, config, embedder, {
      name: 'Website Redesign',
      prefix: 'WEB',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.prefix).toBe('WEB');
      expect(result.data.display_id).toBe('WEB');
      expect(result.data.status).toBe('active');
    }

    const filePath = join(notesDir, 'modules', 'pm', 'WEB', 'project.md');
    expect(existsSync(filePath)).toBe(true);

    const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'project' });
    expect(noteIds).toHaveLength(1);
  });

  it('stores phase and wip_limit when provided', async () => {
    const result = await createProject(db, config, embedder, {
      name: 'API',
      prefix: 'API',
      phase: 'planning',
      wipLimit: 3,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.phase).toBe('planning');
      expect(result.data.wip_limit).toBe(3);
    }
  });

  it('returns PROJECT_EXISTS for duplicate prefix', async () => {
    await createProject(db, config, embedder, { name: 'First', prefix: 'DUP' });
    const result = await createProject(db, config, embedder, { name: 'Second', prefix: 'DUP' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROJECT_EXISTS');
    }
  });

  it('returns INVALID_INPUT for invalid prefix', async () => {
    const result = await createProject(db, config, embedder, { name: 'Bad', prefix: 'toolong' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('returns INVALID_INPUT for lowercase prefix', async () => {
    const result = await createProject(db, config, embedder, { name: 'Bad', prefix: 'web' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });
});

describe('listProjects', () => {
  it('returns empty array when no projects exist', () => {
    const result = listProjects(db);
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('returns one project', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const result = listProjects(db);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].prefix).toBe('WEB');
    }
  });

  it('returns multiple projects', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });
    await createProject(db, config, embedder, { name: 'API', prefix: 'API' });

    const result = listProjects(db);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      const prefixes = result.data.map((p) => p.prefix).sort();
      expect(prefixes).toEqual(['API', 'WEB']);
    }
  });
});

describe('getProject', () => {
  it('returns project metadata when found', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const result = getProject(db, 'WEB');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.prefix).toBe('WEB');
      expect(result.data.status).toBe('active');
    }
  });

  it('returns NOT_FOUND when project does not exist', () => {
    const result = getProject(db, 'NOPE');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('NOT_FOUND error includes available project names (O-98)', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });
    await createProject(db, config, embedder, { name: 'API', prefix: 'API' });

    const result = getProject(db, 'XYZ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('Available:');
      expect(result.error.message).toContain('WEB');
      expect(result.error.message).toContain('API');
    }
  });

  it('NOT_FOUND error omits available section when no projects exist', () => {
    const result = getProject(db, 'XYZ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain('Available:');
    }
  });
});

describe('updateProject', () => {
  it('updates status', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const result = await updateProject(db, config, embedder, 'WEB', { status: 'paused' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('paused');
    }

    const refreshed = getProject(db, 'WEB');
    expect(refreshed.ok).toBe(true);
    if (refreshed.ok) {
      expect(refreshed.data.status).toBe('paused');
    }
  });

  it('updates phase', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const result = await updateProject(db, config, embedder, 'WEB', { phase: 'development' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.phase).toBe('development');
    }
  });

  it('returns NOT_FOUND for missing project', async () => {
    const result = await updateProject(db, config, embedder, 'NOPE', { status: 'paused' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('deleteProject', () => {
  it('deletes empty project', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const result = await deleteProject(db, config, 'WEB');
    expect(result.ok).toBe(true);

    const check = getProject(db, 'WEB');
    expect(check.ok).toBe(false);

    const filePath = join(notesDir, 'modules', 'pm', 'WEB', 'project.md');
    expect(existsSync(filePath)).toBe(false);
  });

  it('fails with HAS_DEPENDENTS when project has tasks', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    db.upsertNote(
      makeNote({
        id: 'web-01-01',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({ display_id: 'WEB-01.01', project: 'WEB', status: 'pending' }),
      })
    );

    const result = await deleteProject(db, config, 'WEB');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('HAS_DEPENDENTS');
    }
  });

  it('deletes project with tasks when force is true and cleans up files', async () => {
    await createProject(db, config, embedder, { name: 'Web', prefix: 'WEB' });

    const taskFilePath = join(notesDir, 'modules', 'pm', 'WEB', 'task-01.md');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(taskFilePath, '---\nid: web-01-01\n---\n# Task');

    db.upsertNote(
      makeNote({
        id: 'web-01-01',
        filePath: taskFilePath,
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({ display_id: 'WEB-01.01', project: 'WEB', status: 'pending' }),
      })
    );

    const result = await deleteProject(db, config, 'WEB', true);
    expect(result.ok).toBe(true);

    const check = getProject(db, 'WEB');
    expect(check.ok).toBe(false);

    expect(existsSync(taskFilePath)).toBe(false);

    const projectDir = join(notesDir, 'modules', 'pm', 'WEB');
    expect(existsSync(projectDir)).toBe(false);
  });

  it('returns NOT_FOUND for missing project', async () => {
    const result = await deleteProject(db, config, 'NOPE');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('project metadata enrichment', () => {
  it('createProject with all new fields round-trips through getProject', async () => {
    const commands = {
      build: 'npm run build',
      test: 'npm test',
      typecheck: 'npm run typecheck',
      lint: 'npm run lint',
    };
    const branchPrefix = {
      feature: 'feat/',
      bug: 'fix/',
      refactor: 'refactor/',
      infrastructure: 'infra/',
    };
    const notes = { ci: 'Uses GitHub Actions', deploy: 'Auto-deploy on merge' };

    const result = await createProject(db, config, embedder, {
      name: 'SDK',
      prefix: 'SDK',
      path: '/projects/sdk',
      remote: 'git@github.com:org/sdk.git',
      defaultBranch: 'main',
      reviewThreshold: 4,
      packageName: '@voltras/node-sdk',
      packageManager: 'npm',
      commands,
      branchPrefix,
      notes,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.path).toBe('/projects/sdk');
    expect(result.data.remote).toBe('git@github.com:org/sdk.git');
    expect(result.data.default_branch).toBe('main');
    expect(result.data.review_threshold).toBe(4);
    expect(result.data.package_name).toBe('@voltras/node-sdk');
    expect(result.data.package_manager).toBe('npm');
    expect(result.data.commands).toEqual(commands);
    expect(result.data.branch_prefix).toEqual(branchPrefix);
    expect(result.data.notes).toEqual(notes);

    const fetched = getProject(db, 'SDK');
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    expect(fetched.data.path).toBe('/projects/sdk');
    expect(fetched.data.remote).toBe('git@github.com:org/sdk.git');
    expect(fetched.data.default_branch).toBe('main');
    expect(fetched.data.review_threshold).toBe(4);
    expect(fetched.data.package_name).toBe('@voltras/node-sdk');
    expect(fetched.data.package_manager).toBe('npm');
    expect(fetched.data.commands).toEqual(commands);
    expect(fetched.data.branch_prefix).toEqual(branchPrefix);
    expect(fetched.data.notes).toEqual(notes);
  });

  it('createProject with only some new fields (path + commands)', async () => {
    const commands = { build: 'npm run build', test: 'npm test' };

    const result = await createProject(db, config, embedder, {
      name: 'Partial',
      prefix: 'PART',
      path: '/projects/partial',
      commands,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.path).toBe('/projects/partial');
    expect(result.data.commands).toEqual(commands);
    expect(result.data.remote).toBeUndefined();
    expect(result.data.review_threshold).toBeUndefined();
    expect(result.data.branch_prefix).toBeUndefined();
    expect(result.data.notes).toBeUndefined();

    const fetched = getProject(db, 'PART');
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    expect(fetched.data.path).toBe('/projects/partial');
    expect(fetched.data.commands).toEqual(commands);
    expect(fetched.data.remote).toBeUndefined();
  });

  it('updateProject can update review_threshold', async () => {
    await createProject(db, config, embedder, {
      name: 'Threshold',
      prefix: 'THR',
      reviewThreshold: 3,
    });

    const result = await updateProject(db, config, embedder, 'THR', { review_threshold: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.review_threshold).toBe(5);

    const fetched = getProject(db, 'THR');
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    expect(fetched.data.review_threshold).toBe(5);
  });

  it('updateProject can update commands (object field)', async () => {
    await createProject(db, config, embedder, {
      name: 'CmdUpdate',
      prefix: 'CMD',
      commands: { build: 'npm run build' },
    });

    const newCommands = { build: 'pnpm build', test: 'pnpm test', lint: 'pnpm lint' };
    const result = await updateProject(db, config, embedder, 'CMD', { commands: newCommands });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.commands).toEqual(newCommands);

    const fetched = getProject(db, 'CMD');
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    expect(fetched.data.commands).toEqual(newCommands);
  });

  it('updateProject can update path and remote', async () => {
    await createProject(db, config, embedder, {
      name: 'Paths',
      prefix: 'PTH',
    });

    const result = await updateProject(db, config, embedder, 'PTH', {
      path: '/new/path',
      remote: 'git@github.com:org/new.git',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.path).toBe('/new/path');
    expect(result.data.remote).toBe('git@github.com:org/new.git');

    const fetched = getProject(db, 'PTH');
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    expect(fetched.data.path).toBe('/new/path');
    expect(fetched.data.remote).toBe('git@github.com:org/new.git');
  });

  it('listProjects includes new metadata fields', async () => {
    await createProject(db, config, embedder, {
      name: 'Listed',
      prefix: 'LST',
      path: '/projects/listed',
      reviewThreshold: 3,
      packageManager: 'pnpm',
    });

    const result = listProjects(db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].path).toBe('/projects/listed');
    expect(result.data[0].review_threshold).toBe(3);
    expect(result.data[0].package_manager).toBe('pnpm');
  });

  it('backward compat: projects without new fields return undefined', async () => {
    await createProject(db, config, embedder, {
      name: 'Legacy',
      prefix: 'LEG',
    });

    const result = getProject(db, 'LEG');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.prefix).toBe('LEG');
    expect(result.data.status).toBe('active');
    expect(result.data.path).toBeUndefined();
    expect(result.data.remote).toBeUndefined();
    expect(result.data.default_branch).toBeUndefined();
    expect(result.data.review_threshold).toBeUndefined();
    expect(result.data.package_name).toBeUndefined();
    expect(result.data.package_manager).toBeUndefined();
    expect(result.data.commands).toBeUndefined();
    expect(result.data.branch_prefix).toBeUndefined();
    expect(result.data.notes).toBeUndefined();
  });
});
