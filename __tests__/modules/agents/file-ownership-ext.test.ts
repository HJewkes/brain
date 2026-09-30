import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainDB } from '../../../src/services/brain-db.js';
import { createMockEmbedder, createTestDb, createTestTask } from '../../helpers.js';
import { createProject } from '../../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../../src/modules/pm/data/workstream-ops.js';
import type { BrainConfig } from '../../../src/types.js';
import { extractPathReferences } from '../../../src/modules/agents/extensions/file-ownership-ext.js';
import { fileOwnershipExtension } from '../../../src/modules/agents/extensions/file-ownership-ext.js';
import { createAgent, updateAgentStatus } from '../../../src/modules/agents/data.js';
import {
  agentsMigrationV1,
  agentsMigrationV2,
  agentsMigrationV3,
  agentsMigrationV4,
} from '../../../src/modules/agents/schema.js';

const embedder = createMockEmbedder();

describe('extractPathReferences', () => {
  it('extracts src/ paths', () => {
    const text = 'Modify src/modules/pm/commands/dispatch.ts and src/services/search.ts';
    const paths = extractPathReferences(text);
    expect(paths).toContain('src/modules/pm/commands/dispatch.ts');
    expect(paths).toContain('src/services/search.ts');
  });

  it('extracts __tests__/ paths', () => {
    const text = 'Add test at __tests__/modules/pm/foo.test.ts';
    const paths = extractPathReferences(text);
    expect(paths).toContain('__tests__/modules/pm/foo.test.ts');
  });

  it('extracts templates/ paths', () => {
    const text = 'Create templates/agents/worker.md';
    const paths = extractPathReferences(text);
    expect(paths).toContain('templates/agents/worker.md');
  });

  it('extracts paths from backtick code spans', () => {
    const text = 'Update `src/cli.ts` to add the new command';
    const paths = extractPathReferences(text);
    expect(paths).toContain('src/cli.ts');
  });

  it('deduplicates repeated paths', () => {
    const text = 'src/foo.ts and src/foo.ts again';
    const paths = extractPathReferences(text);
    expect(paths).toEqual(['src/foo.ts']);
  });

  it('returns empty for text without paths', () => {
    const paths = extractPathReferences('No file paths here at all');
    expect(paths).toEqual([]);
  });

  it('extracts directory paths', () => {
    const text = 'Files in src/modules/agents/ directory';
    const paths = extractPathReferences(text);
    expect(paths).toContain('src/modules/agents/');
  });
});

