import { BrainServiceClass } from '../src/services/brain-service.js';

async function main() {
  const svc = await BrainServiceClass.create();
  const row = svc.db.rawDb
    .prepare('SELECT * FROM workflow_runs WHERE id = ?')
    .get('fe547a93-46ed-40a1-b2b2-ecac54f3d671');
  console.log(JSON.stringify(row, null, 2));
  svc.close();
}

main();
