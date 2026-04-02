/**
 * E2E test for the V2 workflow runtime.
 * Runs outside of MCP — starts the runtime directly, dispatches a real workflow,
 * and monitors until completion or failure.
 *
 * Usage:
 *   npx tsx scripts/test-v2-e2e.ts [low|medium|high]         # planning workflow
 *   npx tsx scripts/test-v2-e2e.ts --workflow implementation  # other workflows
 *   npx tsx scripts/test-v2-e2e.ts --plan-id my-test         # custom plan ID
 *   npx tsx scripts/test-v2-e2e.ts --timeout 60              # timeout in minutes
 *   npx tsx scripts/test-v2-e2e.ts --list                    # list available workflows
 */
import { BrainServiceClass } from '../src/services/brain-service.js';
import { WorkflowRuntime } from '../src/modules/workflow/runtime/runtime.js';
import { workflows } from '../src/modules/workflow/flows/index.js';
import { workflowRuntimeMigrationV1 } from '../src/modules/workflow/runtime/migration.js';

const out = (msg: string) => process.stdout.write(msg + '\n');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--list') {
      out('Available workflows:');
      for (const name of Object.keys(workflows)) out(`  ${name}`);
      process.exit(0);
    }
    if (args[i].startsWith('--') && i + 1 < args.length) {
      opts[args[i].slice(2)] = args[++i];
    } else if (!args[i].startsWith('--')) {
      opts.complexity = args[i];
    }
  }

  return {
    workflow: opts.workflow ?? 'planning',
    complexity: opts.complexity ?? 'low',
    planId: opts['plan-id'] ?? `v2-e2e-${opts.workflow ?? 'planning'}-${Date.now().toString(36)}`,
    timeoutMin: parseInt(opts.timeout ?? '60', 10),
    project: opts.project ?? 'VNM',
    workstream: opts.workstream ?? '53',
  };
}

async function main() {
  const opts = parseArgs();

  if (!workflows[opts.workflow]) {
    out(`Unknown workflow: ${opts.workflow}`);
    out(`Available: ${Object.keys(workflows).join(', ')}`);
    process.exit(1);
  }

  const svc = await BrainServiceClass.create();
  try {
    workflowRuntimeMigrationV1.up(svc.db.rawDb);
  } catch {
    /* already exists */
  }

  const stepTimings: Record<string, { start: number; end?: number }> = {};
  const events: Array<{ ts: number; event: string; meta: Record<string, string> }> = [];
  const runtime = new WorkflowRuntime({
    db: svc.db,
    config: svc.config,
    embedder: svc.embedder,
    channelPush: (event, meta) => {
      events.push({ ts: Date.now(), event, meta });
      out(`  [channel] ${event}: ${JSON.stringify(meta)}`);
      if (event === 'step_complete' && meta.step) {
        const key = meta.step;
        if (stepTimings[key]) stepTimings[key].end = Date.now();
      }
    },
  });

  for (const [name, fn] of Object.entries(workflows)) {
    runtime.register(name, fn);
  }
  runtime.startReconciler();

  out('=== V2 Runtime E2E ===');
  out(`Workflow:   ${opts.workflow}`);
  out(`Complexity: ${opts.complexity}`);
  out(`Plan ID:    ${opts.planId}`);
  out(`Timeout:    ${opts.timeoutMin}m`);
  out('');

  const params: Record<string, string> = {
    planId: opts.planId,
    complexity: opts.complexity,
    project: opts.project,
    workstream: opts.workstream,
  };

  const runId = await runtime.start(opts.workflow, params);
  out(`Run ID: ${runId}`);
  out('');

  const timeout = opts.timeoutMin * 60 * 1000;
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

    if (step !== lastStep || agentPid !== lastAgentPid) {
      lastStep = step;
      lastAgentPid = agentPid;
      out(`[${elapsed(start)}] Step: ${step}  Status: ${status.status}`);
      out(`  Completed steps: ${Object.keys(status.stepResults).join(', ') || '(none)'}`);
      if (status.activeAgent) {
        out(`  Active agent: pid=${status.activeAgent.pid} task=${status.activeAgent.taskId}`);
        if (!stepTimings[step]) stepTimings[step] = { start: Date.now() };
      }
    }

    if (status.status === 'completed') {
      out('');
      out(`=== COMPLETED in ${elapsed(start)} ===`);
      out(`Steps: ${Object.keys(status.stepResults).join(', ')}`);
      printStepSummary(status.stepResults);
      printTimings(stepTimings);
      out(`Channel events: ${events.length}`);
      break;
    }

    if (status.status === 'failed') {
      out('');
      out(`=== FAILED at ${elapsed(start)} ===`);
      out(`Error: ${status.error}`);
      out(`Current step: ${status.currentStep}`);
      out(`Completed: ${Object.keys(status.stepResults).join(', ')}`);
      printTimings(stepTimings);
      break;
    }

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
    printTimings(stepTimings);
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

function printTimings(timings: Record<string, { start: number; end?: number }>): void {
  const entries = Object.entries(timings);
  if (entries.length === 0) return;
  out('\nStep timings:');
  for (const [step, t] of entries) {
    const dur = t.end ? `${Math.round((t.end - t.start) / 1000)}s` : 'running';
    out(`  ${step}: ${dur}`);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
