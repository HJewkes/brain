import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import { resolveWorkstreamFilter } from '../ids.js';
import { getActiveProject, getPmNotes, resolveProject } from '../data/queries.js';
import { getTask, listTasks, updateTaskStatus } from '../data/task-ops.js';
import { listDecisions } from '../data/decision-ops.js';
import { detectStalePrompts } from '../data/prompt-ops.js';
import { getProject } from '../data/project-ops.js';
import { computeEligible, computeWaves, computeImpact } from '../engine/dependency.js';
import { assembleContext, assembleDispatch } from '../engine/dispatch.js';
import { validateClaimToken } from '../engine/claims.js';
import {
  findOrphanedDecisions,
  findBrokenDependencies,
  findBlockedWithoutCause,
  findCancelledDependencies,
} from '../engine/consistency.js';
import { listWorkstreams } from '../data/workstream-ops.js';
import type { TaskStatus, DecisionMetadata, PromptMetadata, ProjectMetadata } from '../types.js';

export function createOrchestrationCommands(): Command[] {
  const nextCmd = new Command('next')
    .description('Show eligible tasks (pending with all deps done)')
    .option('--project <prefix>', 'Project prefix (uses active project if omitted)')
    .option('--limit <n>', 'Max tasks to show (default: 10)', '10')
    .option('--workstream <ws>', 'Filter by workstream number or display ID')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const projectResult = resolveProject(svc.db, opts.project);
        if (!projectResult.ok) {
          process.stderr.write(formatError(projectResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        const prefix = projectResult.data;
        const limit = parseInt(opts.limit, 10);

        const eligibleIds = computeEligible(svc.db, prefix);

        const priorityOrder = ['critical', 'high', 'medium', 'low'];
        const resolved = eligibleIds
          .flatMap((id) => {
            const r = getTask(svc.db, id);
            return r.ok ? [r.data] : [];
          })
          .sort((a, b) => {
            const priDiff = priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority);
            if (priDiff !== 0) return priDiff;
            const wsDiff = a.workstream - b.workstream;
            if (wsDiff !== 0) return wsDiff;
            return a.display_id.localeCompare(b.display_id);
          });

        let filtered = resolved;
        if (opts.workstream) {
          const wsResult = resolveWorkstreamFilter(opts.workstream);
          if (!wsResult.ok) {
            process.stderr.write(formatError(wsResult.error, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }
          filtered = resolved.filter((t) => t.workstream === wsResult.data);
        }

        const limited = filtered.slice(0, limit);

        if (opts.json) {
          process.stdout.write(JSON.stringify(limited, null, 2) + '\n');
          return;
        }

        if (limited.length === 0) {
          process.stdout.write('No eligible tasks.\n');
          return;
        }

        const byWorkstream = new Map<number, typeof limited>();
        for (const t of limited) {
          const ws = t.workstream;
          if (!byWorkstream.has(ws)) byWorkstream.set(ws, []);
          byWorkstream.get(ws)!.push(t);
        }

        for (const [ws, tasks] of byWorkstream) {
          process.stdout.write(`Workstream ${ws}:\n`);
          for (const t of tasks) {
            const title = t.title ? ` ${t.title}` : '';
            const vs = t.virtualStates && t.virtualStates.length > 0 ? ` ${t.virtualStates.join(' ')}` : '';
            process.stdout.write(`  ${t.display_id}${title}  [${t.priority}]${vs}\n`);
          }
        }

        if (filtered.length > limit) {
          process.stdout.write(`\n... and ${filtered.length - limit} more eligible tasks\n`);
        }
      });
    });

  const wavesCmd = new Command('waves')
    .description('Show topological wave grouping of remaining tasks')
    .option('--project <prefix>', 'Project prefix (uses active project if omitted)')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const projectResult = resolveProject(svc.db, opts.project);
        if (!projectResult.ok) {
          process.stderr.write(formatError(projectResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        const prefix = projectResult.data;

        const waves = computeWaves(svc.db, prefix);

        if (opts.json) {
          const result = waves.map((w) => ({
            wave: w.wave,
            tasks: w.taskIds.map((id) => {
              const r = getTask(svc.db, id);
              if (!r.ok) return { display_id: id, title: undefined, status: 'unknown' };
              return {
                display_id: r.data.display_id,
                title: r.data.title,
                status: r.data.status,
                depends_on: r.data.depends_on ?? [],
              };
            }),
          }));
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
          return;
        }

        if (waves.length === 0) {
          process.stdout.write('No active tasks.\n');
          return;
        }

        for (const w of waves) {
          process.stdout.write(`Wave ${w.wave}:\n`);
          for (const id of w.taskIds) {
            const r = getTask(svc.db, id);
            if (!r.ok) {
              process.stdout.write(`  ${id}\n`);
              continue;
            }
            const title = r.data.title ? ` ${r.data.title}` : '';
            process.stdout.write(`  ${id}${title}\n`);
          }
        }
      });
    });

  const dispatchCmd = new Command('dispatch')
    .description('Assemble and output enriched context bundle for a task')
    .argument('<id>', 'Task display ID')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const displayId = id.toUpperCase();
        const result = await assembleDispatch(svc.db, svc.embedder, svc.config, displayId);

        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const bundle = result.data;
        if (opts.json) {
          process.stdout.write(JSON.stringify(bundle, null, 2) + '\n');
          return;
        }

        const lines: string[] = [];
        const title = bundle.task.title ?? bundle.task.display_id;
        lines.push(`Task: ${bundle.task.display_id} - ${title}`);
        lines.push(`Status: ${bundle.task.status} | Priority: ${bundle.task.priority} | Category: ${bundle.task.category}`);

        if (bundle.workstream) {
          lines.push(`Workstream: ${bundle.workstream.displayId} - ${bundle.workstream.title}`);
        }

        if (bundle.workstreamDescription) {
          lines.push(`  ${bundle.workstreamDescription}`);
        }

        if (bundle.body) {
          lines.push('');
          lines.push('--- Description ---');
          lines.push(bundle.body);
        }

        if (bundle.prompt) {
          lines.push('');
          lines.push('--- Prompt ---');
          lines.push(bundle.prompt);
        }

        if (bundle.dependencies.length > 0) {
          lines.push('');
          lines.push('--- Dependencies ---');
          for (const dep of bundle.dependencies) {
            const summary = dep.summary ? ` - ${dep.summary}` : '';
            lines.push(`  ${dep.displayId} [${dep.status}] ${dep.name}${summary}`);
          }
        }

        if (bundle.peerTasks.length > 0) {
          lines.push('');
          lines.push('--- Peer Tasks (same workstream) ---');
          for (const peer of bundle.peerTasks) {
            lines.push(`  ${peer.displayId} [${peer.status}] ${peer.title}`);
          }
        }

        if (bundle.downstreamDependents.length > 0) {
          lines.push('');
          lines.push('--- Downstream (blocked by this task) ---');
          for (const dep of bundle.downstreamDependents) {
            lines.push(`  ${dep.displayId} ${dep.title}`);
          }
        }

        if (bundle.relatedNotes.length > 0) {
          lines.push('');
          lines.push('--- Related Notes ---');
          for (const note of bundle.relatedNotes) {
            const score = note.score.toFixed(2);
            lines.push(`  [${score}] ${note.title}`);
            if (note.excerpt) {
              lines.push(`    ${note.excerpt.slice(0, 120)}`);
            }
          }
        }

        if (bundle.decisions.length > 0) {
          lines.push('');
          lines.push('--- Decisions ---');
          for (const dec of bundle.decisions) {
            lines.push(`  ${dec.displayId} [${dec.status}] ${dec.content}`);
          }
        }

        process.stdout.write(lines.join('\n') + '\n');
      });
    });

  const completeCmd = new Command('complete')
    .description('Mark task done, record activity, run impact analysis')
    .argument('<id>', 'Task display ID')
    .option('--token <token>', 'Claim token to validate')
    .option('--summary <text>', 'Completion summary')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const displayId = id.toUpperCase();

        const taskResult = getTask(svc.db, displayId);
        if (!taskResult.ok) {
          process.stderr.write(formatError(taskResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        let currentStatus = taskResult.data.status;

        if (currentStatus === 'pending') {
          const claimResult = await updateTaskStatus(svc.db, svc.config, svc.embedder, displayId, 'claimed' as TaskStatus);
          if (!claimResult.ok) {
            process.stderr.write(formatError(claimResult.error, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }
          if (!opts.json) process.stdout.write(`${displayId}: pending → claimed\n`);
          currentStatus = 'claimed';
        }

        if (currentStatus === 'claimed') {
          const startResult = await updateTaskStatus(svc.db, svc.config, svc.embedder, displayId, 'in-progress' as TaskStatus);
          if (!startResult.ok) {
            process.stderr.write(formatError(startResult.error, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }
          if (!opts.json) process.stdout.write(`${displayId}: claimed → in-progress\n`);
        }

        if (opts.token) {
          const storedToken = taskResult.data.claim_token;
          if (!storedToken) {
            process.stderr.write(
              formatError(
                { error: true, code: 'INVALID_CLAIM_TOKEN', message: 'Task has no active claim' },
                !!opts.json
              ) + '\n'
            );
            process.exitCode = 1;
            return;
          }
          const tokenCheck = validateClaimToken(storedToken, opts.token);
          if (!tokenCheck.ok) {
            process.stderr.write(formatError(tokenCheck.error, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }
        }

        const statusResult = await updateTaskStatus(
          svc.db,
          svc.config,
          svc.embedder,
          displayId,
          'done' as TaskStatus
        );
        if (!statusResult.ok) {
          process.stderr.write(formatError(statusResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        if (opts.summary) {
          const notes = getPmNotes(svc.db, 'task', { display_id: displayId });
          if (notes.length > 0 && notes[0].contentDir) {
            const contentDir = notes[0].contentDir;
            if (!existsSync(contentDir)) {
              mkdirSync(contentDir, { recursive: true });
            }
            writeFileSync(join(contentDir, 'summary.md'), opts.summary, 'utf-8');
          }
        }

        const now = new Date().toISOString();
        svc.db.addActivity({
          id: randomUUID(),
          noteIds: JSON.stringify([displayId]),
          module: 'pm',
          moduleInstance: taskResult.data.project,
          activityType: 'task_completed',
          actorType: 'cli',
          actorId: null,
          sessionId: null,
          metadata: JSON.stringify({ display_id: displayId }),
          outcome: 'done',
          startedAt: now,
          completedAt: now,
        });

        const impact = computeImpact(svc.db, taskResult.data.project, displayId);

        const output = {
          ...statusResult.data,
          newlyEligible: impact,
        };

        if (opts.json) {
          process.stdout.write(JSON.stringify(output, null, 2) + '\n');
        } else {
          process.stdout.write(`Completed ${displayId}\n`);
          if (impact.length > 0) {
            process.stdout.write(`Newly eligible: ${impact.join(', ')}\n`);
          }
        }
      });
    });

  const briefingCmd = new Command('briefing')
    .description('Session briefing with project state overview')
    .option('--project <prefix>', 'Project prefix (uses active project if omitted)')
    .option('--verbose', 'Show workstream breakdown and priority matrix')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const resolvedResult = resolveProject(svc.db, opts.project);
        if (!resolvedResult.ok) {
          process.stderr.write(formatError(resolvedResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        const prefix = resolvedResult.data;

        const projectResult = getProject(svc.db, prefix);
        const project = projectResult.ok ? projectResult.data : null;

        const allTasksResult = listTasks(svc.db, prefix);
        const allTasks = allTasksResult.ok ? allTasksResult.data : [];

        const eligible = computeEligible(svc.db, prefix);
        const inProgress = allTasks.filter((t) => t.status === 'in-progress');
        const blocked = allTasks.filter(
          (t) => t.status === 'blocked' || t.virtualStates?.includes('+BLOCKED')
        );
        const done = allTasks.filter((t) => t.status === 'done');
        const pending = allTasks.filter((t) => t.status === 'pending');

        const decisionsResult = listDecisions(svc.db, prefix);
        const recentDecisions = decisionsResult.ok ? decisionsResult.data : [];

        const staleResult = detectStalePrompts(svc.db, prefix);
        const stalePrompts = staleResult.ok ? staleResult.data : [];

        // Quick consistency check (structural only)
        const orphans = findOrphanedDecisions(svc.db, prefix);
        const brokenDeps = findBrokenDependencies(svc.db, prefix);
        const blockedNoCause = findBlockedWithoutCause(svc.db, prefix);
        const cancelledDeps = findCancelledDependencies(svc.db, prefix);
        const consistencyIssues =
          orphans.length + brokenDeps.length + blockedNoCause.length + cancelledDeps.length;

        const nextActions: string[] = [];
        if (eligible.length > 0) {
          nextActions.push(`Pick up eligible task: ${eligible[0]}`);
        }
        if (stalePrompts.length > 0) {
          nextActions.push(`Update ${stalePrompts.length} stale prompt(s)`);
        }
        if (blocked.length > 0) {
          nextActions.push(`Resolve ${blocked.length} blocked task(s)`);
        }

        const briefing: BriefingData = {
          project: project ?? { display_id: prefix, prefix, status: 'active' as const },
          tasks: {
            total: allTasks.length,
            eligible,
            inProgress: inProgress.map((t) => t.display_id),
            blocked: blocked.map((t) => t.display_id),
            done: done.map((t) => t.display_id),
            pending: pending.map((t) => t.display_id),
          },
          recentDecisions,
          stalePrompts,
          nextActions,
          consistencyIssues,
        };

        if (opts.verbose) {
          const wsResult = listWorkstreams(svc.db, prefix);
          const workstreams = wsResult.ok ? wsResult.data : [];

          briefing.workstreamBreakdown = workstreams.map((ws) => {
            const wsTasks = allTasks.filter((t) => t.workstream === ws.number);
            return {
              display_id: ws.display_id,
              name: ws.title?.replace(/^Workstream\s+/i, '') ?? `#${ws.number}`,
              pending: wsTasks.filter((t) => t.status === 'pending').length,
              inProgress: wsTasks.filter((t) => t.status === 'in-progress').length,
              done: wsTasks.filter((t) => t.status === 'done').length,
              blocked: wsTasks.filter(
                (t) => t.status === 'blocked' || t.virtualStates?.includes('+BLOCKED')
              ).length,
            };
          });

          briefing.priorityMatrix = {
            critical: allTasks.filter((t) => t.priority === 'critical').length,
            high: allTasks.filter((t) => t.priority === 'high').length,
            medium: allTasks.filter((t) => t.priority === 'medium').length,
            low: allTasks.filter((t) => t.priority === 'low').length,
          };
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify(briefing, null, 2) + '\n');
          return;
        }

        const lines: string[] = [];
        lines.push(`=== Briefing: ${project?.display_id ?? prefix} ===`);
        if (project) {
          lines.push(
            `Status: ${project.status}${project.phase ? ` | Phase: ${project.phase}` : ''}`
          );
        }
        lines.push('');

        lines.push(`Tasks: ${allTasks.length} total`);
        lines.push(`  Done: ${done.length}`);
        lines.push(`  In-progress: ${inProgress.length}`);
        if (eligible.length <= 5) {
          lines.push(
            `  Eligible: ${eligible.length}${eligible.length > 0 ? ` (${eligible.join(', ')})` : ''}`
          );
        } else {
          const top5 = eligible.slice(0, 5);
          lines.push(
            `  Eligible: ${eligible.length} (${top5.join(', ')} and ${eligible.length - 5} more)`
          );
        }
        lines.push(
          `  Blocked: ${blocked.length}${blocked.length > 0 ? ` (${blocked.join(', ')})` : ''}`
        );
        lines.push(`  Pending: ${pending.length}`);
        lines.push('');

        if (recentDecisions.length > 0) {
          lines.push('Recent decisions:');
          for (const d of recentDecisions) {
            lines.push(`  ${d.display_id} [${d.status}] (source: ${d.source_task})`);
          }
          lines.push('');
        }

        if (stalePrompts.length > 0) {
          lines.push('Stale prompts:');
          for (const p of stalePrompts) {
            lines.push(`  ${p.display_id} for ${p.task}`);
          }
          lines.push('');
        }

        if (nextActions.length > 0) {
          lines.push('Recommended actions:');
          for (const action of nextActions) {
            lines.push(`  -> ${action}`);
          }
        }

        if (consistencyIssues > 0) {
          lines.push('');
          lines.push(
            `Consistency: ${consistencyIssues} structural issue(s) found. Run /sanity-check for details.`
          );
        }

        if (opts.verbose) {
          lines.push('');
          lines.push('--- Workstream Breakdown ---');

          const wsResult = listWorkstreams(svc.db, prefix);
          const workstreams = wsResult.ok ? wsResult.data : [];

          for (const ws of workstreams) {
            const wsTasks = allTasks.filter((t) => t.workstream === ws.number);
            const wsDone = wsTasks.filter((t) => t.status === 'done').length;
            const wsInProgress = wsTasks.filter((t) => t.status === 'in-progress').length;
            const wsPending = wsTasks.filter((t) => t.status === 'pending').length;
            const wsBlocked = wsTasks.filter((t) => t.status === 'blocked').length;
            const wsName = ws.title?.replace(/^Workstream\s+/i, '') ?? `#${ws.number}`;
            lines.push(
              `  ${ws.display_id} ${wsName}: ${wsPending} pending, ${wsInProgress} in-progress, ${wsDone} done${wsBlocked > 0 ? `, ${wsBlocked} blocked` : ''}`
            );
          }

          lines.push('');
          lines.push('--- Priority Matrix ---');
          const critical = allTasks.filter((t) => t.priority === 'critical').length;
          const high = allTasks.filter((t) => t.priority === 'high').length;
          const medium = allTasks.filter((t) => t.priority === 'medium').length;
          const low = allTasks.filter((t) => t.priority === 'low').length;
          lines.push(`  Critical: ${critical} | High: ${high} | Medium: ${medium} | Low: ${low}`);

          if (eligible.length > 0) {
            lines.push('');
            lines.push('--- Top Eligible ---');
            const priorityOrder = ['critical', 'high', 'medium', 'low'];
            const sortedEligible = eligible
              .map((id) => {
                const r = getTask(svc.db, id);
                if (!r.ok) return { display_id: id, title: undefined, priority: 'low' as const };
                return r.data;
              })
              .sort(
                (a, b) => priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority)
              );

            const topN = sortedEligible.slice(0, 5);
            for (const t of topN) {
              const title = t.title ? ` ${t.title}` : '';
              lines.push(`  ${t.display_id}${title} [${t.priority}]`);
            }
            if (sortedEligible.length > 5) {
              lines.push(`  ... and ${sortedEligible.length - 5} more`);
            }
          }
        }

        process.stdout.write(lines.join('\n') + '\n');
      });
    });

  return [nextCmd, wavesCmd, dispatchCmd, completeCmd, briefingCmd] as Command[];
}

export interface BriefingData {
  project: ProjectMetadata | { display_id: string; prefix: string; status: 'active' };
  tasks: {
    total: number;
    eligible: string[];
    inProgress: string[];
    blocked: string[];
    done: string[];
    pending: string[];
  };
  recentDecisions: DecisionMetadata[];
  stalePrompts: PromptMetadata[];
  nextActions: string[];
  consistencyIssues?: number;
  workstreamBreakdown?: Array<{
    display_id: string;
    name: string;
    pending: number;
    inProgress: number;
    done: number;
    blocked: number;
  }>;
  priorityMatrix?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}
