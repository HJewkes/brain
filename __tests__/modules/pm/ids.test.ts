import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'node:fs';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath, makeNote } from '../../helpers.js';
import {
  parseDisplayId,
  formatDisplayId,
  validatePrefix,
  nextWorkstreamNumber,
  nextTaskNumber,
} from '../../../src/modules/pm/ids.js';

describe('parseDisplayId', () => {
  it('parses project-only prefix', () => {
    expect(parseDisplayId('WEB')).toEqual({ prefix: 'WEB' });
  });

  it('parses 2-char prefix', () => {
    expect(parseDisplayId('PM')).toEqual({ prefix: 'PM' });
  });

  it('parses 5-char prefix', () => {
    expect(parseDisplayId('INFRA')).toEqual({ prefix: 'INFRA' });
  });

  it('parses workstream level', () => {
    expect(parseDisplayId('WEB-08')).toEqual({ prefix: 'WEB', workstream: 8 });
  });

  it('parses full task level', () => {
    expect(parseDisplayId('WEB-08.05')).toEqual({ prefix: 'WEB', workstream: 8, task: 5 });
  });

  it('parses zero-padded numbers correctly', () => {
    expect(parseDisplayId('WEB-01.01')).toEqual({ prefix: 'WEB', workstream: 1, task: 1 });
  });

  it('parses double-digit numbers', () => {
    expect(parseDisplayId('WEB-12.34')).toEqual({ prefix: 'WEB', workstream: 12, task: 34 });
  });

  it('parses prefix with digits', () => {
    expect(parseDisplayId('V2-03.01')).toEqual({ prefix: 'V2', workstream: 3, task: 1 });
  });

  it('returns null for lowercase', () => {
    expect(parseDisplayId('web')).toBeNull();
  });

  it('returns null for too-short prefix', () => {
    expect(parseDisplayId('A')).toBeNull();
  });

  it('returns null for too-long prefix', () => {
    expect(parseDisplayId('TOOLONG')).toBeNull();
  });

  it('returns null for special characters', () => {
    expect(parseDisplayId('WEB!')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseDisplayId('')).toBeNull();
  });

  it('returns null for task without workstream', () => {
    expect(parseDisplayId('WEB.05')).toBeNull();
  });

  it('returns null for single-digit workstream (no padding)', () => {
    expect(parseDisplayId('WEB-8')).toBeNull();
  });

  it('returns null for three-digit workstream', () => {
    expect(parseDisplayId('WEB-123')).toBeNull();
  });
});

describe('formatDisplayId', () => {
  it('formats project-only', () => {
    expect(formatDisplayId('WEB')).toBe('WEB');
  });

  it('formats workstream with zero-padding', () => {
    expect(formatDisplayId('WEB', 8)).toBe('WEB-08');
  });

  it('formats full task with zero-padding', () => {
    expect(formatDisplayId('WEB', 8, 5)).toBe('WEB-08.05');
  });

  it('pads single-digit workstream', () => {
    expect(formatDisplayId('PM', 1)).toBe('PM-01');
  });

  it('keeps double-digit numbers as-is', () => {
    expect(formatDisplayId('WEB', 12, 34)).toBe('WEB-12.34');
  });

  it('ignores task when workstream is undefined', () => {
    expect(formatDisplayId('WEB', undefined, 5)).toBe('WEB');
  });
});

describe('validatePrefix', () => {
  it('accepts 2-char uppercase', () => {
    expect(validatePrefix('PM')).toBe(true);
  });

  it('accepts 3-char uppercase', () => {
    expect(validatePrefix('WEB')).toBe(true);
  });

  it('accepts 5-char uppercase', () => {
    expect(validatePrefix('INFRA')).toBe(true);
  });

  it('accepts alphanumeric', () => {
    expect(validatePrefix('V2')).toBe(true);
  });

  it('rejects lowercase', () => {
    expect(validatePrefix('web')).toBe(false);
  });

  it('rejects mixed case', () => {
    expect(validatePrefix('Web')).toBe(false);
  });

  it('rejects too long', () => {
    expect(validatePrefix('TOOLONG')).toBe(false);
  });

  it('rejects single char', () => {
    expect(validatePrefix('A')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validatePrefix('')).toBe(false);
  });

  it('rejects special characters', () => {
    expect(validatePrefix('WE!')).toBe(false);
  });

  it('rejects spaces', () => {
    expect(validatePrefix('A B')).toBe(false);
  });
});

