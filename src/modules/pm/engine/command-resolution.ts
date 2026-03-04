import type { BrainDB } from '../../../services/brain-db.js';
import type { Embedder } from '../../../types.js';

export const KNOWN_COMMANDS = [
  'task',
  'workstream',
  'project',
  'waves',
  'next',
  'dispatch',
  'briefing',
  'context',
  'verify',
  'audit',
  'check',
  'onboard',
  'relate',
  'activity',
  'import',
  'capture',
  'setup',
  'decision',
  'prompt',
  'show',
  'claim',
  'orchestrate',
  'list',
];

export const WRITE_OPERATIONS = new Set([
  'add',
  'update',
  'delete',
  'claim',
  'complete',
  'block',
  'done',
  'cancel',
  'start',
  'release',
  'unblock',
  'init',
  'onboard',
  'import',
  'relate',
]);

export const HELP_GROUPS: Record<string, string[]> = {
  Project: ['init', 'list', 'status', 'use', 'show', 'delete'],
  Workstream: ['add', 'list', 'show'],
  Task: ['add', 'list', 'show', 'update', 'claim', 'complete', 'block'],
  Planning: ['waves', 'next', 'dispatch', 'briefing'],
  Context: ['context', 'audit', 'check'],
  Data: ['onboard', 'relate', 'activity', 'import', 'capture'],
};

export function levenshtein(a: string, b: string): number {
  const m: number[][] = [];
  for (let i = 0; i <= a.length; i++) m[i] = [i];
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + cost);
    }
  }
  return m[a.length][b.length];
}

export function fuzzyMatch(input: string, maxDistance = 2): string | null {
  let bestMatch: string | null = null;
  let bestDist = maxDistance + 1;
  for (const cmd of KNOWN_COMMANDS) {
    const dist = levenshtein(input.toLowerCase(), cmd);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = cmd;
    }
  }
  return bestDist <= maxDistance ? bestMatch : null;
}

export interface ResolutionResult {
  tier: 1 | 2 | 3;
  suggestion?: string;
  message: string;
}

function buildHelpMenu(input: string): string {
  const lines = [`Unknown command "${input}". Available commands:\n`];
  for (const [group, cmds] of Object.entries(HELP_GROUPS)) {
    lines.push(`  ${group.padEnd(12)} ${cmds.join(', ')}`);
  }
  return lines.join('\n');
}

export async function resolveUnknownCommand(
  input: string,
  db?: BrainDB,
  embedder?: Embedder,
  fusionWeights?: { bm25: number; vector: number }
): Promise<ResolutionResult> {
  const match = fuzzyMatch(input);
  if (match) {
    return {
      tier: 1,
      suggestion: match,
      message: `Unknown command "${input}". Did you mean "${match}"?`,
    };
  }

  if (db && embedder) {
    try {
      const { search } = await import('../../../services/search.js');
      const results = await search(
        db,
        embedder,
        input,
        { limit: 3, includePm: true },
        fusionWeights ?? { bm25: 0.4, vector: 0.6 }
      );

      const relevant = results.filter((r) => {
        const note = db.getNoteById(r.noteId);
        return note?.type === 'reference' && note?.module === 'pm';
      });

      if (relevant.length > 0) {
        const suggestions = relevant.slice(0, 3).map((r) => {
          const title = r.heading ?? r.filePath;
          const excerpt = (r.excerpt ?? '').slice(0, 80);
          return `  ${title}: ${excerpt}`;
        });
        return {
          tier: 2,
          message: `Unknown command "${input}". Related documentation:\n${suggestions.join('\n')}`,
        };
      }
    } catch {
      // Tier 2 unavailable, fall through to Tier 3
    }
  }

  return {
    tier: 3,
    message: buildHelpMenu(input),
  };
}
