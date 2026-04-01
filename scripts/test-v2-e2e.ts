/**
 * E2E test for the V2 workflow runtime.
 * Runs outside of MCP — starts the runtime directly, dispatches a real workflow,
 * and monitors until completion or failure.
 */
import { BrainServiceClass } from '../src/services/brain-service.js';
import { WorkflowRuntime } from '../src/modules/workflow/runtime/runtime.js';
import { workflows } from '../src/modules/workflow/flows/index.js';
import { workflowRuntimeMigrationV1 } from '../src/modules/workflow/runtime/migration.js';

async function main() {
  process.env.BRAIN_EXECUTOR_V2 = '1';

  const svc = await BrainServiceClass.create();
  workflowRuntimeMigrationV1.up(svc.db.rawDb);

  const events: string[] = [];
  const runtime = new WorkflowRuntime({
    db: svc.db,
    config: svc.config,
    embedder: svc.embedder,
    channelPush: (event, meta) => {
      const msg = `[channel] ${event}: ${JSON.stringify(meta)}`;
      events.push(msg);
      console.log(msg);
    },
  });

  for (const [name, fn] of Object.entries(workflows)) {
    runtime.register(name, fn);
  }
  runtime.startReconciler();

  console.log('=== V2 E2E Test ===');
  console.log('Starting planning workflow (medium complexity)...\n');

  const runId = await runtime.start('planning', {
    planId: 'v2-e2e-test',
    complexity: 'medium',
    project: 'VNM',
    workstream: '53',
  });
  console.log('Run ID:', runId);

  // Poll until done or timeout
  const timeout = 10 * 60 * 1000; // 10 minutes
  const start = Date.now();
  let lastStep = '';

  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 5000));

    const status = runtime.getStatus(runId);
    if (!status) {
      console.log('ERROR: run not found');
      break;
    }

    if (status.currentStep !== lastStep) {
      lastStep = status.currentStep ?? '';
      console.log(`\n[${elapsed(start)}] Step: ${lastStep || '(none)'}`);
      console.log(`  Status: ${status.status}`);
      console.log(`  Completed: ${Object.keys(status.stepResults).length} steps`);
      if (status.activeAgent) {
        console.log(`  Agent: pid=${status.activeAgent.pid} task=${status.activeAgent.taskId}`);
      }
    }

    if (status.status === 'completed') {
      console.log(`\n=== WORKFLOW COMPLETED in ${elapsed(start)} ===`);
      console.log('Steps completed:', Object.keys(status.stepResults).join(', '));
      console.log('Channel events:', events.length);
      break;
    }

    if (status.status === 'failed') {
      console.log(`\n=== WORKFLOW FAILED at ${elapsed(start)} ===`);
      console.log('Error:', status.error);
      console.log('Current step:', status.currentStep);
      console.log('Steps completed:', Object.keys(status.stepResults).join(', '));
      break;
    }

    // Check agent liveness
    if (status.activeAgent?.pid) {
      try {
        process.kill(status.activeAgent.pid, 0);
      } catch {
        console.log(`  [${elapsed(start)}] Agent PID ${status.activeAgent.pid} is dead`);
      }
    }
  }

  runtime.stopReconciler();
  svc.close();
}

function elapsed(start: number): string {
  const s = Math.round((Date.now() - start) / 1000);
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
