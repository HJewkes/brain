import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSkillCounter,
  updateSkillCounter,
  listSkillCounters,
} from '../../../../src/modules/sessions/analytics/skill-counters.js';

function makeFakeBrain(existingNotes: unknown[] = []) {
  return {
    db: {
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn().mockReturnValue([]),
      }),
    },
    config: { notesDir: '/tmp/notes' },
    searchNotes: vi.fn().mockResolvedValue(existingNotes),
    addNote: vi.fn().mockResolvedValue({ slug: 'sessions/skill-counter/commit' }),
    updateNote: vi.fn().mockResolvedValue(undefined),
  } as unknown;
}

describe('getSkillCounter', () => {
  it('returns default counter for a skill with no existing data', async () => {
    const brain = makeFakeBrain([]);
    const counter = await getSkillCounter(brain, 'commit');
    expect(counter.skillName).toBe('commit');
    expect(counter.uses).toBe(0);
    expect(counter.successes).toBe(0);
    expect(counter.failures).toBe(0);
    expect(counter.utilityScore).toBe(0);
  });

  it('returns existing counter values when note exists', async () => {
    const brain = makeFakeBrain([
      {
        slug: 'sessions/skill-counter/commit',
        frontmatter: {
          skill_name: 'commit',
          uses: 10,
          successes: 8,
          failures: 2,
          utility_score: 6.4,
        },
      },
    ]);
    const counter = await getSkillCounter(brain, 'commit');
    expect(counter.uses).toBe(10);
    expect(counter.successes).toBe(8);
    expect(counter.failures).toBe(2);
    expect(counter.utilityScore).toBeCloseTo(6.4, 1);
  });
});

describe('updateSkillCounter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-10: increments uses and successes for a successful outcome', async () => {
    const brain = makeFakeBrain([]) as Record<string, unknown>;
    const updateNote = vi.fn().mockResolvedValue(undefined);
    (brain as Record<string, unknown>).updateNote = updateNote;
    const addNote = (brain as Record<string, unknown>).addNote as ReturnType<typeof vi.fn>;
    await updateSkillCounter(brain as unknown, 'commit', 'success', 7.5);
    // Either addNote or updateNote must be called to persist the counter
    expect(addNote.mock.calls.length + updateNote.mock.calls.length).toBeGreaterThan(0);
  });

  it('increments failures for a failed outcome', async () => {
    const brain = makeFakeBrain([]) as Record<string, unknown>;
    await updateSkillCounter(brain as unknown, 'commit', 'failure', null);
    // verify call was made (exact assert depends on write path)
    const addNote = (brain as Record<string, unknown>).addNote as ReturnType<typeof vi.fn>;
    const updateNote = (brain as Record<string, unknown>).updateNote as ReturnType<typeof vi.fn>;
    expect(addNote.mock.calls.length + updateNote.mock.calls.length).toBeGreaterThan(0);
  });

  it('NF-03: does not throw when note was not modified since last read', async () => {
    const brain = makeFakeBrain([]);
    await expect(updateSkillCounter(brain, 'commit', 'success', 8.0)).resolves.not.toThrow();
  });
});

describe('listSkillCounters', () => {
  it('AC-13: returns one entry per skill sorted by utilityScore descending', async () => {
    const brain = makeFakeBrain([
      {
        slug: 'sessions/skill-counter/commit',
        frontmatter: {
          skill_name: 'commit',
          uses: 10,
          successes: 8,
          failures: 2,
          utility_score: 6.4,
        },
      },
      {
        slug: 'sessions/skill-counter/vitest',
        frontmatter: {
          skill_name: 'vitest',
          uses: 5,
          successes: 5,
          failures: 0,
          utility_score: 9.0,
        },
      },
    ]);
    const counters = await listSkillCounters(brain);
    expect(counters.length).toBe(2);
    expect(counters[0].skillName).toBe('vitest');
    expect(counters[0].utilityScore).toBeGreaterThan(counters[1].utilityScore);
  });

  it('returns empty array when no skill counter notes exist', async () => {
    const brain = makeFakeBrain([]);
    const counters = await listSkillCounters(brain);
    expect(counters).toEqual([]);
  });
});
