import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, makeNote } from '../../helpers.js';
import {
  resolveDisplayId,
  getProjectNotes,
  getTasksByStatus,
  getEligibleTasks,
  getActiveProject,
  setActiveProject,
  getPmNotes,
  resolveProject,
} from '../../../src/modules/pm/data/queries.js';

let db: BrainDB;
let dbPath: string;

beforeEach(() => {
  dbPath = tmpDbPath('pm-queries');
  db = new BrainDB(dbPath);
});

afterEach(() => {
  db.close();
});

describe('resolveDisplayId', () => {
  it('returns note ID when display ID exists', () => {
    db.upsertNote(
      makeNote({
        id: 'web-project',
        module: 'pm',
        type: 'project',
        metadata: JSON.stringify({ display_id: 'WEB', prefix: 'WEB', status: 'active' }),
      })
    );

    const result = resolveDisplayId(db, 'WEB');
    expect(result).toEqual({ ok: true, data: 'web-project' });
  });

  it('returns NOT_FOUND when display ID does not exist', () => {
    const result = resolveDisplayId(db, 'NOPE');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns NOT_FOUND when no PM notes exist', () => {
    const result = resolveDisplayId(db, 'WEB');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('brain pm list');
    }
  });

  it('NOT_FOUND includes known project prefixes', () => {
    db.upsertNote(
      makeNote({
        id: 'web-project',
        module: 'pm',
        type: 'project',
        metadata: JSON.stringify({ display_id: 'WEB', prefix: 'WEB', status: 'active' }),
      })
    );
    db.upsertNote(
      makeNote({
        id: 'api-project',
        module: 'pm',
        type: 'project',
        metadata: JSON.stringify({ display_id: 'API', prefix: 'API', status: 'active' }),
      })
    );

    const result = resolveDisplayId(db, 'WRONG-01.01');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toContain('API');
      expect(result.error.message).toContain('WEB');
      expect(result.error.message).toContain('brain pm list');
    }
  });
});

describe('getProjectNotes', () => {
  it('returns notes matching project prefix', () => {
    db.upsertNote(
      makeNote({
        id: 'web-project',
        module: 'pm',
        type: 'project',
        metadata: JSON.stringify({ display_id: 'WEB', prefix: 'WEB', status: 'active' }),
      })
    );
    db.upsertNote(
      makeNote({
        id: 'web-01',
        module: 'pm',
        type: 'workstream',
        metadata: JSON.stringify({
          display_id: 'WEB-01',
          project: 'WEB',
          number: 1,
          status: 'active',
        }),
      })
    );
    db.upsertNote(
      makeNote({
        id: 'api-project',
        module: 'pm',
        type: 'project',
        metadata: JSON.stringify({ display_id: 'API', prefix: 'API', status: 'active' }),
      })
    );

    const notes = getProjectNotes(db, 'WEB');
    expect(notes).toHaveLength(2);
    const ids = notes.map((n) => n.id).sort();
    expect(ids).toEqual(['web-01', 'web-project']);
  });

  it('returns empty array when no notes match', () => {
    const notes = getProjectNotes(db, 'NOPE');
    expect(notes).toEqual([]);
  });
});