describe('fileOwnershipExtension.compute', () => {
  let db: BrainDB;
  let config: BrainConfig;

  beforeEach(async () => {
    ({ db } = createTestDb());
    config = {
      notesDir: '/tmp/test-ownership',
      dbPath: ':memory:',
      embedder: 'local',
    };

    // Ensure agents tables exist (template DB doesn't include them)
    const rawDb = (db as unknown as { db: unknown }).db;
    agentsMigrationV1.up(rawDb);
    agentsMigrationV2.up(rawDb);
    agentsMigrationV3.up(rawDb);
    agentsMigrationV4.up(rawDb);

    await createProject(db, config, embedder, { name: 'Test', prefix: 'OWN' });
    await createWorkstream(db, config, embedder, { project: 'OWN', name: 'Alpha' });
  });

  afterEach(() => {
    db.close();
  });

  it('returns undefined when task not found', () => {
    const result = fileOwnershipExtension.compute({
      db,
      taskDisplayId: 'NOPE-99.99',
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when no path references in descriptions', async () => {
    await createTestTask(db, config, embedder, {
      project: 'OWN',
      workstream: 1,
      name: 'Task with no paths',
      description: 'This task has no file references at all',
    });

    const result = fileOwnershipExtension.compute({
      db,
      taskDisplayId: 'OWN-01.01',
    });
    expect(result).toBeUndefined();
  });

  it('computes ownership from path references in description', async () => {
    await createTestTask(db, config, embedder, {
      project: 'OWN',
      workstream: 1,
      name: 'Modify dispatch',
      description: 'Update src/modules/pm/commands/dispatch.ts to add render-prompt',
    });

    const result = fileOwnershipExtension.compute({
      db,
      taskDisplayId: 'OWN-01.01',
    });
    expect(result).toBeDefined();
    expect(result!.rules).toHaveLength(1);
    expect(result!.rules[0].agentId).toBe('OWN-01.01');
    expect(result!.rules[0].patterns).toContain('src/modules/pm/commands/dispatch.ts');
  });

  it('does NOT include peer scope when peer has no in-flight agent (solo dispatch)', async () => {
    // Two tasks in the same workstream — but no agents are dispatched.
    // Solo dispatch of OWN-01.01 should give it full scope from its own description.
    await createTestTask(db, config, embedder, {
      project: 'OWN',
      workstream: 1,
      name: 'Worker A',
      description: 'Modify src/services/search.ts for improved results',
    });
    await createTestTask(db, config, embedder, {
      project: 'OWN',
      workstream: 1,
      name: 'Worker B',
      description: 'Modify src/services/graph.ts for better traversal',
    });

    const result = fileOwnershipExtension.compute({
      db,
      taskDisplayId: 'OWN-01.01',
    });
    expect(result).toBeDefined();
    expect(result!.rules).toHaveLength(1);

    const agentA = result!.rules.find((r) => r.agentId === 'OWN-01.01');
    expect(agentA).toBeDefined();
    expect(agentA!.patterns).toContain('src/services/search.ts');
    // Peer not included because OWN-01.02 has no in-flight agent
    const agentB = result!.rules.find((r) => r.agentId === 'OWN-01.02');
    expect(agentB).toBeUndefined();
  });

  it('subtracts peer scope when peer has an in-flight agent', async () => {
    await createTestTask(db, config, embedder, {
      project: 'OWN',
      workstream: 1,
      name: 'Worker A',
      description: 'Modify src/services/search.ts for improved results',
    });
    await createTestTask(db, config, embedder, {
      project: 'OWN',
      workstream: 1,
      name: 'Worker B',
      description: 'Modify src/services/graph.ts for better traversal',
    });

    // Mark OWN-01.02 as in-flight
    const peerAgentId = createAgent(db, {
      name: 'peer',
      parent: 'test',
      brain_task: 'OWN-01.02',
    });
    updateAgentStatus(db, peerAgentId, 'active', { pid: 9999 });

    const result = fileOwnershipExtension.compute({
      db,
      taskDisplayId: 'OWN-01.01',
    });
    expect(result).toBeDefined();
    expect(result!.rules).toHaveLength(2);

    const agentA = result!.rules.find((r) => r.agentId === 'OWN-01.01');
    const agentB = result!.rules.find((r) => r.agentId === 'OWN-01.02');
    expect(agentA!.patterns).toContain('src/services/search.ts');
    expect(agentB!.patterns).toContain('src/services/graph.ts');
  });

  it('ignores peers whose agents are in terminal status', async () => {
    await createTestTask(db, config, embedder, {
      project: 'OWN',
      workstream: 1,
      name: 'Worker A',
      description: 'Modify src/services/search.ts',
    });
    await createTestTask(db, config, embedder, {
      project: 'OWN',
      workstream: 1,
      name: 'Worker B',
      description: 'Modify src/services/graph.ts',
    });

    // Peer agent already finished — should NOT subtract scope
    const peerAgentId = createAgent(db, {
      name: 'peer',
      parent: 'test',
      brain_task: 'OWN-01.02',
    });
    updateAgentStatus(db, peerAgentId, 'completed', { exit_reason: 'done' });

    const result = fileOwnershipExtension.compute({
      db,
      taskDisplayId: 'OWN-01.01',
    });
    expect(result!.rules).toHaveLength(1);
    expect(result!.rules[0].agentId).toBe('OWN-01.01');
  });

  it('resolves conflicts by prioritizing current task when peer is in-flight', async () => {
    await createTestTask(db, config, embedder, {
      project: 'OWN',
      workstream: 1,
      name: 'Worker A',
      description: 'Modify src/shared.ts for feature A',
    });
    await createTestTask(db, config, embedder, {
      project: 'OWN',
      workstream: 1,
      name: 'Worker B',
      description: 'Modify src/shared.ts for feature B',
    });

    const peerAgentId = createAgent(db, {
      name: 'peer',
      parent: 'test',
      brain_task: 'OWN-01.02',
    });
    updateAgentStatus(db, peerAgentId, 'active', { pid: 9999 });

    const result = fileOwnershipExtension.compute({
      db,
      taskDisplayId: 'OWN-01.01',
    });
    expect(result).toBeDefined();

    // Current task keeps the conflicting pattern, peer loses it
    const agentA = result!.rules.find((r) => r.agentId === 'OWN-01.01');
    const agentB = result!.rules.find((r) => r.agentId === 'OWN-01.02');
    expect(agentA).toBeDefined();
    expect(agentA!.patterns).toContain('src/shared.ts');
    if (agentB) {
      expect(agentB.patterns).not.toContain('src/shared.ts');
    }
  });
});

describe('fileOwnershipExtension.format', () => {
  it('returns null for falsy data', () => {
    expect(fileOwnershipExtension.format(undefined, 'X-01.01')).toBeNull();
    expect(fileOwnershipExtension.format(null, 'X-01.01')).toBeNull();
  });

  it('formats ownership brief for a task', () => {
    const manifest = {
      rules: [
        { agentId: 'X-01.01', patterns: ['src/foo.ts'] },
        { agentId: 'X-01.02', patterns: ['src/bar.ts'] },
      ],
    };
    const result = fileOwnershipExtension.format(manifest, 'X-01.01');
    expect(result).toContain('src/foo.ts');
    expect(result).toContain('Read-only');
    expect(result).toContain('src/bar.ts');
  });
});
