import { describe, it, expect } from 'vitest';
import {
  buildOwnershipManifest,
  checkConflicts,
  getOwner,
  getOwners,
  getAgentOwnershipSummary,
  formatOwnershipBrief,
  matchPattern,
} from '../../../src/modules/agents/file-ownership.js';

describe('matchPattern', () => {
  it('matches exact file paths', () => {
    expect(matchPattern('src/types.ts', 'src/types.ts')).toBe(true);
    expect(matchPattern('src/types.ts', 'src/utils.ts')).toBe(false);
  });

  it('matches directory prefix patterns', () => {
    expect(matchPattern('src/services/search.ts', 'src/services/')).toBe(true);
    expect(matchPattern('src/commands/init.ts', 'src/services/')).toBe(false);
  });

  it('matches single-segment wildcards', () => {
    expect(matchPattern('src/types.ts', 'src/*.ts')).toBe(true);
    expect(matchPattern('src/deep/types.ts', 'src/*.ts')).toBe(false);
  });

  it('matches double-star glob patterns', () => {
    expect(matchPattern('src/services/repos/note-repo.ts', 'src/**/*.ts')).toBe(true);
    expect(matchPattern('src/cli.ts', 'src/**/*.ts')).toBe(true);
    expect(matchPattern('__tests__/foo.ts', 'src/**/*.ts')).toBe(false);
  });
});

describe('buildOwnershipManifest', () => {
  it('creates a manifest from assignments', () => {
    const manifest = buildOwnershipManifest([
      { agentId: 'agent-alpha', patterns: ['src/services/'] },
      { agentId: 'agent-beta', patterns: ['src/commands/'] },
    ]);

    expect(manifest.rules).toHaveLength(2);
    expect(manifest.rules[0].agentId).toBe('agent-alpha');
    expect(manifest.rules[0].patterns).toEqual(['src/services/']);
  });

  it('handles empty assignments', () => {
    const manifest = buildOwnershipManifest([]);
    expect(manifest.rules).toHaveLength(0);
  });
});

describe('checkConflicts', () => {
  it('returns empty when no overlapping patterns', () => {
    const manifest = buildOwnershipManifest([
      { agentId: 'agent-alpha', patterns: ['src/services/'] },
      { agentId: 'agent-beta', patterns: ['src/commands/'] },
    ]);

    expect(checkConflicts(manifest)).toEqual([]);
  });

  it('detects when two agents claim the same pattern', () => {
    const manifest = buildOwnershipManifest([
      { agentId: 'agent-alpha', patterns: ['src/types.ts', 'src/services/'] },
      { agentId: 'agent-beta', patterns: ['src/types.ts', 'src/commands/'] },
    ]);

    const conflicts = checkConflicts(manifest);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].pattern).toBe('src/types.ts');
    expect(conflicts[0].agents).toEqual(['agent-alpha', 'agent-beta']);
  });

  it('detects multiple conflicts', () => {
    const manifest = buildOwnershipManifest([
      { agentId: 'a1', patterns: ['src/types.ts', 'src/utils.ts'] },
      { agentId: 'a2', patterns: ['src/types.ts', 'src/utils.ts'] },
    ]);

    const conflicts = checkConflicts(manifest);
    expect(conflicts).toHaveLength(2);
  });

  it('detects three-way conflicts', () => {
    const manifest = buildOwnershipManifest([
      { agentId: 'a1', patterns: ['src/types.ts'] },
      { agentId: 'a2', patterns: ['src/types.ts'] },
      { agentId: 'a3', patterns: ['src/types.ts'] },
    ]);

    const conflicts = checkConflicts(manifest);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].agents).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('getOwner', () => {
  const manifest = buildOwnershipManifest([
    { agentId: 'agent-alpha', patterns: ['src/services/**/*.ts'] },
    { agentId: 'agent-beta', patterns: ['src/commands/**/*.ts'] },
  ]);

  it('returns the owning agent for a matching file', () => {
    expect(getOwner(manifest, 'src/services/search.ts')).toBe('agent-alpha');
    expect(getOwner(manifest, 'src/commands/init.ts')).toBe('agent-beta');
  });

  it('returns null for unowned files', () => {
    expect(getOwner(manifest, 'src/types.ts')).toBeNull();
    expect(getOwner(manifest, 'README.md')).toBeNull();
  });

  it('resolves exact file ownership', () => {
    const m = buildOwnershipManifest([{ agentId: 'agent-alpha', patterns: ['src/types.ts'] }]);
    expect(getOwner(m, 'src/types.ts')).toBe('agent-alpha');
    expect(getOwner(m, 'src/utils.ts')).toBeNull();
  });

  it('resolves directory prefix ownership', () => {
    const m = buildOwnershipManifest([{ agentId: 'agent-alpha', patterns: ['src/services/'] }]);
    expect(getOwner(m, 'src/services/brain-db.ts')).toBe('agent-alpha');
    expect(getOwner(m, 'src/commands/init.ts')).toBeNull();
  });
});