describe('getTasksByStatus', () => {
  it('filters tasks by status within a project', () => {
    db.upsertNote(
      makeNote({
        id: 'web-01-01',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({
          display_id: 'WEB-01.01',
          project: 'WEB',
          workstream: 1,
          number: 1,
          status: 'pending',
        }),
      })
    );
    db.upsertNote(
      makeNote({
        id: 'web-01-02',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({
          display_id: 'WEB-01.02',
          project: 'WEB',
          workstream: 1,
          number: 2,
          status: 'done',
        }),
      })
    );
    db.upsertNote(
      makeNote({
        id: 'api-01-01',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({
          display_id: 'API-01.01',
          project: 'API',
          workstream: 1,
          number: 1,
          status: 'pending',
        }),
      })
    );

    const pending = getTasksByStatus(db, 'WEB', 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('web-01-01');

    const done = getTasksByStatus(db, 'WEB', 'done');
    expect(done).toHaveLength(1);
    expect(done[0].id).toBe('web-01-02');
  });

  it('returns empty when no tasks match', () => {
    const tasks = getTasksByStatus(db, 'WEB', 'pending');
    expect(tasks).toEqual([]);
  });
});

describe('getEligibleTasks', () => {
  it('returns pending tasks with no dependencies', () => {
    db.upsertNote(
      makeNote({
        id: 'web-01-01',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({ display_id: 'WEB-01.01', project: 'WEB', status: 'pending' }),
      })
    );

    const eligible = getEligibleTasks(db, 'WEB');
    expect(eligible).toHaveLength(1);
    expect(eligible[0].id).toBe('web-01-01');
  });

  it('returns pending tasks whose dependencies are all done', () => {
    db.upsertNote(
      makeNote({
        id: 'web-01-01',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({ display_id: 'WEB-01.01', project: 'WEB', status: 'done' }),
      })
    );
    db.upsertNote(
      makeNote({
        id: 'web-01-02',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({
          display_id: 'WEB-01.02',
          project: 'WEB',
          status: 'pending',
          depends_on: ['WEB-01.01'],
        }),
      })
    );

    const eligible = getEligibleTasks(db, 'WEB');
    expect(eligible).toHaveLength(1);
    expect(eligible[0].id).toBe('web-01-02');
  });

  it('excludes pending tasks with unfinished dependencies', () => {
    db.upsertNote(
      makeNote({
        id: 'web-01-01',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({ display_id: 'WEB-01.01', project: 'WEB', status: 'pending' }),
      })
    );
    db.upsertNote(
      makeNote({
        id: 'web-01-02',
        module: 'pm',
        type: 'task',
        metadata: JSON.stringify({
          display_id: 'WEB-01.02',
          project: 'WEB',
          status: 'pending',
          depends_on: ['WEB-01.01'],
        }),
      })
    );

    const eligible = getEligibleTasks(db, 'WEB');
    expect(eligible).toHaveLength(1);
    expect(eligible[0].id).toBe('web-01-01');
  });

  it('returns empty when no pending tasks', () => {
    const eligible = getEligibleTasks(db, 'WEB');
    expect(eligible).toEqual([]);
  });
});

describe('getActiveProject / setActiveProject', () => {
  it('returns null when no active project set', () => {
    expect(getActiveProject(db)).toBeNull();
  });

  it('round-trips through db_meta', () => {
    setActiveProject(db, 'WEB');
    expect(getActiveProject(db)).toBe('WEB');
  });

  it('overwrites previous active project', () => {
    setActiveProject(db, 'WEB');
    setActiveProject(db, 'API');
    expect(getActiveProject(db)).toBe('API');
  });
});

describe('resolveProject', () => {
  it('returns explicit project when provided', () => {
    const result = resolveProject(db, 'WEB');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe('WEB');
  });

  it('returns active project when explicit is undefined', () => {
    setActiveProject(db, 'WEB');
    const result = resolveProject(db, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe('WEB');
  });

  it('returns error when neither explicit nor active is set', () => {
    const result = resolveProject(db, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('No projects found');
    }
  });

  it('prefers explicit over active', () => {
    setActiveProject(db, 'WEB');
    const result = resolveProject(db, 'API');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe('API');
  });

  it('uppercases explicit project', () => {
    const result = resolveProject(db, 'web');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe('WEB');
  });
});

describe('getPmNotes', () => {
  it('returns notes filtered by type', () => {
    db.upsertNote(
      makeNote({
        id: 'web-project',
        module: 'pm',
        type: 'project',
        metadata: JSON.stringify({ display_id: 'WEB', prefix: 'WEB', status: 'active' }),
      })
    );
    db.upsertNote(
      makeNote({
        id: 'web-01',
        module: 'pm',
        type: 'workstream',
        metadata: JSON.stringify({
          display_id: 'WEB-01',
          project: 'WEB',
          number: 1,
          status: 'active',
        }),
      })
    );

    const projects = getPmNotes(db, 'project');
    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe('web-project');
  });

  it('applies metadata filters', () => {
    db.upsertNote(
      makeNote({
        id: 'web-project',
        module: 'pm',
        type: 'project',
        metadata: JSON.stringify({ display_id: 'WEB', prefix: 'WEB', status: 'active' }),
      })
    );
    db.upsertNote(
      makeNote({
        id: 'api-project',
        module: 'pm',
        type: 'project',
        metadata: JSON.stringify({ display_id: 'API', prefix: 'API', status: 'paused' }),
      })
    );

    const active = getPmNotes(db, 'project', { status: 'active' });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('web-project');
  });

  it('returns empty for non-existent type', () => {
    const notes = getPmNotes(db, 'nonexistent');
    expect(notes).toEqual([]);
  });
});
