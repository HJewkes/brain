import type { MemoryEntry, MemoryCategory } from '../types.js';
import type { BrainDB } from './brain-db.js';

export type SnapshotTier = 'compact' | 'standard' | 'full';

export interface ContextSnapshot {
  tier: SnapshotTier;
  stats: { totalNotes: number; totalMemories: number };
  memories: MemoryEntry[];
}

const TIER_LIMITS: Record<SnapshotTier, number> = {
  compact: 10,
  standard: 40,
  full: 200,
};

const COMPACT_CATEGORIES: MemoryCategory[] = ['profile', 'preferences'];

const STANDARD_CATEGORIES: MemoryCategory[] = [
  'profile',
  'preferences',
  'entities',
  'events',
  'patterns',
];

/**
 * Score a memory for priority sorting.
 * Higher = more important. Factors: category weight, recency.
 */
export function scoreMemory(memory: MemoryEntry, now: Date): number {
  const categoryWeights: Record<string, number> = {
    profile: 10,
    preferences: 8,
    patterns: 6,
    entities: 5,
    events: 4,
    skills: 3,
    tools: 3,
    cases: 2,
  };

  const catWeight = categoryWeights[memory.category ?? ''] ?? 1;

  const ageMs = now.getTime() - new Date(memory.createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const recency = Math.exp(-ageDays / 30);

  return catWeight * (0.6 + 0.4 * recency);
}

/**
 * Filter and sort memories by tier priority.
 */
export function prioritizeMemories(
  memories: MemoryEntry[],
  tier: SnapshotTier,
  now: Date = new Date()
): MemoryEntry[] {
  let filtered: MemoryEntry[];

  if (tier === 'compact') {
    filtered = memories.filter(
      (m) => m.category !== null && COMPACT_CATEGORIES.includes(m.category)
    );
    if (filtered.length === 0) {
      filtered = [...memories];
    }
  } else if (tier === 'standard') {
    const preferred = memories.filter(
      (m) => m.category !== null && STANDARD_CATEGORIES.includes(m.category)
    );
    const rest = memories.filter(
      (m) => m.category === null || !STANDARD_CATEGORIES.includes(m.category)
    );
    filtered = [...preferred, ...rest];
  } else {
    filtered = [...memories];
  }

  filtered.sort((a, b) => scoreMemory(b, now) - scoreMemory(a, now));

  return filtered.slice(0, TIER_LIMITS[tier]);
}

/**
 * Generate a context snapshot at the given tier.
 */
export function generateSnapshot(
  db: BrainDB,
  tier: SnapshotTier,
  containerTag?: string
): ContextSnapshot {
  db.forgetExpiredMemories();

  const allMemories = db.getLatestMemories(containerTag);
  const memories = prioritizeMemories(allMemories, tier);

  return {
    tier,
    stats: {
      totalNotes: db.getNoteCount(),
      totalMemories: db.getMemoryCount(),
    },
    memories,
  };
}

/**
 * Format a snapshot as plain text.
 */
export function formatSnapshotText(snapshot: ContextSnapshot): string {
  const { tier, stats, memories } = snapshot;
  const lines: string[] = [];

  lines.push(`Context [${tier}]: ${stats.totalNotes} notes, ${stats.totalMemories} memories`);
  lines.push('');

  if (memories.length === 0) {
    lines.push('No memories available.');
    return lines.join('\n') + '\n';
  }

  if (tier === 'compact') {
    lines.push('Core facts:');
  } else if (tier === 'standard') {
    lines.push('Known facts:');
  } else {
    lines.push('All known facts:');
  }

  for (const m of memories) {
    const tag = m.containerTag !== 'default' ? ` [${m.containerTag}]` : '';
    const cat = m.category ? ` (${m.category})` : '';
    lines.push(`- ${m.memory}${tag}${cat}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Format a snapshot as markdown.
 */
export function formatSnapshotMarkdown(snapshot: ContextSnapshot): string {
  const { tier, stats, memories } = snapshot;
  const lines: string[] = [];

  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  lines.push(`# Context Profile (${tierLabel})`);
  lines.push('');
  lines.push(`Knowledge base: ${stats.totalNotes} notes, ${stats.totalMemories} active memories`);
  lines.push('');

  if (memories.length === 0) {
    lines.push('No memories available.');
    return lines.join('\n') + '\n';
  }

  if (tier === 'full') {
    const grouped = groupByCategory(memories);
    for (const [category, items] of grouped) {
      lines.push(`## ${category}`);
      lines.push('');
      for (const m of items) {
        const tag = m.containerTag !== 'default' ? ` (${m.containerTag})` : '';
        lines.push(`- ${m.memory}${tag}`);
      }
      lines.push('');
    }
  } else {
    const heading = tier === 'compact' ? '## Core Facts' : '## Known Facts';
    lines.push(heading);
    lines.push('');
    for (const m of memories) {
      const tag = m.containerTag !== 'default' ? ` (${m.containerTag})` : '';
      lines.push(`- ${m.memory}${tag}`);
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Format a snapshot as XML.
 */
export function formatSnapshotXml(snapshot: ContextSnapshot): string {
  const { tier, stats, memories } = snapshot;
  const lines: string[] = [];

  lines.push(`<context tier="${tier}">`);
  lines.push(`  <stats notes="${stats.totalNotes}" memories="${stats.totalMemories}" />`);
  lines.push('  <memories>');
  for (const m of memories) {
    const catAttr = m.category ? ` category="${m.category}"` : '';
    lines.push(
      `    <memory container="${m.containerTag}" source="${m.sourceNoteId}"${catAttr}>${m.memory}</memory>`
    );
  }
  lines.push('  </memories>');
  lines.push('</context>');

  return lines.join('\n') + '\n';
}

function groupByCategory(memories: MemoryEntry[]): Map<string, MemoryEntry[]> {
  const map = new Map<string, MemoryEntry[]>();
  for (const m of memories) {
    const key = m.category ?? 'uncategorized';
    const arr = map.get(key) ?? [];
    arr.push(m);
    map.set(key, arr);
  }
  return map;
}
