import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { loadModules } from '../../../src/modules/loader.js';
import { tmpDbPath, createMockEmbedder, makeActivity } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { pmModule } from '../../../src/modules/pm/index.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import { listTasks } from '../../../src/modules/pm/data/task-ops.js';
import {
  createCapture,
  listCaptures,
  processCapture,
} from '../../../src/modules/pm/data/capture-ops.js';
import { estimateCost } from '../../../src/modules/pm/data/cost.js';
import { executeImport, type ImportProjectDef } from '../../../src/modules/pm/commands/import.js';
import { formatError, type PmError } from '../../../src/modules/pm/errors.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  db = new BrainDB(tmpDbPath('pm-wave8'));
  db.setEmbeddingModel(embedder.model, embedder.dimensions);
  notesDir = join(tmpdir(), `pm-wave8-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });
  config = {
    notesDir,
    dbPath: '',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  await loadModules({ modules: [pmModule] });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

describe('Wave 8: Capture + Audit + Import', () => {
  // --- Capture ---

  it('capture creates a PM note', async () => {
    const result = await createCapture(db, config, embedder, {
      content: 'Add caching layer to search',
      source: 'cli',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.noteId).toBeTruthy();
    expect(result.data.processed).toBe(false);
    expect(result.data.content).toBe('Add caching layer to search');
  });

  it('inbox shows unprocessed captures', async () => {
    await createCapture(db, config, embedder, { content: 'Capture A' });
    await createCapture(db, config, embedder, { content: 'Capture B' });

    const result = listCaptures(db, { processed: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);
    expect(result.data.every((c) => !c.processed)).toBe(true);
  });

  it('process capture creates task and marks processed', async () => {
    await createProject(db, config, embedder, { name: 'Cap Test', prefix: 'CAP' });
    await createWorkstream(db, config, embedder, { project: 'CAP', name: 'Main' });

    const cap = await createCapture(db, config, embedder, {
      content: 'Build notification service',
      project: 'CAP',
    });
    expect(cap.ok).toBe(true);
    if (!cap.ok) return;

    const taskResult = await processCapture(db, config, embedder, cap.data.noteId, {
      project: 'CAP',
      workstream: 1,
      name: 'Build notification service',
      description: 'Build the notification service for the application.',
    });

    expect(taskResult.ok).toBe(true);
    if (!taskResult.ok) return;
    expect(taskResult.data.display_id).toBe('CAP-01.01');

    const inbox = listCaptures(db, { processed: false });
    expect(inbox.ok).toBe(true);
    if (inbox.ok) {
      expect(inbox.data).toHaveLength(0);
    }
  });

  // --- Audit ---

  it('audit summary shows completion stats from activities', async () => {
    db.addActivity(
      makeActivity({
        module: 'pm',
        moduleInstance: 'TEST',
        activityType: 'task_execution',
        outcome: 'success',
        startedAt: '2026-02-01T10:00:00Z',
        completedAt: '2026-02-01T10:05:00Z',
      })
    );
    db.addActivity(
      makeActivity({
        module: 'pm',
        moduleInstance: 'TEST',
        activityType: 'task_execution',
        outcome: 'failure',
        startedAt: '2026-02-01T11:00:00Z',
        completedAt: '2026-02-01T11:01:00Z',
      })
    );

    const activities = db.getActivities({ module: 'pm' });
    expect(activities).toHaveLength(2);

    const completed = activities.filter((a) => a.outcome === 'success').length;
    const failed = activities.filter((a) => a.outcome === 'failure').length;
    expect(completed).toBe(1);
    expect(failed).toBe(1);
  });

  it('audit cost estimates from token data', () => {
    db.addActivity(
      makeActivity({
        module: 'pm',
        moduleInstance: 'TEST',
        activityType: 'task_execution',
        metadata: JSON.stringify({ tokens: 5000, model: 'claude-sonnet' }),
      })
    );
    db.addActivity(
      makeActivity({
        module: 'pm',
        moduleInstance: 'TEST',
        activityType: 'task_execution',
        metadata: JSON.stringify({ tokens: 10000, model: 'claude-opus' }),
      })
    );

    const activities = db.getActivities({ module: 'pm' });
    const cost = estimateCost(activities);

    expect(cost.totalTokens).toBe(15000);
    expect(cost.estimatedCost).toBeGreaterThan(0);
    expect(cost.byModel['claude-sonnet']).toBeDefined();
    expect(cost.byModel['claude-opus']).toBeDefined();
    expect(cost.byModel['claude-sonnet'].tokens).toBe(5000);
    expect(cost.byModel['claude-opus'].tokens).toBe(10000);
  });

  it('audit executions lists recent activities', () => {
    const activity = makeActivity({
      module: 'pm',
      moduleInstance: 'TEST',
      activityType: 'task_execution',
      outcome: 'success',
      startedAt: '2026-02-20T08:00:00Z',
      completedAt: '2026-02-20T08:10:00Z',
    });
    db.addActivity(activity);

    const activities = db.getActivities({ module: 'pm' });
    expect(activities).toHaveLength(1);
    expect(activities[0].id).toBe(activity.id);
    expect(activities[0].activityType).toBe('task_execution');
    expect(activities[0].outcome).toBe('success');
  });

  it('audit enrich adds telemetry to activity', () => {
    const activity = makeActivity({
      module: 'pm',
      moduleInstance: 'TEST',
      activityType: 'task_execution',
    });
    db.addActivity(activity);

    const fetched = db.getActivity(activity.id);
    expect(fetched).toBeDefined();

    const enrichedMeta = { tokens: 3000, model: 'claude-haiku' };
    const updated = { ...fetched!, metadata: JSON.stringify(enrichedMeta) };
    db.addActivity(updated);

    const enriched = db.getActivity(activity.id);
    expect(enriched).toBeDefined();
    const meta = JSON.parse(enriched!.metadata!) as Record<string, unknown>;
    expect(meta.tokens).toBe(3000);
    expect(meta.model).toBe('claude-haiku');
  });

  // --- Import ---

  it('import from JSON creates project with tasks', async () => {
    const def: ImportProjectDef = {
      name: 'Imported Project',
      prefix: 'IMP',
      workstreams: [
        {
          name: 'Core',
          tasks: [
            { name: 'Setup', description: 'Set up project infrastructure.', priority: 'high' },
            { name: 'Implement', description: 'Implement core features.' },
            { name: 'Test', description: 'Run test suite.', priority: 'low' },
          ],
        },
      ],
    };

    const result = await executeImport(db, config, embedder, def);

    expect(result.errors).toHaveLength(0);
    expect(result.created).toHaveLength(5);

    const tasks = listTasks(db, 'IMP');
    expect(tasks.ok).toBe(true);
    if (tasks.ok) {
      expect(tasks.data).toHaveLength(3);
      expect(tasks.data[0].priority).toBe('high');
    }
  });

  it('import from JSON with dependencies creates relations', async () => {
    const def: ImportProjectDef = {
      name: 'Dep Import',
      prefix: 'DIM',
      workstreams: [
        {
          name: 'Main',
          tasks: [
            { name: 'Foundation', description: 'Lay the foundation.' },
            {
              name: 'Build on foundation',
              description: 'Build on the foundation.',
              depends_on: ['DIM-01.01'],
            },
            {
              name: 'Final step',
              description: 'Complete the final step.',
              depends_on: ['DIM-01.01', 'DIM-01.02'],
            },
          ],
        },
      ],
    };

    const result = await executeImport(db, config, embedder, def);

    expect(result.errors).toHaveLength(0);
    expect(result.created).toHaveLength(5);

    const noteIds = db.getModuleNoteIds({ module: 'pm', type: 'task' });
    const notes = db.getNotesByIds(noteIds);

    let finalNoteId: string | undefined;
    let foundationNoteId: string | undefined;
    let buildNoteId: string | undefined;

    for (const [, note] of notes) {
      const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
      if (meta.display_id === 'DIM-01.03') finalNoteId = note.id;
      if (meta.display_id === 'DIM-01.01') foundationNoteId = note.id;
      if (meta.display_id === 'DIM-01.02') buildNoteId = note.id;
    }

    expect(finalNoteId).toBeDefined();
    const relations = db.getRelationsFrom(finalNoteId!);
    const depTargets = relations.filter((r) => r.type === 'depends_on').map((r) => r.targetId);
    expect(depTargets).toContain(foundationNoteId);
    expect(depTargets).toContain(buildNoteId);
  });

  // --- Error coverage ---

  it('every error code has correct structure in --json mode', () => {
    const errorCodes = [
      'PROJECT_EXISTS',
      'NOT_FOUND',
      'INVALID_TRANSITION',
      'INVALID_INPUT',
      'HAS_DEPENDENTS',
      'WIP_LIMIT',
    ] as const;

    for (const code of errorCodes) {
      const error: PmError = {
        error: true,
        code,
        message: `Test error for ${code}`,
      };

      const jsonOutput = formatError(error, true);
      const parsed = JSON.parse(jsonOutput) as Record<string, unknown>;

      expect(parsed.error).toBe(true);
      expect(parsed.code).toBe(code);
      expect(typeof parsed.message).toBe('string');
    }
  });

  it('error with details includes details in JSON output', () => {
    const error: PmError = {
      error: true,
      code: 'HAS_DEPENDENTS',
      message: 'Has dependents',
      details: { count: 3 },
    };

    const jsonOutput = formatError(error, true);
    const parsed = JSON.parse(jsonOutput) as Record<string, unknown>;
    expect(parsed.details).toEqual({ count: 3 });
  });

  it('non-json error format is human readable', () => {
    const error: PmError = {
      error: true,
      code: 'NOT_FOUND',
      message: 'Task "X" not found',
    };

    const output = formatError(error, false);
    expect(output).toBe('Error [NOT_FOUND]: Task "X" not found');
  });
});
