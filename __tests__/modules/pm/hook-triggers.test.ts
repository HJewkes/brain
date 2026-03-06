import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath } from '../../helpers.js';
import { getActiveProject, setActiveProject } from '../../../src/modules/pm/data/queries.js';

describe('session-start: active project detection', () => {
  let db: BrainDB;

  beforeEach(() => {
    db = new BrainDB(tmpDbPath());
    db.setEmbeddingModel('mock', 384);
  });

  afterEach(() => {
    db.close();
  });

  test('returns active project when set', () => {
    setActiveProject(db, 'MYPROJ');
    const result = getActiveProject(db);
    expect(result).toBe('MYPROJ');
  });

  test('returns null when no active project', () => {
    const result = getActiveProject(db);
    expect(result).toBeNull();
  });

  test('active project can be changed', () => {
    setActiveProject(db, 'PROJ-A');
    expect(getActiveProject(db)).toBe('PROJ-A');

    setActiveProject(db, 'PROJ-B');
    expect(getActiveProject(db)).toBe('PROJ-B');
  });
});
