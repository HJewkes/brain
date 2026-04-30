import { BrainServiceClass } from '../src/services/brain-service.js';
import { WorkflowRuntime } from '../src/modules/workflow/runtime/runtime.js';
import { workflows } from '../src/modules/workflow/flows/index.js';
import { workflowRuntimeMigrationV1 } from '../src/modules/workflow/runtime/migration.js';

async function main() {
  const svc = await BrainServiceClass.create();
  workflowRuntimeMigrationV1.up(svc.db.rawDb);

  const runtime = new WorkflowRuntime({
    db: svc.db,
    config: svc.config,
    embedder: svc.embedder,
    channelPush: (event, meta) => {
      console.log('[channel]', event, JSON.stringify(meta));
    },
  });

  for (const [name, fn] of Object.entries(workflows)) {
    runtime.register(name, fn);
  }

  console.log('Registered workflows:', Object.keys(workflows));
  console.log('Starting planning workflow (medium complexity)...');

  try {
    const runId = await runtime.start('planning', {
      planId: 'v2-direct-test',
      complexity: 'medium',
      project: 'VNM',
      workstream: '53',
    });
    console.log('Run ID:', runId);

    const timeoutMs = 10000;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Workflow timed out after ${timeoutMs}ms`)), timeoutMs)
    );
    await Promise.race([runtime.waitForCompletion(runId), timeout]);

    const status = runtime.getStatus(runId);
    console.log('Status:', JSON.stringify(status, null, 2));

    // Meaningful pass/fail output
    if (status.status === 'completed') {
      console.log('✓ Workflow completed successfully');
      process.exit(0);
    } else if (status.status === 'failed') {
      console.log('✗ Workflow failed');
      console.log('Error:', status.error);
      process.exit(1);
    } else {
      console.log('⚠ Workflow status:', status.status);
      process.exit(1);
    }
  } catch (err) {
    console.error('✗ Error:', err);
    process.exit(1);
  }

  svc.close();
}

main();
