import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { createTask, updateTaskStatus } from '../../../src/modules/pm/data/task-ops.js';
import { computeWaves } from '../../../src/modules/pm/engine/dependency.js';
import { resolveWorkstreamFilter } from '../../../src/modules/pm/ids.js';
import { resolveWorkstreamByName } from '../../../src/modules/pm/commands/orchestration.js';
import type { TaskStatus } from '../../../src/modules/pm/types.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  dbPath = tmpDbPath('pm-v11-friction2');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-v11-friction2-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath,
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  const proj = await createProject(db, config, embedder, { name: 'Friction2', prefix: 'FR2' });
  if (!proj.ok) throw new Error(proj.error.message);
  const ws = await createWorkstream(db, config, embedder, {
    project: 'FR2',
    name: 'SDK & Protocol',
  });
  if (!ws.ok) throw new Error(ws.error.message);
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('O-158: wave freshness — computeWaves reads fresh data', () => {
  it('waves reflects status changes from current session', async () => {
    // Create two tasks, T2 depends on T1
    await createTask(db, config, embedder, {
      project: 'FR2',
      workstream: 1,
      name: 'First task',
    });
    await createTask(db, config, embedder, {
      project: 'FR2',
      workstream: 1,
      name: 'Second task',
      dependsOn: ['FR2-01.01'],
    });

    // Before completing T1, both should appear in waves
    const wavesBefore = computeWaves(db, 'FR2');
    const allTaskIdsBefore = wavesBefore.flatMap((w) => w.taskIds);
    expect(allTaskIdsBefore).toContain('FR2-01.01');
    expect(allTaskIdsBefore).toContain('FR2-01.02');

    // Complete T1 in the same session (must follow valid transition path)
    await updateTaskStatus(db, config, embedder, 'FR2-01.01', 'claimed' as TaskStatus);
    await updateTaskStatus(db, config, embedder, 'FR2-01.01', 'in-progress' as TaskStatus);
    await updateTaskStatus(db, config, embedder, 'FR2-01.01', 'done' as TaskStatus);

    // After completing, T1 should no longer appear in waves
    const wavesAfter = computeWaves(db, 'FR2');
    const allTaskIdsAfter = wavesAfter.flatMap((w) => w.taskIds);
    expect(allTaskIdsAfter).not.toContain('FR2-01.01');
    expect(allTaskIdsAfter).toContain('FR2-01.02');

    // T2 should now be in wave 0 (no unmet deps)
    const wave0 = wavesAfter.find((w) => w.wave === 0);
    expect(wave0).toBeDefined();
    expect(wave0!.taskIds).toContain('FR2-01.02');
  });
});

describe('O-60: workstream name-based lookup', () => {
  it('resolveWorkstreamFilter still works with numeric input', () => {
    const result = resolveWorkstreamFilter('1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(1);
  });

  it('resolveWorkstreamFilter still works with display ID', () => {
    const result = resolveWorkstreamFilter('FR2-01');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(1);
  });

  it('resolveWorkstreamByName resolves by exact name', () => {
    const result = resolveWorkstreamByName(db, 'FR2', 'SDK & Protocol');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(1);
  });

  it('resolveWorkstreamByName resolves by case-insensitive substring', () => {
    const result = resolveWorkstreamByName(db, 'FR2', 'sdk');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(1);
  });

  it('resolveWorkstreamByName falls back to resolveWorkstreamFilter for numeric', () => {
    const result = resolveWorkstreamByName(db, 'FR2', '1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(1);
  });

  it('resolveWorkstreamByName fails for unknown name', () => {
    const result = resolveWorkstreamByName(db, 'FR2', 'Nonexistent Stream');
    expect(result.ok).toBe(false);
  });
});

describe('O-135/O-145: --project flag on waves and briefing', () => {
  it('wavesCmd definition includes --project option', async () => {
    const { createOrchestrationCommands } =
      await import('../../../src/modules/pm/commands/orchestration.js');
    const cmds = createOrchestrationCommands();
    const wavesCmd = cmds.find((c) => c.name() === 'waves');
    expect(wavesCmd).toBeDefined();

    const projectOpt = wavesCmd!.options.find((o) => o.long === '--project');
    expect(projectOpt).toBeDefined();
  });

  it('briefingCmd definition includes --project option', async () => {
    const { createOrchestrationCommands } =
      await import('../../../src/modules/pm/commands/orchestration.js');
    const cmds = createOrchestrationCommands();
    const briefingCmd = cmds.find((c) => c.name() === 'briefing');
    expect(briefingCmd).toBeDefined();

    const projectOpt = briefingCmd!.options.find((o) => o.long === '--project');
    expect(projectOpt).toBeDefined();
  });
});
