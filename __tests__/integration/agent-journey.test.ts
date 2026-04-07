/**
 * Agent journey integration tests.
 *
 * Simulates actual agent workflows using brain data layer functions directly.
 * Focuses on failure modes that trip up LLM agents: hallucinated IDs, wrong
 * field names, invalid state transitions, and stale claim tokens.
 *
 * Test paths:
 *   1. Agent discovers tasks via pullNextTask, claims, works, completes
 *   2. Agent queries search and captures notes to inbox
 *   3. Coordinator dispatches tasks, monitors via agent records
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BrainDB } from '../../src/services/brain-db.js';
import { loadModules } from '../../src/modules/loader.js';
import { createTestDb, createMockEmbedder, createTestTask } from '../helpers.js';
import type { BrainConfig } from '../../src/types.js';
import { pmModule } from '../../src/modules/pm/index.js';
import { agentsModule } from '../../src/modules/agents/index.js';
import { runModuleMigrations } from '../../src/modules/loader.js';
import { createProject } from '../../src/modules/pm/data/project-ops.js';
import { createWorkstream } from '../../src/modules/pm/data/workstream-ops.js';
import { getTask, updateTaskStatus } from '../../src/modules/pm/data/task-ops.js';
import { computeEligible } from '../../src/modules/pm/engine/dependency.js';
import { pullNextTask } from '../../src/modules/agents/task-pull.js';
import {
  parseCompletionMessage,
  handleCompletion,
  isCompletionMessage,
} from '../../src/modules/agents/completion-protocol.js';
import { buildAgentDispatchContext } from '../../src/modules/agents/dispatch-context.js';
import { createAgent, getAgent, listAgents } from '../../src/modules/agents/data.js';
import { validateClaimToken, isClaimStale } from '../../src/modules/pm/engine/claims.js';
import type { TaskStatus } from '../../src/modules/pm/types.js';

let db: BrainDB;
let notesDir: string;
let config: BrainConfig;
const embedder = createMockEmbedder();

beforeEach(async () => {
  ({ db } = createTestDb());
  db.setEmbeddingModel(embedder.model, embedder.dimensions);

  notesDir = join(tmpdir(), `agent-journey-${randomUUID()}`);
  mkdirSync(notesDir, { recursive: true });

  config = {
    notesDir,
    dbPath: '',
    embedder: 'local',
    fusionWeights: { bm25: 0.3, vector: 0.7 },
  };

  const { registry } = await loadModules({ modules: [pmModule, agentsModule] });
  runModuleMigrations(registry, db.rawDb, new Map());

  await createProject(db, config, embedder, { name: 'Agent Test', prefix: 'AT' });
  await createWorkstream(db, config, embedder, { project: 'AT', name: 'Main' });
});

afterEach(() => {
  db.close();
  if (existsSync(notesDir)) {
    rmSync(notesDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Path 1: Agent discovers → claims → works → completes
// ---------------------------------------------------------------------------

describe('Path 1: task discovery and completion lifecycle', () => {
  beforeEach(async () => {
    await createTestTask(db, config, embedder, {
      project: 'AT',
      workstream: 1,
      name: 'First task',
      description: 'Implement the first feature',
    });
    await createTestTask(db, config, embedder, {
      project: 'AT',
      workstream: 1,
      name: 'Second task',
      description: 'Implement the second feature',
      dependsOn: ['AT-01.01'],
    });
  });

  it('pullNextTask returns the highest-priority eligible task with a claim token', async () => {
    const result = await pullNextTask(db, config, embedder, { projectDir: notesDir });

    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('AT-01.01');
    expect(result!.claimToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(result!.dispatchContext).toBeDefined();
  });

  it('pullNextTask marks the task as claimed, blocking a second pull of the same task', async () => {
    const first = await pullNextTask(db, config, embedder, { projectDir: notesDir });
    expect(first).not.toBeNull();
    expect(first!.taskId).toBe('AT-01.01');

    // Dependent task is not yet eligible; with the first task claimed the queue is empty
    const second = await pullNextTask(db, config, embedder, { projectDir: notesDir });
    expect(second).toBeNull();
  });

  it('agent completes task and unlocks dependent', async () => {
    const pulled = await pullNextTask(db, config, embedder, { projectDir: notesDir });
    expect(pulled).not.toBeNull();

    // Transition: claimed → in-progress → done
    await updateTaskStatus(db, config, embedder, 'AT-01.01', 'in-progress' as TaskStatus);

    const msg = parseCompletionMessage('DONE AT-01.01 First feature implemented');
    expect(msg).not.toBeNull();

    const result = await handleCompletion(db, config, embedder, msg!);
    expect(result.status).toBe('done');
    expect(result.newlyEligible).toContain('AT-01.02');

    const eligible = computeEligible(db, 'AT');
    expect(eligible).toContain('AT-01.02');
    expect(eligible).not.toContain('AT-01.01');
  });

  it('agent completion advances all three tasks in a dependency chain', async () => {
    await createTestTask(db, config, embedder, {
      project: 'AT',
      workstream: 1,
      name: 'Third task',
      description: 'Final integration',
      dependsOn: ['AT-01.02'],
    });

    // Wave 0
    let pulled = await pullNextTask(db, config, embedder, { projectDir: notesDir });
    expect(pulled!.taskId).toBe('AT-01.01');
    await updateTaskStatus(db, config, embedder, 'AT-01.01', 'in-progress' as TaskStatus);
    await handleCompletion(db, config, embedder, {
      status: 'done',
      taskId: 'AT-01.01',
      summary: '',
    });

    // Wave 1
    pulled = await pullNextTask(db, config, embedder, { projectDir: notesDir });
    expect(pulled!.taskId).toBe('AT-01.02');
    await updateTaskStatus(db, config, embedder, 'AT-01.02', 'in-progress' as TaskStatus);
    await handleCompletion(db, config, embedder, {
      status: 'done',
      taskId: 'AT-01.02',
      summary: '',
    });

    // Wave 2
    pulled = await pullNextTask(db, config, embedder, { projectDir: notesDir });
    expect(pulled!.taskId).toBe('AT-01.03');
    await updateTaskStatus(db, config, embedder, 'AT-01.03', 'in-progress' as TaskStatus);
    await handleCompletion(db, config, embedder, {
      status: 'done',
      taskId: 'AT-01.03',
      summary: '',
    });

    expect(computeEligible(db, 'AT')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Path 2: Agent queries search, captures notes
// ---------------------------------------------------------------------------

describe('Path 2: search and capture', () => {
  it('db.addInboxItem captures a note and retrieves it', () => {
    db.addInboxItem({
      id: randomUUID(),
      content: 'Discovered that the retry logic needs exponential backoff',
      title: 'Retry logic finding',
      source: 'agent',
      sourceUrl: null,
      sourceMeta: JSON.stringify({ agentId: 'agent-001', taskId: 'AT-01.01' }),
      status: 'pending',
      createdAt: new Date().toISOString(),
      processedAt: null,
    });

    const items = db.getInboxItems('pending');
    expect(items.length).toBeGreaterThanOrEqual(1);

    const captured = items.find((i) => i.title === 'Retry logic finding');
    expect(captured).toBeDefined();
    expect(captured!.source).toBe('agent');
  });

  it('multiple captures accumulate independently', () => {
    for (let i = 0; i < 3; i++) {
      db.addInboxItem({
        id: randomUUID(),
        content: `Finding number ${i}`,
        title: `Finding ${i}`,
        source: 'agent',
        sourceUrl: null,
        sourceMeta: null,
        status: 'pending',
        createdAt: new Date().toISOString(),
        processedAt: null,
      });
    }

    const items = db.getInboxItems('pending');
    const agentItems = items.filter((i) => i.source === 'agent');
    expect(agentItems.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Path 3: Coordinator dispatches tasks, monitors via agent records
// ---------------------------------------------------------------------------

describe('Path 3: coordinator dispatch and agent monitoring', () => {
  beforeEach(async () => {
    await createTestTask(db, config, embedder, {
      project: 'AT',
      workstream: 1,
      name: 'Parallel A',
      description: 'Work on module A',
    });
    await createTestTask(db, config, embedder, {
      project: 'AT',
      workstream: 1,
      name: 'Parallel B',
      description: 'Work on module B',
    });
  });

  it('coordinator can build dispatch context for each eligible task', () => {
    const eligible = computeEligible(db, 'AT');
    expect(eligible.length).toBeGreaterThanOrEqual(2);

    for (const taskId of eligible) {
      const ctx = buildAgentDispatchContext(db, taskId, { projectDir: notesDir });
      expect(ctx).not.toBeNull();
      expect(ctx!.taskId).toBe(taskId);
      expect(ctx!.context.title).toBeTruthy();
    }
  });

  it('coordinator registers agents and can list their status', () => {
    const agentAId = createAgent(db, {
      name: 'worker-at-01-01',
      parent: '',
      brain_task: 'AT-01.01',
      claim_token: 'tok-a',
    });
    const agentBId = createAgent(db, {
      name: 'worker-at-01-02',
      parent: '',
      brain_task: 'AT-01.02',
      claim_token: 'tok-b',
    });

    const agentA = getAgent(db, agentAId);
    const agentB = getAgent(db, agentBId);

    expect(agentA).not.toBeNull();
    expect(agentA!.name).toBe('worker-at-01-01');
    expect(agentA!.brain_task).toBe('AT-01.01');

    expect(agentB).not.toBeNull();
    expect(agentB!.name).toBe('worker-at-01-02');

    const all = listAgents(db, { status: 'pending' });
    const names = all.map((a) => a.name);
    expect(names).toContain('worker-at-01-01');
    expect(names).toContain('worker-at-01-02');
  });
});

// ---------------------------------------------------------------------------
// Agent failure modes
// ---------------------------------------------------------------------------

describe('Failure mode: hallucinated task IDs', () => {
  it('getTask with a non-existent ID returns ok: false', () => {
    const result = getTask(db, 'FAKE-99.99');
    expect(result.ok).toBe(false);
  });

  it('buildAgentDispatchContext with a non-existent ID returns null', () => {
    const ctx = buildAgentDispatchContext(db, 'FAKE-99.99', { projectDir: notesDir });
    expect(ctx).toBeNull();
  });

  it('handleCompletion with a hallucinated ID returns a graceful error result', async () => {
    const msg = parseCompletionMessage('DONE HALLUCINATED-00.00 work done');
    expect(msg).not.toBeNull();

    const result = await handleCompletion(db, config, embedder, msg!);
    // Task not found — no crash, just an informative result
    expect(result.newlyEligible).toEqual([]);
    expect(result.summary).toMatch(/not found/i);
  });

  it('computeEligible with a non-existent prefix returns empty list', () => {
    const eligible = computeEligible(db, 'NOSUCHPROJECT');
    expect(eligible).toEqual([]);
  });
});

describe('Failure mode: wrong field names', () => {
  it('task metadata has display_id not task_id', async () => {
    await createTestTask(db, config, embedder, {
      project: 'AT',
      workstream: 1,
      name: 'Field check task',
      description: 'Verify field names',
    });

    const result = getTask(db, 'AT-01.01');
    expect(result.ok).toBe(true);
    const meta = result.data;

    // Correct field name
    expect(meta.display_id).toBe('AT-01.01');

    // Wrong field names an agent might hallucinate
    expect((meta as Record<string, unknown>)['task_id']).toBeUndefined();
    expect((meta as Record<string, unknown>)['taskId']).toBeUndefined();
  });

  it('task metadata has status not state', async () => {
    await createTestTask(db, config, embedder, {
      project: 'AT',
      workstream: 1,
      name: 'Status field task',
      description: 'Verify status field name',
    });

    const result = getTask(db, 'AT-01.01');
    expect(result.ok).toBe(true);

    expect(result.data.status).toBeDefined();
    expect((result.data as Record<string, unknown>)['state']).toBeUndefined();
  });
});

describe('Failure mode: invalid state transitions', () => {
  beforeEach(async () => {
    await createTestTask(db, config, embedder, {
      project: 'AT',
      workstream: 1,
      name: 'Transition test task',
      description: 'Test bad transitions',
    });
  });

  it('cannot complete a task that was never claimed or started', async () => {
    // Task is pending; trying to mark it done directly should fail transition check
    const result = await updateTaskStatus(db, config, embedder, 'AT-01.01', 'done' as TaskStatus);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBeTruthy();
    }
  });

  it('agent FAILED message blocks the task, not just leaves it pending', async () => {
    await updateTaskStatus(db, config, embedder, 'AT-01.01', 'claimed' as TaskStatus);
    await updateTaskStatus(db, config, embedder, 'AT-01.01', 'in-progress' as TaskStatus);

    const msg = parseCompletionMessage('FAILED AT-01.01 Could not resolve type errors');
    const result = await handleCompletion(db, config, embedder, msg!);

    expect(result.status).toBe('failed');
    expect(result.newlyEligible).toEqual([]);

    const task = getTask(db, 'AT-01.01');
    expect(task.ok).toBe(true);
    expect(task.data.status).toBe('blocked');
  });
});

describe('Failure mode: stale and invalid claim tokens', () => {
  it('isClaimStale detects an expired claim', () => {
    const tenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    expect(isClaimStale(tenMinutesAgo)).toBe(true);
  });

  it('isClaimStale accepts a fresh claim', () => {
    const justNow = new Date().toISOString();
    expect(isClaimStale(justNow)).toBe(false);
  });

  it('validateClaimToken rejects a mismatched token', () => {
    const result = validateClaimToken('expected-token', 'wrong-token');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_CLAIM_TOKEN');
    }
  });

  it('validateClaimToken accepts the correct token', () => {
    const token = 'correct-token';
    const result = validateClaimToken(token, token);
    expect(result.ok).toBe(true);
  });
});

describe('Failure mode: completion message parsing edge cases', () => {
  it('rejects messages that do not start with DONE or FAILED', () => {
    expect(isCompletionMessage('Task is done')).toBe(false);
    expect(isCompletionMessage('I finished AT-01.01')).toBe(false);
    expect(isCompletionMessage('')).toBe(false);
  });

  it('accepts valid DONE and FAILED messages', () => {
    expect(isCompletionMessage('DONE AT-01.01 summary here')).toBe(true);
    expect(isCompletionMessage('FAILED AT-01.01 reason here')).toBe(true);
  });

  it('DONE with no task ID returns null', () => {
    expect(parseCompletionMessage('DONE')).toBeNull();
    expect(parseCompletionMessage('FAILED')).toBeNull();
  });

  it('parses multi-line summaries correctly', () => {
    const msg = parseCompletionMessage('DONE AT-01.01 Line one\nLine two\nLine three');
    expect(msg).not.toBeNull();
    expect(msg!.taskId).toBe('AT-01.01');
    expect(msg!.summary).toContain('Line one');
    expect(msg!.summary).toContain('Line three');
  });

  it('is case-insensitive for the keyword — lowercase done is accepted by isCompletionMessage', () => {
    // isCompletionMessage uses /i flag; lowercase keywords are valid protocol messages.
    // Agents can safely use either case for DONE/FAILED.
    expect(isCompletionMessage('done AT-01.01 summary')).toBe(true);

    // parseCompletionMessage is case-sensitive (no /i flag): lowercase keywords return null
    expect(parseCompletionMessage('done AT-01.01 summary')).toBeNull();
  });
});

describe('Failure mode: context scale (many tasks)', () => {
  it('computeEligible handles a project with many independent tasks without crashing', async () => {
    for (let i = 0; i < 20; i++) {
      await createTestTask(db, config, embedder, {
        project: 'AT',
        workstream: 1,
        name: `Bulk task ${i}`,
        description: `Independent task ${i}`,
      });
    }

    const eligible = computeEligible(db, 'AT');
    // All 20 tasks are independent so all should be eligible
    expect(eligible.length).toBe(20);
  });

  it('pullNextTask returns exactly one task even with many eligible', async () => {
    for (let i = 0; i < 10; i++) {
      await createTestTask(db, config, embedder, {
        project: 'AT',
        workstream: 1,
        name: `Parallel task ${i}`,
        description: `Independent work item ${i}`,
      });
    }

    const result = await pullNextTask(db, config, embedder, { projectDir: notesDir });
    expect(result).not.toBeNull();
    // Only one claim is returned, not all 10
    expect(result!.taskId).toBeTruthy();
    expect(result!.claimToken).toBeTruthy();
  });
});
