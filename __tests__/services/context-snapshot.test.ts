import { describe, it, expect } from 'vitest';
import type { MemoryEntry } from '../../src/types.js';
import {
  scoreMemory,
  prioritizeMemories,
  formatSnapshotText,
  formatSnapshotMarkdown,
  formatSnapshotXml,
} from '../../src/services/context-snapshot.js';
import type { ContextSnapshot } from '../../src/services/context-snapshot.js';

function makeMemory(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'mem-1',
    memory: 'Test fact',
    sourceNoteId: 'note-1',
    sourceChunkId: null,
    containerTag: 'default',
    category: null,
    isLatest: true,
    parentMemoryId: null,
    rootMemoryId: null,
    relationType: null,
    validAt: null,
    invalidAt: null,
    forgetAfter: null,
    isForgotten: false,
    isInference: false,
    createdAt: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

const NOW = new Date('2026-03-13T00:00:00Z');

describe('scoreMemory', () => {
  it('scores profile memories higher than uncategorized', () => {
    const profile = makeMemory({ category: 'profile' });
    const uncategorized = makeMemory({ category: null });
    expect(scoreMemory(profile, NOW)).toBeGreaterThan(scoreMemory(uncategorized, NOW));
  });

  it('scores recent memories higher than old ones', () => {
    const recent = makeMemory({ createdAt: '2026-03-12T00:00:00Z' });
    const old = makeMemory({ createdAt: '2025-01-01T00:00:00Z' });
    expect(scoreMemory(recent, NOW)).toBeGreaterThan(scoreMemory(old, NOW));
  });

  it('weights category more than recency', () => {
    const oldProfile = makeMemory({ category: 'profile', createdAt: '2025-01-01T00:00:00Z' });
    const recentUncategorized = makeMemory({ category: null, createdAt: '2026-03-12T00:00:00Z' });
    expect(scoreMemory(oldProfile, NOW)).toBeGreaterThan(scoreMemory(recentUncategorized, NOW));
  });
});

describe('prioritizeMemories', () => {
  const memories = [
    makeMemory({ id: 'm1', category: 'profile', memory: 'Identity fact' }),
    makeMemory({ id: 'm2', category: 'preferences', memory: 'Pref fact' }),
    makeMemory({ id: 'm3', category: 'entities', memory: 'Entity fact' }),
    makeMemory({ id: 'm4', category: 'events', memory: 'Event fact' }),
    makeMemory({ id: 'm5', category: 'tools', memory: 'Tool fact' }),
    makeMemory({ id: 'm6', category: null, memory: 'Uncategorized fact' }),
  ];

  it('compact tier filters to profile and preferences only', () => {
    const result = prioritizeMemories(memories, 'compact', NOW);
    const categories = result.map((m) => m.category);
    expect(categories).toEqual(['profile', 'preferences']);
  });

  it('compact tier falls back to all memories when no profile/preferences exist', () => {
    const noCore = memories.filter((m) => m.category !== 'profile' && m.category !== 'preferences');
    const result = prioritizeMemories(noCore, 'compact', NOW);
    expect(result.length).toBeGreaterThan(0);
  });

  it('standard tier includes standard categories first', () => {
    const result = prioritizeMemories(memories, 'standard', NOW);
    expect(result.length).toBe(6);
    // profile should be first (highest category weight)
    expect(result[0].category).toBe('profile');
  });

  it('full tier includes all memories', () => {
    const result = prioritizeMemories(memories, 'full', NOW);
    expect(result.length).toBe(6);
  });

  it('compact tier respects limit of 10', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      makeMemory({ id: `m${i}`, category: 'profile', memory: `Fact ${i}` })
    );
    const result = prioritizeMemories(many, 'compact', NOW);
    expect(result.length).toBe(10);
  });

  it('standard tier respects limit of 40', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      makeMemory({ id: `m${i}`, category: 'entities', memory: `Fact ${i}` })
    );
    const result = prioritizeMemories(many, 'standard', NOW);
    expect(result.length).toBe(40);
  });

  it('full tier respects limit of 200', () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      makeMemory({ id: `m${i}`, memory: `Fact ${i}` })
    );
    const result = prioritizeMemories(many, 'full', NOW);
    expect(result.length).toBe(200);
  });

  it('each tier is a superset of the previous', () => {
    const compact = prioritizeMemories(memories, 'compact', NOW);
    const standard = prioritizeMemories(memories, 'standard', NOW);
    const full = prioritizeMemories(memories, 'full', NOW);

    const compactIds = new Set(compact.map((m) => m.id));
    const standardIds = new Set(standard.map((m) => m.id));

    for (const id of compactIds) {
      expect(standardIds.has(id)).toBe(true);
    }
    const fullIds = new Set(full.map((m) => m.id));
    for (const id of standardIds) {
      expect(fullIds.has(id)).toBe(true);
    }
  });
});

