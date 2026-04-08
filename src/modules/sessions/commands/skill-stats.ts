import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { listSkillCounters } from '../analytics/skill-counters.js';

export function createSessionSkillStatsCommand(): Command {
  return new Command('skill-stats')
    .description('Show skill counter stats (usage, success rate, GPA utility)')
    .option('--json', 'Output JSON')
    .action(async (opts: { json?: boolean }) => {
      await withBrain(async (svc) => {
        const counters = listSkillCounters(svc.db);

        if (counters.length === 0) {
          process.stdout.write('No skill counters found.\n');
          return;
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify(counters, null, 2) + '\n');
          return;
        }

        process.stdout.write('Skill Stats\n');
        process.stdout.write(
          `${'Skill'.padEnd(30)} ${'Uses'.padStart(6)} ${'Succ%'.padStart(7)} ${'AvgGPA'.padStart(7)} ${'Utility'.padStart(8)}\n`
        );
        process.stdout.write('─'.repeat(62) + '\n');

        for (const c of counters) {
          const successRate = c.uses > 0 ? ((c.successes / c.uses) * 100).toFixed(0) + '%' : '—';
          const avgGpa = c.gpaCount > 0 ? (c.gpaSum / c.gpaCount).toFixed(1) : '—';
          const utility = c.utilityScore.toFixed(2);
          const name = c.skillName.length > 30 ? c.skillName.slice(0, 29) + '…' : c.skillName;
          process.stdout.write(
            `${name.padEnd(30)} ${String(c.uses).padStart(6)} ${successRate.padStart(7)} ${avgGpa.padStart(7)} ${utility.padStart(8)}\n`
          );
        }
      });
    });
}
