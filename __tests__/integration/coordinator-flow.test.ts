import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../src/services/brain-db.js';
import { loadModules } from '../../src/modules/loader.js';
import { createMockEmbedder, createTestDb, createTestTask } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';
import { pmModule } from '../../src/modules/pm/index.js';
import { createProject } from '../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../src/modules/pm/data/workstream-ops.js';
import { getTask, updateTaskStatus } from '../../src/modules/pm/data/task-ops.js';
import { computeEligible } from '../../src/modules/pm/engine/dependency.js';
import { renderCoordinatorPrompt } from '../../src/modules/agents/coordinator.js';
import { renderTemplateFile } from '../../src/modules/agents/template-renderer.js';
import { buildAgentDispatchContext } from '../../src/modules/agents/dispatch-context.js';
import { buildTemplateVariables } from '../../src/modules/pm/commands/orchestration.js';
import {
  parseCompletionMessage,
  handleCompletion,
  isCompletionMessage,
} from '../../src/modules/agents/completion-protocol.js';
import type { TaskStatus } from '../../src/modules/pm/types.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  ({ db } = createTestDb());
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `coordinator-flow-${randomUUID()}`);
  mkdirSync(join(notesDir, 'templates', 'agents'), { recursive: true });
  config = {
    notesDir,
    dbPath: '',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await loadModules({ modules: [pmModule] });

  // Create project with dependency chain: T1 (wave 0) -> T2 (wave 1) -> T3 (wave 2)
  await createProject(db, config, embedder, { name: 'Coord Test', prefix: 'CT' });
  await createWorkstream(db, config, embedder, { project: 'CT', name: 'Main' });

  await createTestTask(db, config, embedder, {
    project: 'CT',
    workstream: 1,
    name: 'Foundation task',
    description: 'Set up src/services/base.ts foundation',
  });
  await createTestTask(db, config, embedder, {
    project: 'CT',
    workstream: 1,
    name: 'Build on foundation',
    description: 'Extend src/services/feature.ts using base',
    dependsOn: ['CT-01.01'],
  });
  await createTestTask(db, config, embedder, {
    project: 'CT',
    workstream: 1,
    name: 'Final integration',
    description: 'Integrate src/services/integration.ts',
    dependsOn: ['CT-01.02'],
  });

  // Write templates
  writeFileSync(
    join(notesDir, 'templates', 'agents', 'coordinator.md'),
    '# Coordinator\nTeam: {TEAM_NAME}\nDir: {PROJECT_DIR}\nCLI: {BRAIN_CLI}'
  );
  writeFileSync(
    join(notesDir, 'templates', 'agents', 'worker.md'),
    [
      '# Worker for {TASK_ID}',
      'Title: {TITLE}',
      'Description: {DESCRIPTION}',
      'Dependencies: {DEPENDENCIES}',
      'Wave: {WAVE_INFO}',
      'Files: {FILE_OWNERSHIP}',
      'Read-only: {READ_ONLY_FILES}',
      'Token: {CLAIM_TOKEN}',
      'Team: {TEAM_NAME}',
      'Dir: {PROJECT_DIR}',
      'CWD: {CWD}',
      'Verify: {VERIFY_COMMANDS}',
      'Decisions: {DECISIONS}',
      'Model: {MODEL}',
      'Agent: {AGENT_TYPE}',
      'Isolation: {ISOLATION}',
      'VerifyFlag: {VERIFY}',
      'CLI: {BRAIN_CLI}',
    ].join('\n')
  );
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('Coordinator Flow E2E', () => {
  it('only CT-01.01 is eligible initially', () => {
    const eligible = computeEligible(db, 'CT');
    expect(eligible).toEqual(['CT-01.01']);
  });

  it('renders coordinator prompt from template', () => {
    const result = renderCoordinatorPrompt({
      projectDir: notesDir,
      teamName: 'burndown-ct',
      wipLimit: 3,
      templateName: 'coordinator',
    });

    expect(result).not.toBeNull();
    expect(result!.prompt).toContain('burndown-ct');
    expect(result!.prompt).toContain(notesDir);
    expect(result!.teamName).toBe('burndown-ct');
  });

  it('renders worker prompt for first eligible task', () => {
    const dispatch = buildAgentDispatchContext(db, 'CT-01.01', {
      projectDir: notesDir,
    });
    expect(dispatch).not.toBeNull();

    const vars = buildTemplateVariables(dispatch!, notesDir, {
      teamName: 'burndown-ct',
      claimToken: 'tok-123',
    });

    const rendered = renderTemplateFile(notesDir, 'worker', vars);

    expect(rendered).toContain('CT-01.01');
    expect(rendered).toContain('Foundation task');
    expect(rendered).toContain('burndown-ct');
    expect(rendered).toContain('tok-123');
    expect(rendered).not.toMatch(/\{[A-Z][A-Z0-9_]*\}/);
  });

  it('completes full claim -> render -> done -> wave-advance cycle', async () => {
    // Wave 0: CT-01.01 is eligible
    let eligible = computeEligible(db, 'CT');
    expect(eligible).toEqual(['CT-01.01']);

    // Claim and start CT-01.01
    await updateTaskStatus(db, config, embedder, 'CT-01.01', 'claimed' as TaskStatus);
    await updateTaskStatus(db, config, embedder, 'CT-01.01', 'in-progress' as TaskStatus);

    const task1 = getTask(db, 'CT-01.01');
    expect(task1.ok).toBe(true);
    expect(task1.data.status).toBe('in-progress');

    // Simulate worker completion
    const msg = parseCompletionMessage('DONE CT-01.01 Completed foundation setup');
    expect(msg).not.toBeNull();
    expect(msg!.status).toBe('done');
    expect(msg!.taskId).toBe('CT-01.01');

    const result = await handleCompletion(db, config, embedder, msg!);
    expect(result.status).toBe('done');
    expect(result.newlyEligible).toContain('CT-01.02');

    // Wave 1: CT-01.02 is now eligible
    eligible = computeEligible(db, 'CT');
    expect(eligible).toEqual(['CT-01.02']);

    // Complete CT-01.02
    await updateTaskStatus(db, config, embedder, 'CT-01.02', 'claimed' as TaskStatus);
    await updateTaskStatus(db, config, embedder, 'CT-01.02', 'in-progress' as TaskStatus);
    const msg2 = parseCompletionMessage('DONE CT-01.02 Built feature layer');
    const result2 = await handleCompletion(db, config, embedder, msg2!);
    expect(result2.newlyEligible).toContain('CT-01.03');

    // Wave 2: CT-01.03 is now eligible
    eligible = computeEligible(db, 'CT');
    expect(eligible).toEqual(['CT-01.03']);

    // Complete CT-01.03
    await updateTaskStatus(db, config, embedder, 'CT-01.03', 'claimed' as TaskStatus);
    await updateTaskStatus(db, config, embedder, 'CT-01.03', 'in-progress' as TaskStatus);
    const msg3 = parseCompletionMessage('DONE CT-01.03 Integration complete');
    const result3 = await handleCompletion(db, config, embedder, msg3!);
    expect(result3.newlyEligible).toEqual([]);

    // All done, nothing eligible
    eligible = computeEligible(db, 'CT');
    expect(eligible).toEqual([]);

    // Verify all tasks are done
    for (const id of ['CT-01.01', 'CT-01.02', 'CT-01.03']) {
      const t = getTask(db, id);
      expect(t.ok).toBe(true);
      expect(t.data.status).toBe('done');
    }
  });

  it('handles FAILED message by blocking the task', async () => {
    await updateTaskStatus(db, config, embedder, 'CT-01.01', 'claimed' as TaskStatus);
    await updateTaskStatus(db, config, embedder, 'CT-01.01', 'in-progress' as TaskStatus);

    const msg = parseCompletionMessage('FAILED CT-01.01 Merge conflict in base.ts');
    expect(msg).not.toBeNull();
    expect(msg!.status).toBe('failed');

    const result = await handleCompletion(db, config, embedder, msg!);
    expect(result.status).toBe('failed');
    expect(result.newlyEligible).toEqual([]);

    const task = getTask(db, 'CT-01.01');
    expect(task.ok).toBe(true);
    expect(task.data.status).toBe('blocked');

    // CT-01.02 should NOT be eligible (CT-01.01 is blocked, not done)
    const eligible = computeEligible(db, 'CT');
    expect(eligible).toEqual([]);
  });

  it('validates completion message parsing edge cases', () => {
    expect(isCompletionMessage('DONE CT-01.01 summary')).toBe(true);
    expect(isCompletionMessage('FAILED CT-01.01 reason')).toBe(true);
    expect(isCompletionMessage('Hello coordinator')).toBe(false);
    expect(isCompletionMessage('The task is DONE')).toBe(false);

    const noTask = parseCompletionMessage('DONE');
    expect(noTask).toBeNull();

    const multiline = parseCompletionMessage('DONE CT-01.01 Line 1\nLine 2');
    expect(multiline).not.toBeNull();
    expect(multiline!.summary).toBe('Line 1\nLine 2');
  });

  it('renders worker prompts for parallel wave tasks', async () => {
    // Add a second task with no deps (wave 0 peer of CT-01.01)
    await createTestTask(db, config, embedder, {
      project: 'CT',
      workstream: 1,
      name: 'Parallel task',
      description: 'Work on src/services/parallel.ts independently',
    });

    const eligible = computeEligible(db, 'CT');
    expect(eligible).toContain('CT-01.01');
    expect(eligible).toContain('CT-01.04');

    // Both should render successfully
    for (const taskId of ['CT-01.01', 'CT-01.04']) {
      const dispatch = buildAgentDispatchContext(db, taskId, { projectDir: notesDir });
      expect(dispatch).not.toBeNull();

      const vars = buildTemplateVariables(dispatch!, notesDir, {
        teamName: 'burndown-ct',
        claimToken: `tok-${taskId}`,
      });
      const rendered = renderTemplateFile(notesDir, 'worker', vars);
      expect(rendered).toContain(taskId);
      expect(rendered).not.toMatch(/\{[A-Z][A-Z0-9_]*\}/);
    }
  });
});
