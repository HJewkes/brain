/**
 * E2E test for the V2 workflow runtime.
 * Runs outside of MCP — starts the runtime directly, dispatches a real workflow,
 * and monitors until completion or failure.
 *
 * Usage: npx tsx scripts/test-v2-e2e.ts [low|medium|high] [--plan-id <id>]
 */
import { BrainServiceClass } from '../src/services/brain-service.js';
import { WorkflowRuntime } from '../src/modules/workflow/runtime/runtime.js';
import { workflows } from '../src/modules/workflow/flows/index.js';
import { workflowRuntimeMigrationV1 } from '../src/modules/workflow/runtime/migration.js';

const out = (msg: string) => process.stdout.write(msg + '\n');

async function main() {
  process.env.BRAIN_EXECUTOR_V2 = '1';

  const complexity = process.argv[2] ?? 'low';
  const planIdIdx = process.argv.indexOf('--plan-id');
  const planId = planIdIdx !== -1 ? process.argv[planIdIdx + 1] : `v2-e2e-${complexity}`;

  const svc = await BrainServiceClass.create();
  try {
    workflowRuntimeMigrationV1.up(svc.db.rawDb);
  } catch {
    /* already exists */
  }

  const events: Array<{ ts: number; event: string; meta: Record<string, string> }> = [];
  const runtime = new WorkflowRuntime({
    db: svc.db,
    config: svc.config,
    embedder: svc.embedder,
    channelPush: (event, meta) => {
      events.push({ ts: Date.now(), event, meta });
      out(`  [channel] ${event}: ${JSON.stringify(meta)}`);
    },
  });

  for (const [name, fn] of Object.entries(workflows)) {
    runtime.register(name, fn);
  }
  runtime.startReconciler();

  out('=== V2 Runtime E2E ===');
  out(`Complexity: ${complexity}`);
  out(`Plan ID:    ${planId}`);
  out('');

  const runId = await runtime.start('planning', {
    planId,
    complexity,
    project: 'VNM',
    workstream: '53',
  });
  out(`Run ID: ${runId}`);
  out('');

  const timeout = 30 * 60 * 1000; // 30 minutes (agents can be slow)
  const start = Date.now();
  let lastStep = '';
  let lastAgentPid = 0;

  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 5000));

    const status = runtime.getStatus(runId);
    if (!status) {
      out('ERROR: run not found');
      break;
    }

    const step = status.currentStep ?? '(none)';
    const agentPid = status.activeAgent?.pid ?? 0;

    // Print on step change or agent change
    if (step !== lastStep || agentPid !== lastAgentPid) {
      lastStep = step;
      lastAgentPid = agentPid;
      out(`[${elapsed(start)}] Step: ${step}  Status: ${status.status}`);
      out(`  Completed steps: ${Object.keys(status.stepResults).join(', ') || '(none)'}`);
      if (status.activeAgent) {
        out(`  Active agent: pid=${status.activeAgent.pid} task=${status.activeAgent.taskId}`);
      }
    }

    if (status.status === 'completed') {
      out('');
      out(`=== COMPLETED in ${elapsed(start)} ===`);
      out(`Steps: ${Object.keys(status.stepResults).join(', ')}`);
      printStepSummary(status.stepResults);
      out(`Channel events: ${events.length}`);
      break;
    }

    if (status.status === 'failed') {
      out('');
      out(`=== FAILED at ${elapsed(start)} ===`);
      out(`Error: ${status.error}`);
      out(`Current step: ${status.currentStep}`);
      out(`Completed: ${Object.keys(status.stepResults).join(', ')}`);
      break;
    }

    // Check agent liveness every poll
    if (status.activeAgent?.pid) {
      try {
        process.kill(status.activeAgent.pid, 0);
      } catch {
        out(`  [${elapsed(start)}] Agent PID ${status.activeAgent.pid} no longer alive`);
      }
    }
  }

  if (Date.now() - start >= timeout) {
    out(`\n=== TIMEOUT after ${elapsed(start)} ===`);
  }

  runtime.stopReconciler();
  svc.close();
}

function elapsed(start: number): string {
  const s = Math.round((Date.now() - start) / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

function printStepSummary(results: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(results)) {
    const r = value as { signal?: string | null; completedAt?: string };
    out(`  ${key}: signal=${r.signal ?? 'none'} completed=${r.completedAt ?? '?'}`);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
