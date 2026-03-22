import type { DispatchExtension, DispatchExtensionInput } from '../dispatch-extensions.js';
import type { FileOwnershipManifest } from '../file-ownership.js';
import { buildOwnershipManifest, checkConflicts, formatOwnershipBrief } from '../file-ownership.js';
import { computeWaves } from '../../pm/engine/dependency.js';
import { readTaskBody } from '../../pm/engine/dispatch.js';
import { getPmNotes } from '../../pm/data/queries.js';
import type { TaskMetadata } from '../../pm/types.js';
import type { BrainDB } from '../../../services/brain-db.js';

// TODO: Future improvement — write computed ownership to the persisted manifest
// (`.claude/ownership.json`) before agent dispatch so the hook check
// (`src/hooks/checks/ownership.ts`) enforces dynamically-derived ownership
// rather than requiring a manually-maintained manifest.

/**
 * Extract file/directory path references from a task description.
 * Looks for patterns like `src/foo/bar.ts`, `__tests__/x.test.ts`, `templates/`, etc.
 */
export function extractPathReferences(text: string): string[] {
  const pattern = /(?:^|\s|`)((?:src|__tests__|templates|docs|scripts|skill)\/[\w./-]+)/g;
  const paths = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    paths.add(match[1]);
  }
  return [...paths].sort();
}

/**
 * Convert extracted paths to ownership glob patterns.
 * Directories get a trailing slash, files stay as-is.
 */
function pathsToPatterns(paths: string[]): string[] {
  return paths.map((p) => {
    if (p.includes('.')) return p;
    return p.endsWith('/') ? p : `${p}/`;
  });
}

function resolveProject(db: BrainDB, taskDisplayId: string): string | null {
  const notes = getPmNotes(db, 'task', { display_id: taskDisplayId });
  if (notes.length === 0) return null;
  const meta = JSON.parse(notes[0].metadata!) as TaskMetadata;
  return meta.project;
}

function getTaskDescription(db: BrainDB, taskDisplayId: string): string {
  const notes = getPmNotes(db, 'task', { display_id: taskDisplayId });
  if (notes.length === 0) return '';
  const meta = JSON.parse(notes[0].metadata!) as TaskMetadata;
  const body = readTaskBody(notes[0]);
  return [meta.title ?? '', body].join('\n');
}

function findWavePeers(db: BrainDB, project: string, taskDisplayId: string): string[] {
  const waves = computeWaves(db, project);
  for (const wave of waves) {
    if (wave.taskIds.includes(taskDisplayId)) {
      return wave.taskIds.filter((id) => id !== taskDisplayId);
    }
  }
  return [];
}

/**
 * Dynamically compute file ownership from task descriptions for dispatch context.
 *
 * This produces **recommendations** included in the agent's dispatch prompt so it
 * knows which files it should touch. It is NOT the enforcement mechanism — the
 * hook in `src/hooks/checks/ownership.ts` enforces ownership by reading the
 * persisted manifest (`.claude/ownership.json`). If the two diverge, the hook
 * manifest takes precedence.
 */
function computeOwnership(input: DispatchExtensionInput): FileOwnershipManifest | undefined {
  try {
    const { db, taskDisplayId } = input;
    const project = resolveProject(db, taskDisplayId);
    if (!project) return undefined;

    const peers = findWavePeers(db, project, taskDisplayId);
    const allAgents = [taskDisplayId, ...peers];

    const assignments: Array<{ agentId: string; patterns: string[] }> = [];
    for (const agentId of allAgents) {
      const desc = getTaskDescription(db, agentId);
      const paths = extractPathReferences(desc);
      const patterns = pathsToPatterns(paths);
      if (patterns.length > 0) {
        assignments.push({ agentId, patterns });
      }
    }

    if (assignments.length === 0) return undefined;

    const manifest = buildOwnershipManifest(assignments);
    const conflicts = checkConflicts(manifest);

    if (conflicts.length > 0) {
      resolveConflicts(manifest, taskDisplayId, conflicts);
    }

    return manifest;
  } catch {
    // Gracefully handle missing DB methods or other failures
    return undefined;
  }
}

/**
 * Resolve conflicts by giving priority to the current task.
 * Remove conflicting patterns from other agents' rules.
 */
function resolveConflicts(
  manifest: FileOwnershipManifest,
  priorityAgent: string,
  conflicts: Array<{ pattern: string; agents: string[] }>
): void {
  const conflictPatterns = new Set(conflicts.map((c) => c.pattern));

  for (const rule of manifest.rules) {
    if (rule.agentId === priorityAgent) continue;
    rule.patterns = rule.patterns.filter((p) => !conflictPatterns.has(p));
  }

  manifest.rules = manifest.rules.filter((r) => r.patterns.length > 0);
}

export const fileOwnershipExtension: DispatchExtension = {
  name: 'fileOwnership',

  compute(input: DispatchExtensionInput): FileOwnershipManifest | undefined {
    return computeOwnership(input);
  },

  format(data: unknown, taskId: string): string | null {
    const manifest = data as FileOwnershipManifest;
    if (!manifest) return null;
    return formatOwnershipBrief(manifest, taskId);
  },
};
