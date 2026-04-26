import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createTestDb, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { createTask } from '../../../src/modules/pm/data/task-ops.js';
import { dispatchTemplate } from '../../../src/modules/workflow/engine/dispatch.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

async function setupProjectWithTask(opts?: {
  category?: string;
  branchPrefix?: Record<string, string>;
  commands?: Record<string, string | null>;
  path?: string;
  defaultBranch?: string;
  reviewThreshold?: number;
  taskDescription?: string;
}) {
  const projectResult = await createProject(db, config, embedder, {
    name: 'Test SDK',
    prefix: 'SDK',
    path: opts?.path ?? '/repos/sdk',
    defaultBranch: opts?.defaultBranch ?? 'main',
    reviewThreshold: opts?.reviewThreshold ?? 3,
    packageName: '@test/sdk',
    packageManager: 'npm',
    commands: {
      build: opts?.commands?.build ?? 'npm run build',
      test: opts?.commands?.test ?? 'npm test',
      typecheck: opts?.commands?.typecheck ?? 'npm run typecheck',
      lint: opts?.commands?.lint ?? 'npm run lint',
    },
    branchPrefix: opts?.branchPrefix
      ? (opts.branchPrefix as Record<string, string>)
      : { feature: 'feat', bug: 'fix', refactor: 'refactor', infrastructure: 'infra' },
  });
  expect(projectResult.ok).toBe(true);

  const wsResult = await createWorkstream(db, config, embedder, {
    project: 'SDK',
    name: 'Core Features',
  });
  expect(wsResult.ok).toBe(true);

  const taskResult = await createTask(db, config, embedder, {
    project: 'SDK',
    workstream: 1,
    name: 'Add dispatch command',
    category: (opts?.category as 'implementation') ?? 'implementation',
    description:
      opts?.taskDescription ?? 'Implement the workflow dispatch command for template filling.',
  });
  expect(taskResult.ok).toBe(true);

  return taskResult;
}

