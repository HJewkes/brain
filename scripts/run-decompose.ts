#!/usr/bin/env npx tsx
/**
 * One-shot script: start workflow runtime, run planning-decompose step,
 * wait for agent completion, then exit.
 *
 * Usage: npx tsx scripts/run-decompose.ts [--dry-run]
 */

import { getSharedInstance } from '../src/services/brain-service.js';
import { WorkflowRuntime } from '../src/modules/workflow/runtime/runtime.js';
import { singleStepWorkflow } from '../src/modules/workflow/flows/single-step.js';
import { workflowRuntimeMigrationV1 } from '../src/modules/workflow/runtime/migration.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  process.stderr.write('Initializing brain service...\n');
  const svc = await getSharedInstance();
  process.stderr.write('Service initialized.\n');

  workflowRuntimeMigrationV1.up(svc.db.rawDb);
  process.stderr.write('Migration applied.\n');

  const runtime = new WorkflowRuntime({
    db: svc.db,
    config: svc.config,
    embedder: svc.embedder,
    channelPush: (event, meta) => {
      process.stderr.write(`[workflow] ${event}: ${JSON.stringify(meta)}\n`);
    },
    model: 'sonnet',
    maxBudgetUsd: 5.0,
  });

  runtime.register('step', singleStepWorkflow);
  runtime.startReconciler();
  process.stderr.write('Runtime ready (reconciler active).\n');

  if (dryRun) {
    process.stderr.write('DRY RUN — would start: step workflow with template=planning-decompose\n');
    process.exit(0);
  }

  process.stderr.write('Starting workflow...\n');
  const runId = await runtime.start('step', {
    template: 'planning-decompose',
    planId: 'post-execution-analysis',
    project: 'VNM',
    workstream: '34',
    projectDir: process.cwd(),
  });

  process.stderr.write(`Started workflow run: ${runId}\n`);
  process.stderr.write('Waiting for agent to complete (this may take several minutes)...\n');

  await runtime.waitForCompletion(runId);

  const status = runtime.getStatus(runId);
  if (!status) {
    process.stderr.write('Workflow run not found after completion\n');
    process.exit(1);
  }

  process.stderr.write(`\nWorkflow ${status.status}\n`);
  if (status.error) {
    process.stderr.write(`Error: ${status.error}\n`);
  }

  for (const [key, step] of Object.entries(status.stepResults)) {
    process.stderr.write(`\nStep ${key}: task=${step.taskId} signal=${step.signal ?? 'none'}\n`);
    if (step.output) {
      process.stdout.write(step.output + '\n');
    }
  }

  runtime.stopReconciler();
  process.exit(status.status === 'completed' ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  if (err.stack) process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
