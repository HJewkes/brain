import { BrainServiceClass } from '../src/services/brain-service.js';

async function main() {
  const svc = await BrainServiceClass.create();
  const rows = svc.db.rawDb
    .prepare(
      'SELECT id, status, error, current_step FROM workflow_runs ORDER BY started_at DESC LIMIT 5'
    )
    .all();
  console.log(JSON.stringify(rows, null, 2));
  svc.close();
}

main();
