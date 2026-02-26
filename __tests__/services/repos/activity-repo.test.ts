import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'node:fs';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, makeActivity } from '../../helpers.js';

describe('ActivityRepo', () => {
  let db: BrainDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new BrainDB(dbPath);
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  it('round-trips an activity record', () => {
    const activity = makeActivity({
      module: 'pm',
      moduleInstance: 'proj-1',
      activityType: 'task-created',
      actorType: 'user',
      actorId: 'user-1',
      sessionId: 'sess-1',
      noteIds: JSON.stringify(['note-1', 'note-2']),
      metadata: JSON.stringify({ key: 'value' }),
      outcome: 'success',
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T01:00:00Z',
    });

    db.addActivity(activity);
    const retrieved = db.getActivity(activity.id);

    expect(retrieved).toEqual(activity);
  });

  it('returns null for non-existent activity', () => {
    expect(db.getActivity('nonexistent')).toBeNull();
  });

  it('filters activities by module', () => {
    db.addActivity(makeActivity({ module: 'pm' }));
    db.addActivity(makeActivity({ module: 'pm' }));
    db.addActivity(makeActivity({ module: 'other' }));

    const pmActivities = db.getActivities({ module: 'pm' });
    expect(pmActivities).toHaveLength(2);

    const otherActivities = db.getActivities({ module: 'other' });
    expect(otherActivities).toHaveLength(1);
  });

  it('filters activities by module and activityType', () => {
    db.addActivity(makeActivity({ module: 'pm', activityType: 'task-created' }));
    db.addActivity(makeActivity({ module: 'pm', activityType: 'task-completed' }));
    db.addActivity(makeActivity({ module: 'pm', activityType: 'task-created' }));

    const created = db.getActivities({ module: 'pm', activityType: 'task-created' });
    expect(created).toHaveLength(2);
  });

  it('returns all activities when no filter given', () => {
    db.addActivity(makeActivity());
    db.addActivity(makeActivity());
    db.addActivity(makeActivity());

    const all = db.getActivities();
    expect(all).toHaveLength(3);
  });

  it('finds activities by note id', () => {
    db.addActivity(
      makeActivity({ noteIds: JSON.stringify(['note-1', 'note-2']) })
    );
    db.addActivity(
      makeActivity({ noteIds: JSON.stringify(['note-2', 'note-3']) })
    );
    db.addActivity(
      makeActivity({ noteIds: JSON.stringify(['note-4']) })
    );

    const forNote2 = db.getActivitiesByNoteId('note-2');
    expect(forNote2).toHaveLength(2);

    const forNote4 = db.getActivitiesByNoteId('note-4');
    expect(forNote4).toHaveLength(1);

    const forNone = db.getActivitiesByNoteId('note-99');
    expect(forNone).toHaveLength(0);
  });

  it('finds activities by session id', () => {
    db.addActivity(makeActivity({ sessionId: 'sess-1' }));
    db.addActivity(makeActivity({ sessionId: 'sess-1' }));
    db.addActivity(makeActivity({ sessionId: 'sess-2' }));

    const sess1 = db.getActivitiesBySession('sess-1');
    expect(sess1).toHaveLength(2);

    const sess2 = db.getActivitiesBySession('sess-2');
    expect(sess2).toHaveLength(1);
  });
});
