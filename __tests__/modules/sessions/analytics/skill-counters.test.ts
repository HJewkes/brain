import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from '../../../helpers.js';
import type { BrainDB } from '../../../../src/services/brain-db.js';
import {
  getSkillCounter,
  updateSkillCounter,
  listSkillCounters,
} from '../../../../src/modules/sessions/analytics/skill-counters.js';

let db: BrainDB;

beforeEach(() => {
  ({ db } = createTestDb());
});

afterEach(() => {
  db.close();
});

// AC-10: getSkillCounter returns zero-state for unknown skill
describe('getSkillCounter', () => {
  it('returns zero-state counter for unknown skill', () => {
    const counter = getSkillCounter(db, 'spec');
    expect(counter.skillName).toBe('spec');
    expect(counter.uses).toBe(0);
    expect(counter.successes).toBe(0);
    expect(counter.failures).toBe(0);
    expect(counter.gpaSum).toBe(0);
    expect(counter.gpaCount).toBe(0);
    expect(counter.utilityScore).toBe(0);
    expect(counter.version).toBe(0);
  });

  it('returns stored counter after update', () => {
    const initial = getSkillCounter(db, 'commit');
    updateSkillCounter(db, 'commit', initial.version, { success: true, gpa: 8 });
    const updated = getSkillCounter(db, 'commit');
    expect(updated.skillName).toBe('commit');
    expect(updated.uses).toBe(1);
    expect(updated.successes).toBe(1);
    expect(updated.version).toBe(1);
  });
});

// AC-13: updateSkillCounter increments counters and computes utilityScore
describe('updateSkillCounter', () => {
  it('increments uses and successes on success', () => {
    const v0 = getSkillCounter(db, 'vitest');
    updateSkillCounter(db, 'vitest', v0.version, { success: true, gpa: 9 });
    const v1 = getSkillCounter(db, 'vitest');
    expect(v1.uses).toBe(1);
    expect(v1.successes).toBe(1);
    expect(v1.failures).toBe(0);
    expect(v1.gpaSum).toBe(9);
    expect(v1.gpaCount).toBe(1);
  });

  it('increments uses and failures on failure', () => {
    const v0 = getSkillCounter(db, 'deploy');
    updateSkillCounter(db, 'deploy', v0.version, { success: false, gpa: 4 });
    const v1 = getSkillCounter(db, 'deploy');
    expect(v1.uses).toBe(1);
    expect(v1.successes).toBe(0);
    expect(v1.failures).toBe(1);
  });

  it('computes utilityScore as (successes/uses) * (gpaSum/gpaCount)', () => {
    const v0 = getSkillCounter(db, 'score-skill');
    updateSkillCounter(db, 'score-skill', v0.version, { success: true, gpa: 8 });
    const v1 = getSkillCounter(db, 'score-skill');
    updateSkillCounter(db, 'score-skill', v1.version, { success: true, gpa: 6 });
    const v2 = getSkillCounter(db, 'score-skill');

    // uses=2, successes=2, gpaSum=14, gpaCount=2
    // utilityScore = (2/2) * (14/2) = 7
    expect(v2.uses).toBe(2);
    expect(v2.successes).toBe(2);
    expect(v2.gpaSum).toBe(14);
    expect(v2.gpaCount).toBe(2);
    expect(v2.utilityScore).toBeCloseTo(7.0);
  });

  it('handles null gpa (no GPA available)', () => {
    const v0 = getSkillCounter(db, 'no-gpa-skill');
    updateSkillCounter(db, 'no-gpa-skill', v0.version, { success: true, gpa: null });
    const v1 = getSkillCounter(db, 'no-gpa-skill');
    expect(v1.uses).toBe(1);
    expect(v1.gpaSum).toBe(0);
    expect(v1.gpaCount).toBe(0);
    expect(v1.utilityScore).toBe(0);
  });

  it('increments version on each successful write', () => {
    const v0 = getSkillCounter(db, 'version-skill');
    updateSkillCounter(db, 'version-skill', v0.version, { success: true, gpa: 7 });
    const v1 = getSkillCounter(db, 'version-skill');
    expect(v1.version).toBe(1);
    updateSkillCounter(db, 'version-skill', v1.version, { success: true, gpa: 8 });
    const v2 = getSkillCounter(db, 'version-skill');
    expect(v2.version).toBe(2);
  });
});

// NF-03: optimistic locking — version mismatch logs warning after 3 attempts
describe('updateSkillCounter - optimistic locking', () => {
  it('logs warning and skips when currentVersion mismatches stored version', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Write with version 0, then try to update with stale version 0 again
    const v0 = getSkillCounter(db, 'lock-skill');
    updateSkillCounter(db, 'lock-skill', v0.version, { success: true, gpa: 8 });
    // Now stored version is 1; try to update with stale version 0
    updateSkillCounter(db, 'lock-skill', 0, { success: true, gpa: 9 });

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('version conflict'));

    // Counter should not have changed from v1
    const final = getSkillCounter(db, 'lock-skill');
    expect(final.version).toBe(1);
    expect(final.uses).toBe(1);

    vi.restoreAllMocks();
  });

  it('succeeds when currentVersion matches stored version', () => {
    const v0 = getSkillCounter(db, 'ok-skill');
    updateSkillCounter(db, 'ok-skill', v0.version, { success: true, gpa: 7 });
    const v1 = getSkillCounter(db, 'ok-skill');
    expect(v1.version).toBe(1);
    expect(v1.uses).toBe(1);
  });
});

// listSkillCounters
describe('listSkillCounters', () => {
  it('returns empty array when no counters exist', () => {
    const result = listSkillCounters(db);
    expect(result).toEqual([]);
  });

  it('returns all counters sorted by utilityScore descending', () => {
    const v0a = getSkillCounter(db, 'skill-a');
    updateSkillCounter(db, 'skill-a', v0a.version, { success: true, gpa: 10 });

    const v0b = getSkillCounter(db, 'skill-b');
    updateSkillCounter(db, 'skill-b', v0b.version, { success: false, gpa: 2 });

    const v0c = getSkillCounter(db, 'skill-c');
    updateSkillCounter(db, 'skill-c', v0c.version, { success: true, gpa: 6 });

    const counters = listSkillCounters(db);
    expect(counters).toHaveLength(3);
    // skill-a: utilityScore = (1/1) * (10/1) = 10
    // skill-c: utilityScore = (1/1) * (6/1) = 6
    // skill-b: utilityScore = (0/1) * (2/1) = 0
    expect(counters[0].skillName).toBe('skill-a');
    expect(counters[1].skillName).toBe('skill-c');
    expect(counters[2].skillName).toBe('skill-b');
  });
});
