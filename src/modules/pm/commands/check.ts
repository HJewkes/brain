import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { getActiveProject } from '../data/queries.js';
import { formatError } from '../errors.js';
import { runConsistencyCheck, type ConsistencyReport } from '../engine/consistency.js';

function resolvePrefix(explicit: string | undefined, active: string | null): string | undefined {
  if (explicit) return explicit.toUpperCase();
  return active ?? undefined;
}

function formatCheckReport(report: ConsistencyReport): void {
  const { summary, structural, semantic } = report;

  process.stdout.write(
    `Project ${report.project}: ${summary.totalTasks} tasks, ${summary.totalDecisions} decisions, ${summary.totalPrompts} prompts\n`
  );

  if (summary.issuesFound === 0) {
    process.stdout.write('No issues found.\n');
    return;
  }

  process.stdout.write(`${summary.issuesFound} issue(s) found:\n`);

  if (structural.orphanedDecisions.length > 0) {
    process.stdout.write(`\n  Orphaned decisions (${structural.orphanedDecisions.length}):\n`);
    for (const d of structural.orphanedDecisions) {
      process.stdout.write(`    ${d.id} - ${d.title}: ${d.reason}\n`);
    }
  }

  if (structural.stalePrompts.length > 0) {
    process.stdout.write(`\n  Stale prompts (${structural.stalePrompts.length}):\n`);
    for (const p of structural.stalePrompts) {
      process.stdout.write(`    ${p.id} (task ${p.task}): ${p.reason}\n`);
    }
  }

  if (structural.brokenDependencies.length > 0) {
    process.stdout.write(`\n  Broken dependencies (${structural.brokenDependencies.length}):\n`);
    for (const b of structural.brokenDependencies) {
      process.stdout.write(`    ${b.task} -> ${b.dependsOn}: ${b.reason}\n`);
    }
  }

  if (structural.blockedWithoutCause.length > 0) {
    process.stdout.write(
      `\n  Blocked without cause (${structural.blockedWithoutCause.length}):\n`
    );
    for (const b of structural.blockedWithoutCause) {
      process.stdout.write(`    ${b.id} - ${b.title}: ${b.reason}\n`);
    }
  }

  if (structural.cancelledDependencies.length > 0) {
    process.stdout.write(
      `\n  Cancelled dependencies (${structural.cancelledDependencies.length}):\n`
    );
    for (const c of structural.cancelledDependencies) {
      process.stdout.write(`    ${c.task} -> ${c.dependsOn}: ${c.reason}\n`);
    }
  }

  if (semantic) {
    if (semantic.decisionPairs.length > 0) {
      process.stdout.write(`\n  Decision conflicts (${semantic.decisionPairs.length}):\n`);
      for (const p of semantic.decisionPairs) {
        process.stdout.write(
          `    ${p.decision1.id} vs ${p.decision2.id}: ${p.reason}\n`
        );
      }
    }

    if (semantic.supersessionGaps.length > 0) {
      process.stdout.write(`\n  Supersession gaps (${semantic.supersessionGaps.length}):\n`);
      for (const g of semantic.supersessionGaps) {
        process.stdout.write(`    ${g.older.id} -> ${g.newer.id}: ${g.reason}\n`);
      }
    }
  }
}

export function createCheckCommand(): Command {
  return new Command('check')
    .description('Run consistency checks on a PM project')
    .option('--project <prefix>', 'Project prefix (uses active project if omitted)')
    .option('--deep', 'Include semantic analysis and source document clustering')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const prefix = resolvePrefix(opts.project, getActiveProject(svc.db));
        if (!prefix) {
          const msg =
            'No project specified and no active project set. Use "brain pm use <prefix>" first.';
          process.stderr.write(
            formatError({ error: true, code: 'INVALID_INPUT', message: msg }, true) + '\n'
          );
          process.exitCode = 1;
          return;
        }

        const report = runConsistencyCheck(svc.db, prefix, !!opts.deep);

        if (opts.json) {
          process.stdout.write(JSON.stringify(report, null, 2) + '\n');
          return;
        }

        formatCheckReport(report);
      });
    }) as unknown as Command;
}
