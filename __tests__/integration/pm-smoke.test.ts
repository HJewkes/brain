import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

import { BrainDB } from '../../src/services/brain-db.js';
import { loadModules, runModuleMigrations } from '../../src/modules/loader.js';
import { pmModule } from '../../src/modules/pm/index.js';
import {
  createProject,
  listProjects,
  updateProject,
  deleteProject,
} from '../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../src/modules/pm/data/workstream-ops.js';
import {
  createTask,
  getTask,
  updateTaskStatus,
  listTasks,
  deleteTask,
} from '../../src/modules/pm/data/task-ops.js';
import { createDecision } from '../../src/modules/pm/data/decision-ops.js';
import { writePrompt, detectStalePrompts } from '../../src/modules/pm/data/prompt-ops.js';
import { getPmNotes, getProjectNotes } from '../../src/modules/pm/data/queries.js';
import {
  computeEligible,
  computeWaves,
  detectCycle,
} from '../../src/modules/pm/engine/dependency.js';
import { assembleContext, isContextStale } from '../../src/modules/pm/engine/dispatch.js';
import {
  validateTransition,
  computeVirtualState,
} from '../../src/modules/pm/engine/state-machine.js';
import {
  generateClaim,
  validateClaimToken,
  isClaimActive,
} from '../../src/modules/pm/engine/claims.js';
import { createStandardProject } from '../fixtures/pm-project.js';
import { tmpDbPath, createMockEmbedder, makeNote } from '../helpers.js';
import type { ModuleRegistry } from '../../src/modules/registry.js';
import type { BrainConfig } from '../../src/types.js';

