import { Command } from '@commander-js/extra-typings';
import { execFileSync } from 'node:child_process';
import { withDb } from '../services/brain-service.js';
import { runAllChecks } from '../services/health.js';
import type { HealthCheckResult, HealthReport } from '../types.js';

function statusIcon(status: HealthCheckResult['status']): string {
  switch (status) {
    case 'ok': return 'ok';
    case 'warning': return 'WARNING';
    case 'error': return 'ERROR';
  }
}

function formatCheck(check: HealthCheckResult): string {
  const dots = '.'.repeat(Math.max(1, 25 - check.name.length));
  const detail = check.detail ? ` — ${check.detail}` : '';
  return `  ${check.name} ${dots} ${statusIcon(check.status)} (${check.message}${detail})`;
}

function printReport(report: HealthReport): void {
  for (const check of report.checks) {
    process.stderr.write(formatCheck(check) + '\n');
  }
  process.stderr.write('\n');
  const parts: string[] = [];
  if (report.summary.errors > 0) parts.push(`${report.summary.errors} error(s)`);
  if (report.summary.warnings > 0) parts.push(`${report.summary.warnings} warning(s)`);
  if (parts.length === 0) {
    process.stderr.write('  All checks passed.\n');
  } else {
    process.stderr.write(`  ${parts.join(', ')}\n`);
  }
}

function pullModel(model: string): void {
  process.stderr.write(`\nFixing: pulling ${model}...\n`);
  try {
    execFileSync('ollama', ['pull', model], { stdio: 'inherit', timeout: 120_000 });
    process.stderr.write(`Pulled ${model} successfully.\n`);
  } catch {
    process.stderr.write(`Failed to pull ${model}. Run \`ollama pull ${model}\` manually.\n`);
  }
}

export const doctorCommand = new Command('doctor')
  .description('Check system health and optionally auto-repair')
  .option('--fix', 'attempt to auto-repair warnings')
  .option('--json', 'output as JSON')
  .action(async (opts) => {
    await withDb(async ({ db, config }) => {
      const report = await runAllChecks(
        db,
        config.embedder,
        config.ollamaUrl,
        config.ollamaModel
      );

      if (opts.json) {
        process.stdout.write(JSON.stringify(report) + '\n');
        return;
      }

      process.stderr.write('brain doctor\n');
      printReport(report);

      if (opts.fix) {
        const llmCheck = report.checks.find((c) => c.name === 'LLM');
        if (llmCheck?.status === 'warning' && llmCheck.message.includes('not found')) {
          pullModel(config.ollamaModel ?? 'qwen2.5:3b');
        }

        const failedItems = db.getInboxItems('failed');
        if (failedItems.length > 0) {
          for (const item of failedItems) {
            db.updateInboxStatus(item.id, 'pending');
          }
          process.stderr.write(`Reset ${failedItems.length} failed inbox item(s) to pending.\n`);
        }
      } else if (report.summary.warnings > 0 || report.summary.errors > 0) {
        process.stderr.write('  Run "brain doctor --fix" to auto-repair.\n');
      }
    });
  });
