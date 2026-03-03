import type { BrainDB } from '../../src/services/brain-db.js';
import type { BrainConfig, Embedder } from '../../src/types.js';
import { createProject } from '../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../src/modules/pm/data/workstream-ops.js';
import { createTask } from '../../src/modules/pm/data/task-ops.js';

// Creates: Project TEST, 2 workstreams, 6 tasks
// TEST-01.01 (pending, no deps)              — immediately +READY
// TEST-01.02 (pending, depends on 01.01)
// TEST-01.03 (pending, depends on 01.02)
// TEST-02.01 (pending, no deps)              — immediately +READY
// TEST-02.02 (pending, depends on 01.01, 02.01) — diamond
// TEST-02.03 (pending, depends on 01.03, 02.02) — deep chain

export async function createStandardProject(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder
): Promise<void> {
  const project = await createProject(db, config, embedder, {
    name: 'Test Project',
    prefix: 'TEST',
  });
  if (!project.ok) throw new Error(`Failed to create project: ${project.error.message}`);

  const ws1 = await createWorkstream(db, config, embedder, {
    project: 'TEST',
    name: 'Alpha',
  });
  if (!ws1.ok) throw new Error(`Failed to create workstream 1: ${ws1.error.message}`);

  const ws2 = await createWorkstream(db, config, embedder, {
    project: 'TEST',
    name: 'Beta',
  });
  if (!ws2.ok) throw new Error(`Failed to create workstream 2: ${ws2.error.message}`);

  // TEST-01.01: no deps
  const t1 = await createTask(db, config, embedder, {
    project: 'TEST',
    workstream: 1,
    name: 'Task 01.01',
  });
  if (!t1.ok) throw new Error(`Failed to create TEST-01.01: ${t1.error.message}`);

  // TEST-01.02: depends on 01.01
  const t2 = await createTask(db, config, embedder, {
    project: 'TEST',
    workstream: 1,
    name: 'Task 01.02',
    dependsOn: ['TEST-01.01'],
  });
  if (!t2.ok) throw new Error(`Failed to create TEST-01.02: ${t2.error.message}`);

  // TEST-01.03: depends on 01.02
  const t3 = await createTask(db, config, embedder, {
    project: 'TEST',
    workstream: 1,
    name: 'Task 01.03',
    dependsOn: ['TEST-01.02'],
  });
  if (!t3.ok) throw new Error(`Failed to create TEST-01.03: ${t3.error.message}`);

  // TEST-02.01: no deps
  const t4 = await createTask(db, config, embedder, {
    project: 'TEST',
    workstream: 2,
    name: 'Task 02.01',
  });
  if (!t4.ok) throw new Error(`Failed to create TEST-02.01: ${t4.error.message}`);

  // TEST-02.02: depends on 01.01 and 02.01 (diamond)
  const t5 = await createTask(db, config, embedder, {
    project: 'TEST',
    workstream: 2,
    name: 'Task 02.02',
    dependsOn: ['TEST-01.01', 'TEST-02.01'],
  });
  if (!t5.ok) throw new Error(`Failed to create TEST-02.02: ${t5.error.message}`);

  // TEST-02.03: depends on 01.03 and 02.02 (deep chain)
  const t6 = await createTask(db, config, embedder, {
    project: 'TEST',
    workstream: 2,
    name: 'Task 02.03',
    dependsOn: ['TEST-01.03', 'TEST-02.02'],
  });
  if (!t6.ok) throw new Error(`Failed to create TEST-02.03: ${t6.error.message}`);
}
