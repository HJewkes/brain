import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError } from '../errors.js';
import { getTask } from '../data/task-ops.js';
import { assembleContext } from '../engine/dispatch.js';
import type { TaskCategory } from '../types.js';

export interface VerificationPlan {
  taskId: string;
  category: TaskCategory;
  objective: string | undefined;
  dependencies: Array<{ displayId: string; status: string }>;
  decisions: Array<{ displayId: string; content: string }>;
  steps: string[];
}

export function extractAcceptanceCriteria(body: string): string[] {
  const acMatch = body.match(/acceptance criteria[:\s]*\n((?:[-*]\s+.+\n?)+)/i);
  if (!acMatch) return [];
  return acMatch[1]
    .split('\n')
    .filter((l) => l.trim().startsWith('-') || l.trim().startsWith('*'))
    .map((l) => l.replace(/^[\s]*[-*]\s+/, '').trim())
    .filter((l) => l.length > 0);
}

export function suggestVerificationSteps(category: TaskCategory): string[] {
  switch (category) {
    case 'implementation':
      return [
        'Verify all acceptance criteria are met',
        'Run unit tests for changed modules',
        'Check for regressions in dependent code',
        'Review code for style and correctness',
      ];
    case 'testing':
      return [
        'Verify test coverage meets threshold',
        'Run full test suite and check for flaky tests',
        'Review test names describe scenarios clearly',
        'Confirm mocks only cover external dependencies',
      ];
    case 'documentation':
      return [
        'Verify documentation matches current behavior',
        'Check all code examples compile and run',
        'Review for clarity and completeness',
        'Confirm links and cross-references are valid',
      ];
    case 'research':
      return [
        'Verify findings are documented with sources',
        'Check conclusions are actionable',
        'Review for completeness of scope',
      ];
    case 'review':
      return [
        'Verify all review comments are addressed',
        'Check that review feedback is incorporated',
        'Confirm no open questions remain',
      ];
    case 'infrastructure':
    case 'configuration':
    case 'migration':
      return [
        'Verify infrastructure changes deploy successfully',
        'Check monitoring and alerting are configured',
        'Run smoke tests in target environment',
        'Review rollback plan',
      ];
    case 'design':
      return [
        'Verify design document covers all requirements',
        'Check for consistency with existing architecture',
        'Review trade-offs and alternatives considered',
      ];
    default:
      return [
        'Verify implementation matches task description',
        'Run relevant tests',
        'Check for regressions',
      ];
  }
}

function formatHumanPlan(plan: VerificationPlan): string {
  const lines: string[] = [];

  lines.push(`Verification Plan: ${plan.taskId}`);
  lines.push(`Category: ${plan.category}`);
  lines.push('');

  if (plan.objective) {
    lines.push('Objective:');
    lines.push(`  ${plan.objective}`);
    lines.push('');
  }

  if (plan.dependencies.length > 0) {
    lines.push('Dependencies:');
    for (const dep of plan.dependencies) {
      const check = dep.status === 'done' ? '[x]' : '[ ]';
      lines.push(`  ${check} ${dep.displayId} (${dep.status})`);
    }
    lines.push('');
  }

  if (plan.decisions.length > 0) {
    lines.push('Decisions to consider:');
    for (const dec of plan.decisions) {
      lines.push(`  - ${dec.displayId}: ${dec.content}`);
    }
    lines.push('');
  }

  lines.push('Verification steps:');
  for (const step of plan.steps) {
    lines.push(`  [ ] ${step}`);
  }

  return lines.join('\n');
}

export function createVerifyCommand(): Command {
  const cmd = new Command('verify')
    .description('Generate verification plan for a task')
    .argument('<id>', 'Task display ID')
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

        const contextResult = assembleContext(svc.db, displayId);
        if (!contextResult.ok) {
          process.stderr.write(formatError(contextResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const bundle = contextResult.data;
        const task = taskResult.data;

        const acSteps = extractAcceptanceCriteria(bundle.body);

        const plan: VerificationPlan = {
          taskId: displayId,
          category: task.category,
          objective: bundle.prompt,
          dependencies: bundle.dependencies.map((d) => ({
            displayId: d.displayId,
            status: d.status,
          })),
          decisions: bundle.decisions.map((d) => ({
            displayId: d.displayId,
            content: d.content,
          })),
          steps: acSteps.length > 0 ? acSteps : suggestVerificationSteps(task.category),
        };

        if (opts.json) {
          process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
          return;
        }

        process.stdout.write(formatHumanPlan(plan) + '\n');
      });
    });
  return cmd as unknown as Command;
}
