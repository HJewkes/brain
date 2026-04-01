import { BrainServiceClass } from '../src/services/brain-service.js';

async function main() {
  const svc = await BrainServiceClass.create();
  const agents = svc.agentList();
  const recent = agents.filter((a) => a.brain_task?.startsWith('VNM-53.5'));
  for (const a of recent) {
    console.log(
      JSON.stringify({
        name: a.name,
        status: a.status,
        task: a.brain_task,
        exit: a.exit_reason,
        pid: a.pid,
        summary: a.summary?.slice(0, 200),
      })
    );
  }
  svc.close();
}

main();
