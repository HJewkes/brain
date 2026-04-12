import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { updateTasksFromSessionOutcome } from '../../../src/modules/sessions/ingestion/task-updater.js';
import type { LinkResult } from '../../../src/modules/sessions/ingestion/linker.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

function insertTaskNote(
  database: BrainDB,
  displayId: string,
  project: string,
  status = 'in-progress'
): void {
  const noteId = `${displayId.toLowerCase()}-task`;
  database.upsertNote({
    id: noteId,
    filePath: join(notesDir, 'modules', 'pm', project, `${displayId}.md`),
    title: `Task ${displayId}`,
    type: 'task',
    tier: 'slow',
    category: null,
    tags: null,
    summary: `Test task ${displayId}`,
    confidence: null,
    status: 'current',
    sources: null,
    createdAt: '2026-04-01',
    modifiedAt: '2026-04-01',
    lastReviewed: null,
    reviewInterval: null,
    expires: null,
    metadata: JSON.stringify({
      display_id: displayId,
      project,
      workstream: 45,
      number: 5,
      status,
      mode: 'auto',
      category: 'implementation',
      priority: 'medium',
    }),
    module: 'pm',
    moduleInstance: null,
    contentDir: null,
    l0Abstract: null,
    l1Overview: null,
  });
}

beforeEach(() => {
  ({ dbPath, db } = createTestDb());
  notesDir = join(tmpdir(), `task-updater-${randomUUID()}`);
  mkdirSync(join(notesDir, 'modules', 'pm', 'VNM'), { recursive: true });
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

describe('updateTasksFromSessionOutcome', () => {
  it('creates context note for task worked but not completed with success outcome', async () => {
    // Arrange
    insertTaskNote(db, 'VNM-45.05', 'VNM', 'in-progress');
    const links: LinkResult = {
      tasksWorked: ['VNM-45.05'],
      tasksCompleted: [],
      notesCreated: [],
      commits: [],
    };

    // Act
    const result = await updateTasksFromSessionOutcome(db, config, embedder, links, {
      sessionId: 'sess-abc123',
      outcome: 'success',
      summary: 'Implemented task updater feature',
      errorRate: 0.02,
    });

    // Assert
    expect(result.updatedTasks).toEqual(['VNM-45.05']);
    expect(result.contextNotes).toHaveLength(1);

    const activityNotes = db.getModuleNoteIds({ module: 'pm', type: 'activity' });
    expect(activityNotes.length).toBeGreaterThanOrEqual(1);
  });

  it('creates context note for abandoned session outcome', async () => {
    // Arrange
    insertTaskNote(db, 'VNM-45.05', 'VNM', 'in-progress');
    const links: LinkResult = {
      tasksWorked: ['VNM-45.05'],
      tasksCompleted: [],
      notesCreated: [],
      commits: [],
    };

    // Act
    const result = await updateTasksFromSessionOutcome(db, config, embedder, links, {
      sessionId: 'sess-abandoned',
      outcome: 'abandoned',
      summary: 'Session ran into errors',
      errorRate: 0.35,
    });

    // Assert
    expect(result.updatedTasks).toEqual(['VNM-45.05']);
    expect(result.contextNotes).toHaveLength(1);
  });

  it('creates context note for partial session outcome with error info', async () => {
    // Arrange
    insertTaskNote(db, 'VNM-45.05', 'VNM', 'in-progress');
    const links: LinkResult = {
      tasksWorked: ['VNM-45.05'],
      tasksCompleted: [],
      notesCreated: [],
      commits: [],
    };

    // Act
    const result = await updateTasksFromSessionOutcome(db, config, embedder, links, {
      sessionId: 'sess-partial',
      outcome: 'partial',
      errorRate: 0.15,
    });

    // Assert
    expect(result.updatedTasks).toEqual(['VNM-45.05']);
    expect(result.contextNotes).toHaveLength(1);
  });

  it('skips tasks that were both worked on and completed', async () => {
    // Arrange
    insertTaskNote(db, 'VNM-45.05', 'VNM', 'done');
    const links: LinkResult = {
      tasksWorked: ['VNM-45.05'],
      tasksCompleted: ['VNM-45.05'],
      notesCreated: [],
      commits: [],
    };

    // Act
    const result = await updateTasksFromSessionOutcome(db, config, embedder, links, {
      sessionId: 'sess-complete',
      outcome: 'success',
      errorRate: 0.01,
    });

    // Assert
    expect(result.updatedTasks).toEqual([]);
    expect(result.contextNotes).toHaveLength(0);
  });

  it('skips unknown outcome sessions', async () => {
    // Arrange
    insertTaskNote(db, 'VNM-45.05', 'VNM', 'in-progress');
    const links: LinkResult = {
      tasksWorked: ['VNM-45.05'],
      tasksCompleted: [],
      notesCreated: [],
      commits: [],
    };

    // Act
    const result = await updateTasksFromSessionOutcome(db, config, embedder, links, {
      sessionId: 'sess-unknown',
      outcome: 'unknown',
      errorRate: 0,
    });

    // Assert
    expect(result.updatedTasks).toEqual([]);
    expect(result.contextNotes).toHaveLength(0);
  });

  it('returns empty when no tasks were worked on', async () => {
    // Arrange
    const links: LinkResult = {
      tasksWorked: [],
      tasksCompleted: [],
      notesCreated: [],
      commits: [],
    };

    // Act
    const result = await updateTasksFromSessionOutcome(db, config, embedder, links, {
      sessionId: 'sess-empty',
      outcome: 'success',
      errorRate: 0,
    });

    // Assert
    expect(result.updatedTasks).toEqual([]);
    expect(result.contextNotes).toHaveLength(0);
  });

  it('handles multiple tasks with mixed completion', async () => {
    // Arrange
    insertTaskNote(db, 'VNM-45.05', 'VNM', 'in-progress');
    insertTaskNote(db, 'VNM-45.06', 'VNM', 'done');
    const links: LinkResult = {
      tasksWorked: ['VNM-45.05', 'VNM-45.06'],
      tasksCompleted: ['VNM-45.06'],
      notesCreated: [],
      commits: [],
    };

    // Act
    const result = await updateTasksFromSessionOutcome(db, config, embedder, links, {
      sessionId: 'sess-mixed',
      outcome: 'success',
      summary: 'Completed one task, worked on another',
      errorRate: 0.03,
    });

    // Assert
    expect(result.updatedTasks).toEqual(['VNM-45.05']);
    expect(result.contextNotes).toHaveLength(1);
  });
});