function tmpDir(prefix = 'brain-pm-integ'): string {
  const dir = join(tmpdir(), `${prefix}-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeConfig(notesDir: string, dbPath: string): BrainConfig {
  return {
    notesDir,
    dbPath,
    embedder: 'local' as const,
  };
}

// --- V4: PM Module Smoke Test ---

describe('V4: PM Module Smoke Test', () => {
  let db: BrainDB;
  let registry: ModuleRegistry;
  let notesDir: string;
  let config: BrainConfig;
  const embedder = createMockEmbedder();

  beforeEach(async () => {
    const dbPath = tmpDbPath();
    db = new BrainDB(dbPath);
    db.setEmbeddingModel(embedder.model, embedder.dimensions);
    notesDir = tmpDir();
    config = makeConfig(notesDir, dbPath);
    const result = await loadModules({ modules: [pmModule] });
    registry = result.registry;
    expect(result.errors).toHaveLength(0);
  });

  afterEach(() => {
    db.close();
  });

  it('PM module registers all extension points', () => {
    const mod = registry.getModule('pm');
    expect(mod).toBeDefined();
    expect(mod!.name).toBe('pm');

    const noteTypes = ['project', 'workstream', 'task', 'decision', 'prompt', 'capture'];
    for (const nt of noteTypes) {
      expect(registry.getNoteType(nt)).toBeDefined();
    }

    const relationTypes = ['depends_on', 'blocks', 'impacts', 'supersedes'];
    for (const rt of relationTypes) {
      expect(registry.getRelationType(rt)).toBeDefined();
    }

    expect(registry.getExtractionStrategy('pm')).toBeDefined();
    expect(registry.getFilterForModule('pm')).toBeDefined();
    expect(registry.getFilterForModule('pm')!.visibility).toBe('private');
  });

  it('create project -> note indexed with module=pm, type=project', async () => {
    const result = await createProject(db, config, embedder, {
      name: 'Alpha',
      prefix: 'ALPHA',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const notes = getPmNotes(db, 'project', { prefix: 'ALPHA' });
    expect(notes).toHaveLength(1);
    expect(notes[0].module).toBe('pm');
    expect(notes[0].type).toBe('project');
  });

  it('create workstream -> note indexed with module=pm, type=workstream', async () => {
    await createProject(db, config, embedder, { name: 'Beta', prefix: 'BETA' });
    const result = await createWorkstream(db, config, embedder, {
      project: 'BETA',
      name: 'WS1',
    });
    expect(result.ok).toBe(true);

    const notes = getPmNotes(db, 'workstream', { project: 'BETA' });
    expect(notes).toHaveLength(1);
    expect(notes[0].module).toBe('pm');
    expect(notes[0].type).toBe('workstream');
  });

  it('create task -> note indexed with correct metadata JSON', async () => {
    await createProject(db, config, embedder, { name: 'Gamma', prefix: 'GAM' });
    await createWorkstream(db, config, embedder, { project: 'GAM', name: 'WS1' });
    const result = await createTask(db, config, embedder, {
      project: 'GAM',
      workstream: 1,
      name: 'First Task',
      priority: 'high',
      category: 'testing',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const notes = getPmNotes(db, 'task', { project: 'GAM' });
    expect(notes).toHaveLength(1);
    expect(notes[0].module).toBe('pm');
    expect(notes[0].type).toBe('task');

    const meta = JSON.parse(notes[0].metadata!);
    expect(meta.display_id).toBe('GAM-01.01');
    expect(meta.status).toBe('pending');
    expect(meta.priority).toBe('high');
    expect(meta.category).toBe('testing');
  });

  it('relations stored with module=pm scope', async () => {
    await createProject(db, config, embedder, { name: 'Rel', prefix: 'REL' });
    await createWorkstream(db, config, embedder, { project: 'REL', name: 'WS1' });
    await createTask(db, config, embedder, { project: 'REL', workstream: 1, name: 'T1' });
    await createTask(db, config, embedder, {
      project: 'REL',
      workstream: 1,
      name: 'T2',
      dependsOn: ['REL-01.01'],
    });

    const t2Notes = getPmNotes(db, 'task', { display_id: 'REL-01.02' });
    expect(t2Notes).toHaveLength(1);
    const relations = db.getRelationsFrom(t2Notes[0].id);
    expect(relations.some((r) => r.type === 'depends_on')).toBe(true);
  });

  it('query scoping: getPmNotes returns only PM notes', async () => {
    await createProject(db, config, embedder, { name: 'Scope', prefix: 'SCP' });

    db.upsertNote({
      id: 'non-pm-note',
      filePath: '/test/non-pm.md',
      title: 'Non PM',
      type: 'note',
      tier: 'slow',
      category: null,
      tags: null,
      summary: null,
      confidence: null,
      status: 'current',
      sources: null,
      createdAt: null,
      modifiedAt: null,
      lastReviewed: null,
      reviewInterval: null,
      expires: null,
      metadata: null,
      module: null,
      moduleInstance: null,
      contentDir: null,
    });

    const pmNotes = getPmNotes(db, 'project');
    const pmIds = pmNotes.map((n) => n.id);
    expect(pmIds).not.toContain('non-pm-note');
    expect(pmNotes.length).toBeGreaterThanOrEqual(1);
  });

  it('extraction strategy: shouldExtract returns false for PM notes', () => {
    const strategy = registry.getExtractionStrategy('pm');
    expect(strategy).toBeDefined();
    expect(strategy!.shouldExtract(makeNote({ module: 'pm', type: 'task' }))).toBe(false);
    expect(strategy!.shouldExtract(makeNote({ module: 'pm', type: 'project' }))).toBe(false);
  });

  it('module migration runs successfully', () => {
    // PM migration calls db.exec(), so pass a raw better-sqlite3 instance
    const rawDb = new Database(':memory:');
    rawDb.exec(`CREATE TABLE notes (id TEXT, module TEXT, metadata TEXT)`);

    const applied = runModuleMigrations(registry, rawDb, new Map());
    expect(applied).toEqual([{ module: 'pm', version: 1 }]);

    const rerun = runModuleMigrations(registry, rawDb, new Map([['pm', 1]]));
    expect(rerun).toEqual([]);
    rawDb.close();
  });
});

// --- V5: State Machine + Dependency Engine ---

describe('V5: State Machine + Dependency Engine', () => {
  let db: BrainDB;
  let notesDir: string;
  let config: BrainConfig;
  const embedder = createMockEmbedder();

  beforeEach(async () => {
    const dbPath = tmpDbPath();
    db = new BrainDB(dbPath);
    db.setEmbeddingModel(embedder.model, embedder.dimensions);
    notesDir = tmpDir();
    config = makeConfig(notesDir, dbPath);
    await createStandardProject(db, config, embedder);
  });

  afterEach(() => {
    db.close();
  });

  it('initial state: 01.01 and 02.01 are +READY', () => {
    const t0101 = getTask(db, 'TEST-01.01');
    expect(t0101.ok).toBe(true);
    if (!t0101.ok) return;
    expect(t0101.data.virtualStates).toContain('+READY');
    expect(t0101.data.virtualStates).toContain('+ELIGIBLE');

    const t0201 = getTask(db, 'TEST-02.01');
    expect(t0201.ok).toBe(true);
    if (!t0201.ok) return;
    expect(t0201.data.virtualStates).toContain('+READY');

    const eligible = computeEligible(db, 'TEST');
    expect(eligible).toContain('TEST-01.01');
    expect(eligible).toContain('TEST-02.01');
    expect(eligible).not.toContain('TEST-01.02');
    expect(eligible).not.toContain('TEST-02.02');
  });

  it('complete 01.01 -> 01.02 becomes +READY', async () => {
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done');

    const eligible = computeEligible(db, 'TEST');
    expect(eligible).toContain('TEST-01.02');

    const t0102 = getTask(db, 'TEST-01.02');
    expect(t0102.ok).toBe(true);
    if (!t0102.ok) return;
    expect(t0102.data.virtualStates).toContain('+READY');
  });

  it('complete 02.01 -> 02.02 still blocked (needs 01.01)', async () => {
    await updateTaskStatus(db, config, embedder, 'TEST-02.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TEST-02.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TEST-02.01', 'done');

    const eligible = computeEligible(db, 'TEST');
    expect(eligible).not.toContain('TEST-02.02');

    const t0202 = getTask(db, 'TEST-02.02');
    expect(t0202.ok).toBe(true);
    if (!t0202.ok) return;
    expect(t0202.data.virtualStates).toContain('+BLOCKED');
  });

  it('complete both -> 02.02 becomes +READY (diamond resolved)', async () => {
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done');

    await updateTaskStatus(db, config, embedder, 'TEST-02.01', 'claimed');
    await updateTaskStatus(db, config, embedder, 'TEST-02.01', 'in-progress');
    await updateTaskStatus(db, config, embedder, 'TEST-02.01', 'done');

    const eligible = computeEligible(db, 'TEST');
    expect(eligible).toContain('TEST-02.02');
    expect(eligible).toContain('TEST-01.02');

    const t0202 = getTask(db, 'TEST-02.02');
    expect(t0202.ok).toBe(true);
    if (!t0202.ok) return;
    expect(t0202.data.virtualStates).toContain('+READY');
  });

  it('full lifecycle: pending -> claimed -> in-progress -> done', async () => {
    const t1 = getTask(db, 'TEST-01.01');
    expect(t1.ok && t1.data.status).toBe('pending');

    const r1 = await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'claimed');
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.data.status).toBe('claimed');

    const r2 = await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'in-progress');
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.data.status).toBe('in-progress');

    const r3 = await updateTaskStatus(db, config, embedder, 'TEST-01.01', 'done');
    expect(r3.ok).toBe(true);
    if (r3.ok) expect(r3.data.status).toBe('done');
  });

  it('invalid transition rejected', () => {
    const result = validateTransition('pending', 'done');
    expect(result.ok).toBe(false);

    const result2 = validateTransition('done', 'pending');
    expect(result2.ok).toBe(false);
  });

  it('cycle detection prevents circular dependency', () => {
    // Graph edges (depends_on): 01.02->01.01, 01.03->01.02
    // Adding 01.01 depends_on 01.03 would create: 01.01->01.03->01.02->01.01
    const result = detectCycle(db, 'TEST', 'TEST-01.01', 'TEST-01.03');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CYCLE_DETECTED');
    }

    // Self-dependency
    const selfResult = detectCycle(db, 'TEST', 'TEST-01.01', 'TEST-01.01');
    expect(selfResult.ok).toBe(false);
  });

  it('wave grouping matches expected topology', () => {
    const waves = computeWaves(db, 'TEST');
    expect(waves.length).toBeGreaterThanOrEqual(2);

    // Wave 0: tasks with no active deps (01.01, 02.01)
    expect(waves[0].taskIds).toContain('TEST-01.01');
    expect(waves[0].taskIds).toContain('TEST-02.01');

    // 01.02 and 02.02 should be in a later wave
    const laterTasks = waves.slice(1).flatMap((w) => w.taskIds);
    expect(laterTasks).toContain('TEST-01.02');
    expect(laterTasks).toContain('TEST-02.02');
  });

  it('virtual state computation covers all branches', () => {
    // Pending with no deps -> +READY
    const ready = computeVirtualState({
      status: 'pending',
      hasDependencies: false,
      dependenciesComplete: true,
    });
    expect(ready).toContain('+READY');
    expect(ready).toContain('+ELIGIBLE');

    // Pending with incomplete deps -> +BLOCKED
    const blocked = computeVirtualState({
      status: 'pending',
      hasDependencies: true,
      dependenciesComplete: false,
    });
    expect(blocked).toContain('+BLOCKED');

    // In-progress with stale claim -> +STALE
    const stale = computeVirtualState({
      status: 'in-progress',
      hasDependencies: false,
      dependenciesComplete: true,
      claimedAt: '2020-01-01T00:00:00Z',
    });
    expect(stale).toContain('+STALE');
  });

  it('claims: generate, validate, and check active', () => {
    const claim = generateClaim();
    expect(claim.token).toBeDefined();
    expect(claim.claimedAt).toBeDefined();

    const validResult = validateClaimToken(claim.token, claim.token);
    expect(validResult.ok).toBe(true);

    const invalidResult = validateClaimToken(claim.token, 'wrong-token');
    expect(invalidResult.ok).toBe(false);

    const activeClaim = isClaimActive({
      display_id: 'TEST-01.01',
      project: 'TEST',
      workstream: 1,
      number: 1,
      status: 'claimed',
      mode: 'auto',
      category: 'implementation',
      priority: 'medium',
      claim_token: claim.token,
      claimed_at: claim.claimedAt,
    });
    expect(activeClaim).toBe(true);

    const staleClaim = isClaimActive({
      display_id: 'TEST-01.01',
      project: 'TEST',
      workstream: 1,
      number: 1,
      status: 'claimed',
      mode: 'auto',
      category: 'implementation',
      priority: 'medium',
      claim_token: claim.token,
      claimed_at: '2020-01-01T00:00:00Z',
    });
    expect(staleClaim).toBe(false);
  });
});

// --- V6: CLI Commands (data layer) ---

describe('V6: CLI Commands (data layer)', () => {
  let db: BrainDB;
  let notesDir: string;
  let config: BrainConfig;
  const embedder = createMockEmbedder();

  beforeEach(() => {
    const dbPath = tmpDbPath();
    db = new BrainDB(dbPath);
    db.setEmbeddingModel(embedder.model, embedder.dimensions);
    notesDir = tmpDir();
    config = makeConfig(notesDir, dbPath);
  });

  afterEach(() => {
    db.close();
  });

  it('project CRUD: init -> list -> update -> delete', async () => {
    // Init
    const createResult = await createProject(db, config, embedder, {
      name: 'CRUD Project',
      prefix: 'CRUD',
      phase: 'alpha',
      wipLimit: 3,
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    expect(createResult.data.prefix).toBe('CRUD');
    expect(createResult.data.status).toBe('active');

    // List
    const listResult = listProjects(db);
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.data.some((p) => p.prefix === 'CRUD')).toBe(true);

    // Update
    const updateResult = await updateProject(db, config, embedder, 'CRUD', {
      status: 'paused',
      phase: 'beta',
    });
    expect(updateResult.ok).toBe(true);
    if (!updateResult.ok) return;
    expect(updateResult.data.status).toBe('paused');

    // Delete
    const deleteResult = await deleteProject(db, config, 'CRUD', false);
    expect(deleteResult.ok).toBe(true);

    const postDelete = listProjects(db);
    expect(postDelete.ok).toBe(true);
    if (postDelete.ok) {
      expect(postDelete.data.some((p) => p.prefix === 'CRUD')).toBe(false);
    }
  });

  it('task lifecycle: add -> claim -> start -> complete', async () => {
    await createProject(db, config, embedder, { name: 'TL', prefix: 'TL' });
    await createWorkstream(db, config, embedder, { project: 'TL', name: 'WS1' });

    const taskResult = await createTask(db, config, embedder, {
      project: 'TL',
      workstream: 1,
      name: 'Lifecycle Task',
    });
    expect(taskResult.ok).toBe(true);
    if (!taskResult.ok) return;
    expect(taskResult.data.status).toBe('pending');

    const claimed = await updateTaskStatus(db, config, embedder, 'TL-01.01', 'claimed');
    expect(claimed.ok).toBe(true);
    if (claimed.ok) expect(claimed.data.status).toBe('claimed');

    const started = await updateTaskStatus(db, config, embedder, 'TL-01.01', 'in-progress');
    expect(started.ok).toBe(true);
    if (started.ok) expect(started.data.status).toBe('in-progress');

    const completed = await updateTaskStatus(db, config, embedder, 'TL-01.01', 'done');
    expect(completed.ok).toBe(true);
    if (completed.ok) expect(completed.data.status).toBe('done');

    // Verify via list
    const tasks = listTasks(db, 'TL');
    expect(tasks.ok).toBe(true);
    if (tasks.ok) {
      expect(tasks.data[0].status).toBe('done');
    }
  });

  it('decision + prompt: add decision -> write prompt -> detect staleness', async () => {
    await createProject(db, config, embedder, { name: 'DP', prefix: 'DP' });
    await createWorkstream(db, config, embedder, { project: 'DP', name: 'WS1' });
    await createTask(db, config, embedder, { project: 'DP', workstream: 1, name: 'Task 1' });

    // Write prompt first
    const promptResult = await writePrompt(db, config, embedder, {
      project: 'DP',
      task: 'DP-01.01',
      content: 'Initial prompt content',
    });
    expect(promptResult.ok).toBe(true);
    if (!promptResult.ok) return;
    expect(promptResult.data.prompt_status).toBe('current');

    // Add decision impacting the task (indexed after prompt)
    const decResult = await createDecision(db, config, embedder, {
      project: 'DP',
      name: 'Architecture Decision',
      sourceTask: 'DP-01.01',
      impacts: ['DP-01.01'],
      content: 'Use microservices',
    });
    expect(decResult.ok).toBe(true);
    if (!decResult.ok) return;
    expect(decResult.data.status).toBe('accepted');

    // Detect staleness: prompt was written before the decision
    const staleResult = detectStalePrompts(db, 'DP');
    expect(staleResult.ok).toBe(true);
    if (staleResult.ok) {
      expect(staleResult.data.length).toBeGreaterThanOrEqual(1);
      expect(staleResult.data.some((p) => p.task === 'DP-01.01')).toBe(true);
    }
  });

  it('dispatch returns valid context bundle', async () => {
    await createProject(db, config, embedder, { name: 'Ctx', prefix: 'CTX' });
    await createWorkstream(db, config, embedder, { project: 'CTX', name: 'WS1' });
    await createTask(db, config, embedder, { project: 'CTX', workstream: 1, name: 'Dep Task' });
    await createTask(db, config, embedder, {
      project: 'CTX',
      workstream: 1,
      name: 'Target Task',
      dependsOn: ['CTX-01.01'],
    });

    const bundle = assembleContext(db, 'CTX-01.02');
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;

    expect(bundle.data.task).toBeDefined();
    expect(bundle.data.task.display_id).toBe('CTX-01.02');
    expect(bundle.data.dependencies).toHaveLength(1);
    expect(bundle.data.dependencies[0].displayId).toBe('CTX-01.01');
    expect(bundle.data.contextHash).toBeDefined();
    expect(bundle.data.contextHash.length).toBeGreaterThan(0);

    // Context should not be stale immediately
    expect(isContextStale(bundle.data, db)).toBe(false);
  });

  it('briefing includes all project state', async () => {
    await createProject(db, config, embedder, { name: 'Brief', prefix: 'BRF' });
    await createWorkstream(db, config, embedder, { project: 'BRF', name: 'WS1' });
    await createTask(db, config, embedder, { project: 'BRF', workstream: 1, name: 'T1' });
    await createTask(db, config, embedder, { project: 'BRF', workstream: 1, name: 'T2' });

    // getProjectNotes should include project + workstream + tasks
    const allNotes = getProjectNotes(db, 'BRF');
    expect(allNotes.length).toBeGreaterThanOrEqual(4); // 1 project + 1 workstream + 2 tasks

    const types = allNotes.map((n) => n.type);
    expect(types).toContain('project');
    expect(types).toContain('workstream');
    expect(types).toContain('task');
  });

  it('duplicate project prefix rejected', async () => {
    await createProject(db, config, embedder, { name: 'Dup', prefix: 'DUP' });
    const dup = await createProject(db, config, embedder, { name: 'Dup2', prefix: 'DUP' });
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.error.code).toBe('PROJECT_EXISTS');
    }
  });

  it('invalid transition from data layer rejected', async () => {
    await createProject(db, config, embedder, { name: 'Trans', prefix: 'TRN' });
    await createWorkstream(db, config, embedder, { project: 'TRN', name: 'WS1' });
    await createTask(db, config, embedder, { project: 'TRN', workstream: 1, name: 'T1' });

    const result = await updateTaskStatus(db, config, embedder, 'TRN-01.01', 'done');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TRANSITION');
    }
  });
});

// --- V7: Directory-Backed Tasks ---

describe('V7: Directory-Backed Tasks', () => {
  let db: BrainDB;
  let notesDir: string;
  let config: BrainConfig;
  const embedder = createMockEmbedder();

  beforeEach(() => {
    const dbPath = tmpDbPath();
    db = new BrainDB(dbPath);
    db.setEmbeddingModel(embedder.model, embedder.dimensions);
    notesDir = tmpDir();
    config = makeConfig(notesDir, dbPath);
  });

  afterEach(() => {
    db.close();
  });

  it('task with content_dir -> directory created on disk', async () => {
    await createProject(db, config, embedder, { name: 'Dir', prefix: 'DIR' });
    await createWorkstream(db, config, embedder, { project: 'DIR', name: 'WS1' });

    const result = await createTask(db, config, embedder, {
      project: 'DIR',
      workstream: 1,
      name: 'Dir Task',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const contentDir = join(notesDir, 'modules', 'pm', 'DIR', 'DIR-01.01');
    expect(existsSync(contentDir)).toBe(true);
  });

  it('write summary to content_dir -> FTS indexes it', async () => {
    await createProject(db, config, embedder, { name: 'FTS', prefix: 'FTS' });
    await createWorkstream(db, config, embedder, { project: 'FTS', name: 'WS1' });

    await createTask(db, config, embedder, {
      project: 'FTS',
      workstream: 1,
      name: 'FTS Task',
    });

    const contentDir = join(notesDir, 'modules', 'pm', 'FTS', 'FTS-01.01');
    const uniquePhrase = `xyloquartz-${randomUUID().slice(0, 8)}`;
    writeFileSync(join(contentDir, 'summary.md'), `# Summary\n\n${uniquePhrase}\n`, 'utf-8');

    // Re-index the task note so FTS picks up the content dir
    const taskNotes = getPmNotes(db, 'task', { display_id: 'FTS-01.01' });
    expect(taskNotes).toHaveLength(1);
    const note = taskNotes[0];

    // Manually update the note to have content_dir set, then re-index
    const taskFilePath = note.filePath;
    const { readFileSync: readFs } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const { indexSingleFile } = await import('../../src/services/indexing.js');

    let content = readFs(taskFilePath, 'utf-8');
    // Add content-dir to frontmatter if not already present
    if (!content.includes('content-dir:')) {
      content = content.replace('\n---\n', `\ncontent-dir: ${contentDir}\n---\n`);
      writeFileSync(taskFilePath, content, 'utf-8');
    }

    const hash = createHash('sha256').update(content).digest('hex');
    await indexSingleFile(db, embedder, taskFilePath, content, hash, Date.now());

    const ftsResults = db.searchFTS(uniquePhrase, 10);
    expect(ftsResults.some((r) => r.noteId.includes('fts-01.01'))).toBe(true);
  });

  it('dispatch includes dependency summaries from content_dir', async () => {
    await createProject(db, config, embedder, { name: 'DCtx', prefix: 'DCTX' });
    await createWorkstream(db, config, embedder, { project: 'DCTX', name: 'WS1' });
    await createTask(db, config, embedder, { project: 'DCTX', workstream: 1, name: 'Dep' });

    // Write summary to dep's content_dir
    const depContentDir = join(notesDir, 'modules', 'pm', 'DCTX', 'DCTX-01.01');
    writeFileSync(join(depContentDir, 'summary.md'), 'Dep task completed successfully.', 'utf-8');

    // Update dep note to have content_dir
    const depNotes = getPmNotes(db, 'task', { display_id: 'DCTX-01.01' });
    const depNote = depNotes[0];
    db.upsertNote({
      ...depNote,
      contentDir: depContentDir,
    });

    await createTask(db, config, embedder, {
      project: 'DCTX',
      workstream: 1,
      name: 'Target',
      dependsOn: ['DCTX-01.01'],
    });

    const bundle = assembleContext(db, 'DCTX-01.02');
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;
    expect(bundle.data.dependencies).toHaveLength(1);
    expect(bundle.data.dependencies[0].summary).toBe('Dep task completed successfully.');
  });

  it('delete task -> content_dir cleaned up', async () => {
    await createProject(db, config, embedder, { name: 'Del', prefix: 'DEL' });
    await createWorkstream(db, config, embedder, { project: 'DEL', name: 'WS1' });
    await createTask(db, config, embedder, { project: 'DEL', workstream: 1, name: 'Del Task' });

    const contentDir = join(notesDir, 'modules', 'pm', 'DEL', 'DEL-01.01');
    expect(existsSync(contentDir)).toBe(true);

    // Write a file so we can verify cleanup
    writeFileSync(join(contentDir, 'data.md'), 'test data', 'utf-8');

    const result = await deleteTask(db, config, 'DEL-01.01');
    expect(result.ok).toBe(true);
    expect(existsSync(contentDir)).toBe(false);
  });

  it('task without dependencies has empty dep list in context', async () => {
    await createProject(db, config, embedder, { name: 'Ind', prefix: 'IND' });
    await createWorkstream(db, config, embedder, { project: 'IND', name: 'WS1' });
    await createTask(db, config, embedder, { project: 'IND', workstream: 1, name: 'Solo' });

    const bundle = assembleContext(db, 'IND-01.01');
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;
    expect(bundle.data.dependencies).toHaveLength(0);
    expect(bundle.data.decisions).toHaveLength(0);
  });
});
