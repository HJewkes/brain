export interface OwnershipRule {
  agentId: string;
  patterns: string[];
}

export interface FileOwnershipManifest {
  rules: OwnershipRule[];
}

export interface OwnershipConflict {
  pattern: string;
  agents: string[];
}

export interface FileOwnershipSummary {
  ownedFiles: string[];
  readOnlyHint: string;
}

/**
 * Match a file path against a glob-like pattern.
 * Supports: `*` (single segment wildcard), `**` (multi-segment), exact matches,
 * and prefix patterns like `src/services/`.
 */
export function matchPattern(filePath: string, pattern: string): boolean {
  // Trailing slash means directory prefix match
  if (pattern.endsWith('/')) {
    return filePath.startsWith(pattern) || filePath === pattern.slice(0, -1);
  }

  // Exact match
  if (!pattern.includes('*')) {
    return filePath === pattern;
  }

  // Convert glob to regex by processing token by token
  let regexStr = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      // `**` matches zero or more path segments including separators
      regexStr += '(?:.+/)?';
      i += 2;
      // Skip trailing slash after ** (e.g., **/)
      if (pattern[i] === '/') i++;
    } else if (pattern[i] === '*') {
      regexStr += '[^/]*';
      i++;
    } else {
      regexStr += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }

  return new RegExp(`^${regexStr}$`).test(filePath);
}

/**
 * Build a manifest from a set of agent-to-pattern assignments.
 */
export function buildOwnershipManifest(
  assignments: Array<{ agentId: string; patterns: string[] }>
): FileOwnershipManifest {
  return {
    rules: assignments.map((a) => ({
      agentId: a.agentId,
      patterns: a.patterns,
    })),
  };
}

/**
 * Detect overlapping ownership: two or more agents claiming the same glob pattern.
 */
export function checkConflicts(manifest: FileOwnershipManifest): OwnershipConflict[] {
  const patternOwners = new Map<string, string[]>();

  for (const rule of manifest.rules) {
    for (const pattern of rule.patterns) {
      const existing = patternOwners.get(pattern);
      if (existing) {
        existing.push(rule.agentId);
      } else {
        patternOwners.set(pattern, [rule.agentId]);
      }
    }
  }

  const conflicts: OwnershipConflict[] = [];
  for (const [pattern, agents] of patternOwners) {
    if (agents.length > 1) {
      conflicts.push({ pattern, agents });
    }
  }

  return conflicts;
}

/**
 * Resolve who owns a given file path. Returns the agent ID or null if unowned.
 */
export function getOwner(manifest: FileOwnershipManifest, filePath: string): string | null {
  for (const rule of manifest.rules) {
    for (const pattern of rule.patterns) {
      if (matchPattern(filePath, pattern)) {
        return rule.agentId;
      }
    }
  }
  return null;
}

/**
 * Get all owners that match a given file path (for conflict detection on real paths).
 */
export function getOwners(manifest: FileOwnershipManifest, filePath: string): string[] {
  const owners: string[] = [];
  for (const rule of manifest.rules) {
    for (const pattern of rule.patterns) {
      if (matchPattern(filePath, pattern)) {
        owners.push(rule.agentId);
        break;
      }
    }
  }
  return owners;
}

/**
 * Build a summary for a specific agent: which files it owns and a read-only hint.
 */
export function getAgentOwnershipSummary(
  manifest: FileOwnershipManifest,
  agentId: string
): FileOwnershipSummary {
  const rule = manifest.rules.find((r) => r.agentId === agentId);
  const ownedFiles = rule?.patterns ?? [];

  const otherPatterns = manifest.rules
    .filter((r) => r.agentId !== agentId)
    .flatMap((r) => r.patterns);

  const readOnlyHint =
    otherPatterns.length > 0
      ? `Read-only (owned by other agents): ${otherPatterns.join(', ')}`
      : 'No other agents have file ownership claims.';

  return { ownedFiles, readOnlyHint };
}

/**
 * Format ownership info for inclusion in a dispatch brief.
 */
export function formatOwnershipBrief(manifest: FileOwnershipManifest, agentId: string): string {
  const summary = getAgentOwnershipSummary(manifest, agentId);
  const lines: string[] = [];

  lines.push('--- File Ownership ---');
  if (summary.ownedFiles.length > 0) {
    lines.push('Owned (can modify):');
    for (const p of summary.ownedFiles) {
      lines.push(`  ${p}`);
    }
  } else {
    lines.push('No file ownership assigned.');
  }
  lines.push(summary.readOnlyHint);

  return lines.join('\n');
}