beforeEach(() => {
  const cloned = createTestDb();
  dbPath = cloned.dbPath;
  db = cloned.db;
  notesDir = join(tmpdir(), `wf-dispatch-${randomUUID()}`);
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

describe('dispatchTemplate', () => {
  it('fills project variables from enriched metadata', async () => {
    await setupProjectWithTask();

    const result = await dispatchTemplate(
      db,
      config,
      embedder,
      'SDK-01.01',
      'implementation-compact'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.variables.TASK_ID).toBe('SDK-01.01');
    expect(result.data.variables.BRAIN_TASK_ID).toBe('SDK-01.01');
    expect(result.data.variables.PROJECT_PREFIX).toBe('SDK');
    expect(result.data.variables.REPO_PATH).toBe('/repos/sdk');
    expect(result.data.variables.BUILD_CMD).toBe('npm run build');
    expect(result.data.variables.TEST_CMD).toBe('npm test');
    expect(result.data.variables.TYPECHECK_CMD).toBe('npm run typecheck');
    expect(result.data.variables.LINT_CMD).toBe('npm run lint');
    expect(result.data.variables.BASE_BRANCH).toBe('main');
    expect(result.data.variables.REVIEW_THRESHOLD).toBe('3');
  });

  it('renders template with substituted variables', async () => {
    await setupProjectWithTask();

    const result = await dispatchTemplate(
      db,
      config,
      embedder,
      'SDK-01.01',
      'implementation-compact'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.rendered).toContain('SDK-01.01');
    expect(result.data.rendered).toContain('/repos/sdk');
    expect(result.data.rendered).toContain('npm test');
    expect(result.data.rendered).not.toContain('{{TASK_ID}}');
    expect(result.data.rendered).not.toContain('{{REPO_PATH}}');
  });

  it('generates branch name from category and title', async () => {
    await setupProjectWithTask({ category: 'implementation' });

    const result = await dispatchTemplate(
      db,
      config,
      embedder,
      'SDK-01.01',
      'implementation-compact'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.variables.BRANCH_NAME).toBe('feat/add-dispatch-command');
  });

  it('generates bug branch name for bug category', async () => {
    await setupProjectWithTask({ category: 'bug' });

    const result = await dispatchTemplate(
      db,
      config,
      embedder,
      'SDK-01.01',
      'implementation-compact'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.variables.BRANCH_NAME).toBe('fix/add-dispatch-command');
  });

  it('uses custom branch prefix from project metadata', async () => {
    await setupProjectWithTask({
      category: 'implementation',
      branchPrefix: {
        feature: 'feature',
        bug: 'bugfix',
        refactor: 'refactor',
        infrastructure: 'infra',
      },
    });

    const result = await dispatchTemplate(
      db,
      config,
      embedder,
      'SDK-01.01',
      'implementation-compact'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.variables.BRANCH_NAME).toBe('feature/add-dispatch-command');
  });

  it('allows branch override via options', async () => {
    await setupProjectWithTask();

    const result = await dispatchTemplate(
      db,
      config,
      embedder,
      'SDK-01.01',
      'implementation-compact',
      { branch: 'custom/my-branch' }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.variables.BRANCH_NAME).toBe('custom/my-branch');
  });

  it('reports unfilled variables', async () => {
    await setupProjectWithTask();

    const result = await dispatchTemplate(
      db,
      config,
      embedder,
      'SDK-01.01',
      'implementation-compact'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Variables like OWNERSHIP_PATTERNS, CONTEXT_FILES etc. are not auto-filled
    expect(result.data.unfilled.length).toBeGreaterThan(0);
    expect(result.data.unfilled).toContain('OWNERSHIP_PATTERNS');
  });

  it('returns NOT_FOUND for unknown template', async () => {
    await setupProjectWithTask();

    const result = await dispatchTemplate(
      db,
      config,
      embedder,
      'SDK-01.01',
      'nonexistent-template'
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
    expect(result.error.message).toContain('not found');
  });

  it('returns NOT_FOUND for unknown task', async () => {
    const result = await dispatchTemplate(
      db,
      config,
      embedder,
      'XXX-99.99',
      'implementation-compact'
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });

  it('fills task description from body', async () => {
    await setupProjectWithTask({
      taskDescription: 'Build the widget factory module with proper error handling.',
    });

    const result = await dispatchTemplate(
      db,
      config,
      embedder,
      'SDK-01.01',
      'implementation-compact'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.variables.IMPLEMENTATION_INSTRUCTIONS).toContain('widget factory');
    expect(result.data.variables.TASK_DESCRIPTION).toContain('widget factory');
  });

  it('sets worktree path from options', async () => {
    await setupProjectWithTask();

    const result = await dispatchTemplate(
      db,
      config,
      embedder,
      'SDK-01.01',
      'implementation-compact',
      { worktree: '/tmp/worktree-1' }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.variables.WORKTREE_PATH).toBe('/tmp/worktree-1');
  });

  it('outputs correct metadata in result', async () => {
    await setupProjectWithTask();

    const result = await dispatchTemplate(
      db,
      config,
      embedder,
      'SDK-01.01',
      'implementation-compact'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.template).toBe('implementation-compact');
    expect(result.data.taskId).toBe('SDK-01.01');
    expect(typeof result.data.rendered).toBe('string');
    expect(result.data.rendered.length).toBeGreaterThan(100);
  });

  it('uses defaults when project has no enriched metadata', async () => {
    // Create minimal project without commands/branch_prefix
    const projectResult = await createProject(db, config, embedder, {
      name: 'Minimal',
      prefix: 'MIN',
    });
    expect(projectResult.ok).toBe(true);

    const wsResult = await createWorkstream(db, config, embedder, {
      project: 'MIN',
      name: 'Work',
    });
    expect(wsResult.ok).toBe(true);

    const taskResult = await createTask(db, config, embedder, {
      project: 'MIN',
      workstream: 1,
      name: 'Do something',
      description: 'Task body here.',
    });
    expect(taskResult.ok).toBe(true);

    const result = await dispatchTemplate(
      db,
      config,
      embedder,
      'MIN-01.01',
      'implementation-compact'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.variables.BUILD_CMD).toBe('N/A');
    expect(result.data.variables.TEST_CMD).toBe('N/A');
    expect(result.data.variables.TYPECHECK_CMD).toBe('N/A');
    expect(result.data.variables.LINT_CMD).toBe('N/A');
    expect(result.data.variables.BASE_BRANCH).toBe('main');
    expect(result.data.variables.REVIEW_THRESHOLD).toBe('5');
  });

  describe('synthetic workflow task IDs', () => {
    it('renders without requiring a real PM task', async () => {
      await setupProjectWithTask();
      const syntheticId = 'workflow:planning:research:abc12345';

      const result = await dispatchTemplate(
        db,
        config,
        embedder,
        syntheticId,
        'planning-research',
        {
          extraVars: { PROJECT_PREFIX: 'SDK', RESEARCH_FOCUS: 'auth design' },
        }
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.variables.TASK_ID).toBe(syntheticId);
      expect(result.data.variables.WORKFLOW_NAME).toBe('planning');
      expect(result.data.variables.STEP_ID).toBe('research');
      expect(result.data.variables.PROJECT_PREFIX).toBe('SDK');
      expect(result.data.variables.REPO_PATH).toBe('/repos/sdk');
      expect(result.data.variables.BRANCH_NAME).toBe('workflow/planning/research');
    });

    it('falls back to defaults when project prefix is unknown', async () => {
      const syntheticId = 'workflow:brainstorming:explore:deadbeef';

      const result = await dispatchTemplate(
        db,
        config,
        embedder,
        syntheticId,
        'brainstorm-explore',
        { extraVars: { PROJECT_PREFIX: 'GHOST' } }
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.variables.BUILD_CMD).toBe('N/A');
      expect(result.data.variables.BASE_BRANCH).toBe('main');
    });

    it('rejects malformed synthetic IDs', async () => {
      const result = await dispatchTemplate(
        db,
        config,
        embedder,
        'workflow:incomplete',
        'planning-research',
        { extraVars: { PROJECT_PREFIX: 'SDK' } }
      );
      expect(result.ok).toBe(false);
    });

    it('lets caller override branch name via opts', async () => {
      await setupProjectWithTask();
      const syntheticId = 'workflow:planning:design:abc12345';

      const result = await dispatchTemplate(db, config, embedder, syntheticId, 'planning-design', {
        extraVars: { PROJECT_PREFIX: 'SDK' },
        branch: 'custom/branch-name',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.variables.BRANCH_NAME).toBe('custom/branch-name');
    });
  });
});