describe('nextWorkstreamNumber', () => {
  let dbPath: string;
  let db: BrainDB;

  beforeEach(() => {
    dbPath = tmpDbPath('pm-ids');
    db = new BrainDB(dbPath);
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {
      // ignore cleanup errors
    }
  });

  it('returns 1 for empty project', () => {
    expect(nextWorkstreamNumber(db, 'WEB')).toBe(1);
  });

  it('returns max+1 for existing workstreams', () => {
    db.upsertNote(
      makeNote({
        id: 'ws-1',
        type: 'workstream',
        module: 'pm',
        metadata: JSON.stringify({
          project: 'WEB',
          number: 1,
          status: 'active',
          display_id: 'WEB-01',
        }),
      })
    );
    db.upsertNote(
      makeNote({
        id: 'ws-3',
        type: 'workstream',
        module: 'pm',
        metadata: JSON.stringify({
          project: 'WEB',
          number: 3,
          status: 'active',
          display_id: 'WEB-03',
        }),
      })
    );

    expect(nextWorkstreamNumber(db, 'WEB')).toBe(4);
  });

  it('scopes to the given prefix', () => {
    db.upsertNote(
      makeNote({
        id: 'ws-other',
        type: 'workstream',
        module: 'pm',
        metadata: JSON.stringify({
          project: 'API',
          number: 5,
          status: 'active',
          display_id: 'API-05',
        }),
      })
    );

    expect(nextWorkstreamNumber(db, 'WEB')).toBe(1);
  });

  it('ignores non-workstream notes', () => {
    db.upsertNote(
      makeNote({
        id: 'task-1',
        type: 'task',
        module: 'pm',
        metadata: JSON.stringify({
          project: 'WEB',
          workstream: 1,
          number: 10,
          status: 'pending',
          display_id: 'WEB-01.10',
        }),
      })
    );

    expect(nextWorkstreamNumber(db, 'WEB')).toBe(1);
  });
});

describe('nextTaskNumber', () => {
  let dbPath: string;
  let db: BrainDB;

  beforeEach(() => {
    dbPath = tmpDbPath('pm-ids');
    db = new BrainDB(dbPath);
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(dbPath);
    } catch {
      // ignore cleanup errors
    }
  });

  it('returns 1 for empty workstream', () => {
    expect(nextTaskNumber(db, 'WEB', 1)).toBe(1);
  });

  it('returns max+1 for existing tasks', () => {
    db.upsertNote(
      makeNote({
        id: 'task-1',
        type: 'task',
        module: 'pm',
        metadata: JSON.stringify({
          project: 'WEB',
          workstream: 1,
          number: 2,
          status: 'pending',
          display_id: 'WEB-01.02',
        }),
      })
    );
    db.upsertNote(
      makeNote({
        id: 'task-2',
        type: 'task',
        module: 'pm',
        metadata: JSON.stringify({
          project: 'WEB',
          workstream: 1,
          number: 5,
          status: 'done',
          display_id: 'WEB-01.05',
        }),
      })
    );

    expect(nextTaskNumber(db, 'WEB', 1)).toBe(6);
  });

  it('scopes to the given workstream', () => {
    db.upsertNote(
      makeNote({
        id: 'task-other',
        type: 'task',
        module: 'pm',
        metadata: JSON.stringify({
          project: 'WEB',
          workstream: 2,
          number: 10,
          status: 'pending',
          display_id: 'WEB-02.10',
        }),
      })
    );

    expect(nextTaskNumber(db, 'WEB', 1)).toBe(1);
  });

  it('scopes to the given prefix', () => {
    db.upsertNote(
      makeNote({
        id: 'task-api',
        type: 'task',
        module: 'pm',
        metadata: JSON.stringify({
          project: 'API',
          workstream: 1,
          number: 7,
          status: 'pending',
          display_id: 'API-01.07',
        }),
      })
    );

    expect(nextTaskNumber(db, 'WEB', 1)).toBe(1);
  });

  it('ignores non-task notes', () => {
    db.upsertNote(
      makeNote({
        id: 'ws-1',
        type: 'workstream',
        module: 'pm',
        metadata: JSON.stringify({
          project: 'WEB',
          number: 8,
          status: 'active',
          display_id: 'WEB-08',
        }),
      })
    );

    expect(nextTaskNumber(db, 'WEB', 8)).toBe(1);
  });
});
