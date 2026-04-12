import { withDb } from '../src/services/brain-service.js';
import { getPmNotes } from '../src/modules/pm/data/queries.js';

// Matches workflow-generated step tasks:
// "planning:research (run abc123)", "step:planning-decompose (run ...)", "wave-execution:..."
// AND planning instance tasks: "[planning] Research", "[planning] Design", etc.
const ZOMBIE_PATTERNS = [
  /^planning:/,
  /^step:/,
  /^wave-execution:/,
  /^\[planning\]\s/,
];

function isZombie(name: string, status: string): boolean {
  if (!['claimed', 'in-progress', 'pending'].includes(status)) return false;
  return ZOMBIE_PATTERNS.some((p) => p.test(name));
}

async function main() {
  await withDb(async (svc) => {
    const rawDb = svc.db.rawDb;
    const allTasks = getPmNotes(svc.db, 'task');
    console.log(`Total PM tasks: ${allTasks.length}`);

    const zombies: { id: string; displayId: string; name: string; status: string }[] = [];

    for (const note of allTasks) {
      if (!note.metadata) continue;
      const meta = JSON.parse(note.metadata) as Record<string, unknown>;
      const name = (meta.name ?? meta.title ?? '') as string;
      const status = meta.status as string;
      const displayId = meta.display_id as string;

      if (isZombie(name, status)) {
        zombies.push({ id: note.id, displayId, name, status });
      }
    }

    console.log(`Found ${zombies.length} zombie workflow step tasks`);

    const byStatus: Record<string, number> = {};
    for (const z of zombies) {
      byStatus[z.status] = (byStatus[z.status] || 0) + 1;
    }
    console.log('By status:', JSON.stringify(byStatus));

    if (zombies.length === 0) {
      console.log('Nothing to clean up');
      return;
    }

    console.log('\nSample:');
    for (const z of zombies.slice(0, 8)) {
      console.log(`  ${z.displayId} [${z.status}] ${z.name}`);
    }

    const updateStmt = rawDb.prepare(
      `UPDATE notes SET metadata = json_set(metadata, '$.status', 'cancelled') WHERE id = ?`
    );

    const tx = rawDb.transaction(() => {
      for (const z of zombies) {
        updateStmt.run(z.id);
      }
    });
    tx();

    console.log(`\nCancelled ${zombies.length} zombie tasks`);
  });
}

main().catch(console.error);
