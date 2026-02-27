import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import { estimateCost } from '../data/cost.js';
import type { ActivityRecord } from '../../../types.js';

function filterActivities(
  activities: ActivityRecord[],
  opts: { project?: string; since?: string }
): ActivityRecord[] {
  let filtered = activities;

  if (opts.project) {
    const upper = opts.project.toUpperCase();
    filtered = filtered.filter((a) => a.moduleInstance === upper);
  }

  if (opts.since) {
    const sinceDate = opts.since;
    filtered = filtered.filter((a) => {
      const ts = a.startedAt ?? a.completedAt;
      return ts ? ts >= sinceDate : false;
    });
  }

  return filtered;
}

function buildSummary(activities: ActivityRecord[]): Record<string, unknown> {
  const total = activities.length;
  const completed = activities.filter((a) => a.outcome === 'success' || a.completedAt).length;
  const failed = activities.filter((a) => a.outcome === 'failure').length;

  const byType: Record<string, number> = {};
  for (const a of activities) {
    const type = a.activityType ?? 'unknown';
    byType[type] = (byType[type] ?? 0) + 1;
  }

  return { total, completed, failed, byType };
}

function buildPerformance(activities: ActivityRecord[]): Record<string, unknown> {
  const total = activities.length;
  if (total === 0) {
    return { total: 0, completionRate: 0, avgDurationMs: 0 };
  }

  const completed = activities.filter((a) => a.completedAt).length;
  const completionRate = total > 0 ? completed / total : 0;

  const durations: number[] = [];
  for (const a of activities) {
    if (a.startedAt && a.completedAt) {
      const start = new Date(a.startedAt).getTime();
      const end = new Date(a.completedAt).getTime();
      if (!isNaN(start) && !isNaN(end) && end > start) {
        durations.push(end - start);
      }
    }
  }

  const avgDurationMs =
    durations.length > 0 ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0;

  return {
    total,
    completed,
    completionRate: Math.round(completionRate * 100) / 100,
    avgDurationMs,
  };
}

export function createAuditCommands(): Command {
  const cmd = new Command('audit').description('Audit activity and cost reports');

  cmd
    .command('summary')
    .description('Aggregated activity stats')
    .option('--project <p>', 'Filter by project')
    .option('--since <date>', 'Filter by start date')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const activities = svc.db.getActivities({ module: 'pm' });
        const filtered = filterActivities(activities, opts);
        const summary = buildSummary(filtered);
        if (opts.json) {
          process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
        } else {
          process.stdout.write(
            `Total: ${summary.total}, Completed: ${summary.completed}, Failed: ${summary.failed}\n`
          );
          const byType = summary.byType as Record<string, number>;
          for (const [type, count] of Object.entries(byType)) {
            process.stdout.write(`  ${type}: ${count}\n`);
          }
        }
      });
    });

  cmd
    .command('cost')
    .description('Cost estimation from token usage')
    .option('--project <p>', 'Filter by project')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const activities = svc.db.getActivities({ module: 'pm' });
        const filtered = filterActivities(activities, opts);
        const cost = estimateCost(filtered);
        if (opts.json) {
          process.stdout.write(JSON.stringify(cost, null, 2) + '\n');
        } else {
          process.stdout.write(`Total tokens: ${cost.totalTokens}\n`);
          process.stdout.write(`Estimated cost: $${cost.estimatedCost.toFixed(4)}\n`);
          for (const [model, data] of Object.entries(cost.byModel)) {
            process.stdout.write(`  ${model}: ${data.tokens} tokens ($${data.cost.toFixed(4)})\n`);
          }
        }
      });
    });

  cmd
    .command('performance')
    .description('Completion rates and avg duration')
    .option('--project <p>', 'Filter by project')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const activities = svc.db.getActivities({ module: 'pm' });
        const filtered = filterActivities(activities, opts);
        const perf = buildPerformance(filtered);
        if (opts.json) {
          process.stdout.write(JSON.stringify(perf, null, 2) + '\n');
        } else {
          process.stdout.write(`Total: ${perf.total}, Completed: ${perf.completed}\n`);
          process.stdout.write(
            `Completion rate: ${((perf.completionRate as number) * 100).toFixed(0)}%\n`
          );
          process.stdout.write(`Avg duration: ${perf.avgDurationMs}ms\n`);
        }
      });
    });

  cmd
    .command('executions')
    .description('Recent activity log')
    .option('--project <p>', 'Filter by project')
    .option('--limit <n>', 'Limit results', parseInt, 20)
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const activities = svc.db.getActivities({ module: 'pm' });
        const filtered = filterActivities(activities, opts).slice(0, opts.limit);
        if (opts.json) {
          process.stdout.write(JSON.stringify(filtered, null, 2) + '\n');
        } else {
          if (filtered.length === 0) {
            process.stdout.write('No executions found.\n');
            return;
          }
          for (const a of filtered) {
            const ts = a.startedAt ?? a.completedAt ?? '?';
            const outcome = a.outcome ?? 'pending';
            process.stdout.write(`${a.id} [${a.activityType ?? '?'}] ${outcome} @ ${ts}\n`);
          }
        }
      });
    });

  cmd
    .command('enrich')
    .description('Add telemetry to an activity')
    .argument('<activity-id>', 'Activity ID')
    .requiredOption('--tokens <n>', 'Token count', parseInt)
    .requiredOption('--model <m>', 'Model name')
    .option('--json', 'Output JSON')
    .action(async (activityId, opts) => {
      await withBrain(async (svc) => {
        const activity = svc.db.getActivity(activityId);
        if (!activity) {
          const err = {
            error: true,
            code: 'NOT_FOUND',
            message: `Activity "${activityId}" not found`,
          };
          process.stderr.write(
            formatError(err as Parameters<typeof formatError>[0], !!opts.json) + '\n'
          );
          process.exitCode = 1;
          return;
        }

        const existingMeta = activity.metadata
          ? (JSON.parse(activity.metadata) as Record<string, unknown>)
          : {};
        const updatedMeta = { ...existingMeta, tokens: opts.tokens, model: opts.model };
        const updatedActivity = { ...activity, metadata: JSON.stringify(updatedMeta) };
        svc.db.addActivity(updatedActivity);

        if (opts.json) {
          process.stdout.write(JSON.stringify(updatedActivity, null, 2) + '\n');
        } else {
          process.stdout.write(
            `Enriched activity ${activityId} with ${opts.tokens} tokens (${opts.model})\n`
          );
        }
      });
    });

  return cmd;
}
