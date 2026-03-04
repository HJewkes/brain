import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, createMockEmbedder } from '../../helpers.js';
import type { BrainConfig } from '../../../src/types.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { getPmNotes, getProjectNotes } from '../../../src/modules/pm/data/queries.js';
import { indexSingleFile } from '../../../src/services/indexing.js';
import { projectDeleteWithActivity } from '../../../src/modules/pm/commands/activity.js';

let db: BrainDB;
let dbPath: string;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(() => {
  dbPath = tmpDbPath('pm-v12-activity');
  db = new BrainDB(dbPath);
  notesDir = join(tmpdir(), `pm-activity-${randomUUID()}`);
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

function buildNoteMarkdown(fields: Record<string, unknown>, body = ''): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---', '', body);
  return lines.join('\n');
}

async function createAndIndexNote(
  fields: Record<string, unknown>,
  filePath: string,
  body = ''
): Promise<string> {
  const dir = join(filePath, '..');
  mkdirSync(dir, { recursive: true });
  const content = buildNoteMarkdown(fields, body);
  writeFileSync(filePath, content, 'utf-8');
  const hash = createHash('sha256').update(content).digest('hex');
  return indexSingleFile(db, embedder, filePath, content, hash, Date.now());
}

describe('activity note type', () => {
  it('activity note can be created and queried by type', async () => {
    const filePath = join(notesDir, 'modules', 'pm', 'TST', 'activity-onboard.md');
    await createAndIndexNote(
      {
        id: 'tst-activity-onboard',
        title: 'TST onboard activity',
        type: 'activity',
        tier: 'slow',
        module: 'pm',
        project: 'TST',
        activity_type: 'onboard',
      },
      filePath,
      '# Onboard Activity'
    );

    const notes = getPmNotes(db, 'activity', { project: 'TST' });
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe('activity');
  });

  it('activity note stores created_notes array in metadata', async () => {
    const filePath = join(notesDir, 'modules', 'pm', 'TST', 'activity-onboard.md');
    await createAndIndexNote(
      {
        id: 'tst-activity-onboard',
        title: 'TST onboard activity',
        type: 'activity',
        tier: 'slow',
        module: 'pm',
        project: 'TST',
        activity_type: 'onboard',
        created_notes: ['tst-project', 'tst-01', 'tst-01-001'],
        created_relations: 5,
      },
      filePath,
      '# Onboard Activity'
    );

    const notes = getPmNotes(db, 'activity', { project: 'TST' });
    expect(notes).toHaveLength(1);
    const meta = JSON.parse(notes[0].metadata!) as Record<string, unknown>;
    expect(meta.created_notes).toEqual(['tst-project', 'tst-01', 'tst-01-001']);
    expect(meta.created_relations).toBe(5);
  });

  it('activity notes filtered by project', async () => {
    const fp1 = join(notesDir, 'modules', 'pm', 'AAA', 'activity-onboard.md');
    const fp2 = join(notesDir, 'modules', 'pm', 'BBB', 'activity-onboard.md');

    await createAndIndexNote(
      {
        id: 'aaa-activity',
        title: 'AAA activity',
        type: 'activity',
        tier: 'slow',
        module: 'pm',
        project: 'AAA',
        activity_type: 'onboard',
      },
      fp1
    );
    await createAndIndexNote(
      {
        id: 'bbb-activity',
        title: 'BBB activity',
        type: 'activity',
        tier: 'slow',
        module: 'pm',
        project: 'BBB',
        activity_type: 'onboard',
      },
      fp2
    );

    const aaaNotes = getPmNotes(db, 'activity', { project: 'AAA' });
    expect(aaaNotes).toHaveLength(1);

    const allNotes = getPmNotes(db, 'activity');
    expect(allNotes).toHaveLength(2);
  });
});

describe('projectDeleteWithActivity', () => {
  async function setupProjectWithNotes(prefix: string): Promise<string[]> {
    await createProject(db, config, embedder, { name: 'Test Project', prefix });

    const taskPath = join(notesDir, 'modules', 'pm', prefix, 'tasks', 'task-001.md');
    const taskId = await createAndIndexNote(
      {
        id: `${prefix.toLowerCase()}-01-001`,
        title: `${prefix}-01.001`,
        type: 'task',
        tier: 'slow',
        module: 'pm',
        project: prefix,
        workstream: 1,
        number: 1,
        display_id: `${prefix}-01.001`,
        status: 'pending',
        mode: 'agent',
        category: 'implementation',
        priority: 'medium',
      },
      taskPath,
      '# Task 1'
    );

    const wsPath = join(notesDir, 'modules', 'pm', prefix, 'ws-01.md');
    const wsId = await createAndIndexNote(
      {
        id: `${prefix.toLowerCase()}-01`,
        title: `Workstream ${prefix}-01`,
        type: 'workstream',
        tier: 'slow',
        module: 'pm',
        project: prefix,
        number: 1,
        display_id: `${prefix}-01`,
        status: 'active',
      },
      wsPath,
      '# Workstream 1'
    );

    const projectNotes = getPmNotes(db, 'project', { prefix });
    const projectNoteId = projectNotes[0].id;

    return [projectNoteId, wsId, taskId];
  }

  it('deletes project and all activity-tracked notes', async () => {
    const noteIds = await setupProjectWithNotes('DEL');

    const activityPath = join(notesDir, 'modules', 'pm', 'DEL', 'activity-onboard.md');
    await createAndIndexNote(
      {
        id: 'del-activity-onboard',
        title: 'DEL onboard activity',
        type: 'activity',
        tier: 'slow',
        module: 'pm',
        project: 'DEL',
        activity_type: 'onboard',
        created_notes: noteIds,
      },
      activityPath,
      '# Onboard Activity'
    );

    const result = await projectDeleteWithActivity(db, config, 'DEL', { confirm: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.deletedCount).toBeGreaterThanOrEqual(3);
    }

    const remaining = getProjectNotes(db, 'DEL');
    expect(remaining).toHaveLength(0);

    const activities = getPmNotes(db, 'activity', { project: 'DEL' });
    expect(activities).toHaveLength(0);
  });

  it('refuses without confirm', async () => {
    await setupProjectWithNotes('REF');

    const result = await projectDeleteWithActivity(db, config, 'REF', { confirm: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('--confirm');
    }

    const remaining = getProjectNotes(db, 'REF');
    expect(remaining.length).toBeGreaterThan(0);
  });

  it('warns about notes not in activity lineage', async () => {
    const noteIds = await setupProjectWithNotes('WRN');

    const activityPath = join(notesDir, 'modules', 'pm', 'WRN', 'activity-onboard.md');
    // Only track the project note, not task/workstream
    await createAndIndexNote(
      {
        id: 'wrn-activity-onboard',
        title: 'WRN onboard activity',
        type: 'activity',
        tier: 'slow',
        module: 'pm',
        project: 'WRN',
        activity_type: 'onboard',
        created_notes: [noteIds[0]],
      },
      activityPath,
      '# Onboard Activity'
    );

    const result = await projectDeleteWithActivity(db, config, 'WRN', { confirm: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.untrackedCount).toBeGreaterThan(0);
    }
  });

  it('deletes all notes when --all is passed regardless of activity tracking', async () => {
    await setupProjectWithNotes('ALL');
    // No activity note created

    const result = await projectDeleteWithActivity(db, config, 'ALL', {
      confirm: true,
      all: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.deletedCount).toBeGreaterThanOrEqual(3);
    }

    const remaining = getProjectNotes(db, 'ALL');
    expect(remaining).toHaveLength(0);
  });

  it('falls back to prefix-based delete when no activity notes exist', async () => {
    await setupProjectWithNotes('FBK');

    const result = await projectDeleteWithActivity(db, config, 'FBK', { confirm: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.deletedCount).toBeGreaterThanOrEqual(3);
    }

    const remaining = getProjectNotes(db, 'FBK');
    expect(remaining).toHaveLength(0);
  });
});
