import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import { resolveProject } from '../data/queries.js';
import { getTask, listTasks, updateTaskStatus } from '../data/task-ops.js';
import { computeWaves, buildDependencyGraph } from '../engine/dependency.js';
import { detectFileCollisions } from '../engine/collisions.js';
import type { FileCollision } from '../engine/collisions.js';
import type { BrainDB } from '../../../services/brain-db.js';
import type { TaskStatus } from '../types.js';

export interface WaveTaskSummary {
  displayId: string;
  title: string;
  priority: string;
  status: string;
  deps: Array<{ displayId: string; status: string }>;
}

export interface DispatchWaveResult {
  wave: number;
  eligible: WaveTaskSummary[];
  inProgress: WaveTaskSummary[];
  done: WaveTaskSummary[];
  collisions: FileCollision[];
  nextWave: {
    wave: number;
    tasks: WaveTaskSummary[];
    blockedBy: Array<{ displayId: string; waitingOn: string[] }>;
  } | null;
}

function buildTaskSummary(db: BrainDB, displayId: string, prefix: string): WaveTaskSummary {
  const r = getTask(db, displayId);
  if (!r.ok) {
    return { displayId, title: displayId, priority: 'medium', status: 'unknown', deps: [] };
  }
  const task = r.data;
  const graph = buildDependencyGraph(db, prefix);
  const depIds = graph.get(displayId) ?? [];
  const deps = depIds.map((depId) => {
    const depResult = getTask(db, depId);
    return { displayId: depId, status: depResult.ok ? depResult.data.status : 'unknown' };
  });
  return {
    displayId,
    title: task.title ?? displayId,
    priority: task.priority,
    status: task.status,
    deps,
  };
}

function computeBlockedBy(
  db: BrainDB,
  prefix: string,
  taskIds: string[]
): Array<{ displayId: string; waitingOn: string[] }> {
  const graph = buildDependencyGraph(db, prefix);
  const allTasks = listTasks(db, prefix);
  const statusByDisplay = new Map<string, string>();
  for (const t of allTasks.ok ? allTasks.data : []) {
    statusByDisplay.set(t.display_id, t.status);
  }

  return taskIds.map((id) => {
    const deps = graph.get(id) ?? [];
    const unmet = deps.filter((dep) => {
      const s = statusByDisplay.get(dep);
      return s !== 'done' && s !== 'pruned';
    });
    return { displayId: id, waitingOn: unmet };
  });
}

export function computeDispatchWave(db: BrainDB, prefix: string): DispatchWaveResult {
  const waves = computeWaves(db, prefix);
  const allTasksResult = listTasks(db, prefix);
  const allTasks = allTasksResult.ok ? allTasksResult.data : [];
  const statusByDisplay = new Map<string, string>();
  for (const t of allTasks) {
    statusByDisplay.set(t.display_id, t.status);
  }

  if (waves.length === 0) {
    return {
      wave: 0,
      eligible: [],
      inProgress: [],
      done: [],
      collisions: [],
      nextWave: null,
    };
  }

  const currentWave = waves[0];
  const waveIds = currentWave.taskIds;

  const eligible: WaveTaskSummary[] = [];
  const inProgress: WaveTaskSummary[] = [];
  const done: WaveTaskSummary[] = [];

  // Wave 0 from computeWaves only includes active (non-done/cancelled) tasks.
  // Collect tasks by status from wave members plus done tasks in wave 0 position.
  for (const id of waveIds) {
    const status = statusByDisplay.get(id);
    const summary = buildTaskSummary(db, id, prefix);
    if (status === 'pending') {
      eligible.push(summary);
    } else if (status === 'in-progress' || status === 'claimed' || status === 'pending-merge') {
      inProgress.push(summary);
    }
  }

  // Find done tasks at wave 0 position (no deps, or all deps done)
  for (const t of allTasks) {
    if (t.status !== 'done') continue;
    const depIds = buildDependencyGraph(db, prefix).get(t.display_id) ?? [];
    const allDepsDone = depIds.every((dep) => {
      const s = statusByDisplay.get(dep);
      return s === 'done' || s === 'pruned';
    });
    if (allDepsDone) {
      done.push(buildTaskSummary(db, t.display_id, prefix));
    }
  }

  const nextWave =
    waves.length > 1
      ? {
          wave: waves[1].wave,
          tasks: waves[1].taskIds.map((id) => buildTaskSummary(db, id, prefix)),
          blockedBy: computeBlockedBy(db, prefix, waves[1].taskIds),
        }
      : null;

  // Detect file-path overlaps across concurrent tasks (eligible + in-progress).
  const concurrentIds = [...eligible, ...inProgress].map((t) => t.displayId);
  const collisions = detectFileCollisions(db, concurrentIds);

  return {
    wave: currentWave.wave,
    eligible,
    inProgress,
    done,
    collisions,
    nextWave,
  };
}

function isInProgress(result: DispatchWaveResult, displayId: string): boolean {
  return result.inProgress.some((t) => t.displayId === displayId);
}