describe('formatSnapshotText', () => {
  it('includes tier label and stats', () => {
    const snapshot: ContextSnapshot = {
      tier: 'compact',
      stats: { totalNotes: 10, totalMemories: 50 },
      memories: [makeMemory({ memory: 'A core fact' })],
    };
    const text = formatSnapshotText(snapshot);
    expect(text).toContain('Context [compact]');
    expect(text).toContain('10 notes');
    expect(text).toContain('50 memories');
    expect(text).toContain('Core facts:');
    expect(text).toContain('- A core fact');
  });

  it('uses "Known facts" for standard tier', () => {
    const snapshot: ContextSnapshot = {
      tier: 'standard',
      stats: { totalNotes: 5, totalMemories: 20 },
      memories: [makeMemory()],
    };
    expect(formatSnapshotText(snapshot)).toContain('Known facts:');
  });

  it('uses "All known facts" for full tier', () => {
    const snapshot: ContextSnapshot = {
      tier: 'full',
      stats: { totalNotes: 5, totalMemories: 20 },
      memories: [makeMemory()],
    };
    expect(formatSnapshotText(snapshot)).toContain('All known facts:');
  });

  it('handles empty memories', () => {
    const snapshot: ContextSnapshot = {
      tier: 'compact',
      stats: { totalNotes: 0, totalMemories: 0 },
      memories: [],
    };
    expect(formatSnapshotText(snapshot)).toContain('No memories available.');
  });

  it('shows container tag for non-default containers', () => {
    const snapshot: ContextSnapshot = {
      tier: 'compact',
      stats: { totalNotes: 1, totalMemories: 1 },
      memories: [makeMemory({ containerTag: 'work' })],
    };
    expect(formatSnapshotText(snapshot)).toContain('[work]');
  });

  it('shows category annotation', () => {
    const snapshot: ContextSnapshot = {
      tier: 'compact',
      stats: { totalNotes: 1, totalMemories: 1 },
      memories: [makeMemory({ category: 'profile' })],
    };
    expect(formatSnapshotText(snapshot)).toContain('(profile)');
  });
});

describe('formatSnapshotMarkdown', () => {
  it('includes tier in heading', () => {
    const snapshot: ContextSnapshot = {
      tier: 'standard',
      stats: { totalNotes: 5, totalMemories: 10 },
      memories: [makeMemory()],
    };
    const md = formatSnapshotMarkdown(snapshot);
    expect(md).toContain('# Context Profile (Standard)');
    expect(md).toContain('## Known Facts');
  });

  it('groups by category in full tier', () => {
    const snapshot: ContextSnapshot = {
      tier: 'full',
      stats: { totalNotes: 5, totalMemories: 10 },
      memories: [
        makeMemory({ category: 'profile', memory: 'I am X' }),
        makeMemory({ id: 'm2', category: 'tools', memory: 'I use Y' }),
      ],
    };
    const md = formatSnapshotMarkdown(snapshot);
    expect(md).toContain('## profile');
    expect(md).toContain('## tools');
  });
});

describe('formatSnapshotXml', () => {
  it('includes tier attribute and category', () => {
    const snapshot: ContextSnapshot = {
      tier: 'compact',
      stats: { totalNotes: 3, totalMemories: 7 },
      memories: [makeMemory({ category: 'profile', memory: 'Identity' })],
    };
    const xml = formatSnapshotXml(snapshot);
    expect(xml).toContain('tier="compact"');
    expect(xml).toContain('notes="3"');
    expect(xml).toContain('category="profile"');
    expect(xml).toContain('>Identity</memory>');
  });

  it('omits category attribute when null', () => {
    const snapshot: ContextSnapshot = {
      tier: 'standard',
      stats: { totalNotes: 1, totalMemories: 1 },
      memories: [makeMemory({ category: null })],
    };
    const xml = formatSnapshotXml(snapshot);
    expect(xml).not.toContain('category=');
  });
});