describe('getOwners', () => {
  it('returns all matching owners for a file', () => {
    const manifest = buildOwnershipManifest([
      { agentId: 'a1', patterns: ['src/**/*.ts'] },
      { agentId: 'a2', patterns: ['src/services/'] },
    ]);

    const owners = getOwners(manifest, 'src/services/search.ts');
    expect(owners).toEqual(['a1', 'a2']);
  });

  it('returns empty array when no owner matches', () => {
    const manifest = buildOwnershipManifest([{ agentId: 'a1', patterns: ['src/commands/'] }]);

    expect(getOwners(manifest, 'README.md')).toEqual([]);
  });
});

describe('getAgentOwnershipSummary', () => {
  it('returns owned patterns and read-only hint', () => {
    const manifest = buildOwnershipManifest([
      { agentId: 'agent-alpha', patterns: ['src/services/'] },
      { agentId: 'agent-beta', patterns: ['src/commands/'] },
    ]);

    const summary = getAgentOwnershipSummary(manifest, 'agent-alpha');
    expect(summary.ownedFiles).toEqual(['src/services/']);
    expect(summary.readOnlyHint).toContain('src/commands/');
    expect(summary.readOnlyHint).toContain('Read-only');
  });

  it('handles agent with no ownership', () => {
    const manifest = buildOwnershipManifest([
      { agentId: 'agent-beta', patterns: ['src/commands/'] },
    ]);

    const summary = getAgentOwnershipSummary(manifest, 'agent-alpha');
    expect(summary.ownedFiles).toEqual([]);
    expect(summary.readOnlyHint).toContain('src/commands/');
  });

  it('handles single agent in manifest', () => {
    const manifest = buildOwnershipManifest([
      { agentId: 'agent-alpha', patterns: ['src/services/'] },
    ]);

    const summary = getAgentOwnershipSummary(manifest, 'agent-alpha');
    expect(summary.ownedFiles).toEqual(['src/services/']);
    expect(summary.readOnlyHint).toBe('No other agents have file ownership claims.');
  });
});

describe('formatOwnershipBrief', () => {
  it('formats ownership info with owned files and read-only hint', () => {
    const manifest = buildOwnershipManifest([
      { agentId: 'agent-alpha', patterns: ['src/services/', 'src/types.ts'] },
      { agentId: 'agent-beta', patterns: ['src/commands/'] },
    ]);

    const brief = formatOwnershipBrief(manifest, 'agent-alpha');
    expect(brief).toContain('--- File Ownership ---');
    expect(brief).toContain('Owned (can modify):');
    expect(brief).toContain('src/services/');
    expect(brief).toContain('src/types.ts');
    expect(brief).toContain('Read-only');
    expect(brief).toContain('src/commands/');
  });

  it('shows no ownership when agent has no assignments', () => {
    const manifest = buildOwnershipManifest([
      { agentId: 'agent-beta', patterns: ['src/commands/'] },
    ]);

    const brief = formatOwnershipBrief(manifest, 'agent-alpha');
    expect(brief).toContain('No file ownership assigned.');
  });
});
