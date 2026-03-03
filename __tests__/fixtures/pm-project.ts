import type { BrainDB } from '../../src/services/brain-db.js';
import type { BrainConfig, Embedder } from '../../src/types.js';
import { createProject } from '../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../src/modules/pm/data/workstream-ops.js';
import { createTestTask } from '../helpers.js';

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
  const t1 = await createTestTask(db, config, embedder, {
    project: 'TEST',
    workstream: 1,
    name: 'Task 01.01',
    description: 'Set up the initial project scaffolding and configuration. This is the foundation task that all other tasks depend on.',
  });
  if (!t1.ok) throw new Error(`Failed to create TEST-01.01: ${t1.error.message}`);

  // TEST-01.02: depends on 01.01
  const t2 = await createTestTask(db, config, embedder, {
    project: 'TEST',
    workstream: 1,
    name: 'Task 01.02',
    description: 'Implement the core business logic for the Alpha workstream. Requires scaffolding from the foundation task to be complete.',
    dependsOn: ['TEST-01.01'],
  });
  if (!t2.ok) throw new Error(`Failed to create TEST-01.02: ${t2.error.message}`);

  // TEST-01.03: depends on 01.02
  const t3 = await createTestTask(db, config, embedder, {
    project: 'TEST',
    workstream: 1,
    name: 'Task 01.03',
    description: 'Write unit and integration tests for the Alpha workstream logic. Validates the core business implementation.',
    category: 'testing',
    dependsOn: ['TEST-01.02'],
  });
  if (!t3.ok) throw new Error(`Failed to create TEST-01.03: ${t3.error.message}`);

  // TEST-02.01: no deps
  const t4 = await createTestTask(db, config, embedder, {
    project: 'TEST',
    workstream: 2,
    name: 'Task 02.01',
    description: 'Initialize the Beta workstream environment and dependencies. Can proceed independently of the Alpha workstream.',
  });
  if (!t4.ok) throw new Error(`Failed to create TEST-02.01: ${t4.error.message}`);

  // TEST-02.02: depends on 01.01 and 02.01 (diamond)
  const t5 = await createTestTask(db, config, embedder, {
    project: 'TEST',
    workstream: 2,
    name: 'Task 02.02',
    description: 'Build the integration layer between Alpha and Beta workstreams. Requires both initial setup tasks to be complete.',
    dependsOn: ['TEST-01.01', 'TEST-02.01'],
  });
  if (!t5.ok) throw new Error(`Failed to create TEST-02.02: ${t5.error.message}`);

  // TEST-02.03: depends on 01.03 and 02.02 (deep chain)
  const t6 = await createTestTask(db, config, embedder, {
    project: 'TEST',
    workstream: 2,
    name: 'Task 02.03',
    description: 'Write end-to-end documentation covering both workstreams. Requires all testing and integration work to be finalized.',
    category: 'documentation',
    priority: 'low',
    dependsOn: ['TEST-01.03', 'TEST-02.02'],
  });
  if (!t6.ok) throw new Error(`Failed to create TEST-02.03: ${t6.error.message}`);
}