function formatDepsLine(deps: Array<{ displayId: string; status: string }>): string {
  if (deps.length === 0) return '';
  const parts = deps.map(({ displayId, status }) => {
    const check = status === 'done' || status === 'pruned' ? '✓' : '✗';
    return `${displayId} ${check}`;
  });
  return `    deps: ${parts.join(', ')}`;
}

export function createDispatchWaveCommand(): Command {
  const cmd = new Command('dispatch-wave')
    .description('Compute and display the next dependency wave for dispatch')
    .argument('[prefix]', 'Project prefix (uses active project if omitted)')
    .option('--project <prefix>', 'Project prefix (alternative to positional)')
    .option('--claim', 'Auto-claim all eligible tasks')
    .option('--max <n>', 'Max eligible tasks to dispatch (default: all)')
    .option('--json', 'Output as JSON')
    .option('--dry-run', 'Show what would be dispatched without claiming')
    .action(async (prefixArg, opts) => {
      await withBrain(async (svc) => {
        const projectResult = resolveProject(svc.db, prefixArg ?? opts.project);
        if (!projectResult.ok) {
          process.stderr.write(formatError(projectResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        const prefix = projectResult.data;

        const result = computeDispatchWave(svc.db, prefix);

        const maxN = opts.max ? parseInt(opts.max, 10) : Infinity;
        const toDispatch = result.eligible.slice(0, maxN);

        const dispatchIds = new Set(toDispatch.map((t) => t.displayId));
        const collisions = result.collisions.filter(
          (c) =>
            c.taskIds.filter((id) => dispatchIds.has(id) || isInProgress(result, id)).length > 1
        );

        if (opts.json) {
          const output = {
            wave: result.wave,
            eligible: toDispatch,
            inProgress: result.inProgress,
            blocked: result.nextWave?.tasks ?? [],
            nextWave: result.nextWave,
            collisions,
          };
          process.stdout.write(JSON.stringify(output, null, 2) + '\n');
          return;
        }

        const totalWave = toDispatch.length + result.inProgress.length + result.done.length;
        process.stdout.write(
          `Wave ${result.wave}: ${toDispatch.length}/${totalWave} tasks eligible\n`
        );

        if (toDispatch.length > 0) {
          process.stdout.write('\n');
          for (const t of toDispatch) {
            process.stdout.write(`  ${t.displayId} [${t.priority}] ${t.title}\n`);
            const depsLine = formatDepsLine(t.deps);
            if (depsLine) process.stdout.write(`${depsLine}\n`);
            process.stdout.write('\n');
          }
        } else {
          process.stdout.write('  No eligible tasks in current wave.\n\n');
        }

        if (result.inProgress.length > 0) {
          process.stdout.write(
            `In-progress (${result.inProgress.length}): ${result.inProgress.map((t) => t.displayId).join(', ')}\n`
          );
        }

        if (collisions.length > 0) {
          process.stdout.write(
            `\n⚠ File ownership collisions (${collisions.length}): concurrent tasks reference the same paths.\n`
          );
          for (const c of collisions) {
            process.stdout.write(`  ${c.pattern} ← ${c.taskIds.join(', ')}\n`);
          }
          process.stdout.write(
            '  Review descriptions and serialize overlapping work (add depends_on) or dispatch separately.\n'
          );
        }

        if (result.nextWave) {
          const blockSummary = result.nextWave.blockedBy
            .filter((b) => b.waitingOn.length > 0)
            .map((b) => `${b.displayId} → waiting on ${b.waitingOn.join(', ')}`)
            .join('\n  ');

          process.stdout.write(
            `\nNext wave (blocked): ${result.nextWave.tasks.length} task${result.nextWave.tasks.length !== 1 ? 's' : ''}\n`
          );
          if (blockSummary) {
            process.stdout.write(`  ${blockSummary}\n`);
          }
        }

        if (!opts.claim && !opts.dryRun) return;

        if (opts.dryRun) {
          process.stdout.write(
            `\n[dry-run] Would claim ${toDispatch.length} task${toDispatch.length !== 1 ? 's' : ''}:\n`
          );
          for (const t of toDispatch) {
            process.stdout.write(`  ${t.displayId}\n`);
          }
          return;
        }

        // --claim: transition eligible tasks to claimed
        process.stdout.write(
          `\nClaiming ${toDispatch.length} task${toDispatch.length !== 1 ? 's' : ''}...\n`
        );
        for (const t of toDispatch) {
          const claimResult = await updateTaskStatus(
            svc.db,
            svc.config,
            svc.embedder,
            t.displayId,
            'claimed' as TaskStatus
          );
          if (claimResult.ok) {
            process.stdout.write(`  ${t.displayId}: pending → claimed\n`);
          } else {
            process.stderr.write(`  ${t.displayId}: ${claimResult.error.message}\n`);
          }
        }
      });
    });
  return cmd as unknown as Command;
}
