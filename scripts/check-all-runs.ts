import { BrainServiceClass } from '../src/services/brain-service.js';

async function main() {
  const svc = await BrainServiceClass.create();
  const rows = svc.db.rawDb
    .prepare(
      'SELECT id, status, error, current_step, active_agent FROM workflow_runs ORDER BY started_at DESC LIMIT 10'
    )
    .all() as Array<Record<string, unknown>>;
  for (const r of rows) {
    const aa = r.active_agent ? JSON.parse(r.active_agent as string) : null;
    console.log(
      `${(r.id as string).slice(0, 8)} | ${r.status} | step=${r.current_step} | pid=${aa?.pid ?? 'none'} | ${(r.error as string)?.slice(0, 60) ?? ''}`
    );
  }
  svc.close();
}
main();
