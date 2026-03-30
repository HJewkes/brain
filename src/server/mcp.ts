import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BrainServiceClass } from '../services/brain-service.js';
import type { BrainDB } from '../services/brain-db.js';
import type { InboxItem } from '../types.js';
import { searchMemories } from '../services/search.js';
import { getTask, listTasks } from '../modules/pm/data/task-ops.js';
import { updateTaskStatus } from '../modules/pm/data/task-ops.js';
import { listWorkstreams } from '../modules/pm/data/workstream-ops.js';
import { computeEligible } from '../modules/pm/engine/dependency.js';
import { resolveProject } from '../modules/pm/data/queries.js';
import type { TaskStatus } from '../modules/pm/types.js';
import type { AgentStatus } from '../modules/agents/types.js';
import { getAgent, listAgents } from '../modules/agents/data.js';
import { dispatchTask } from './dispatch.js';
import { getWorkflowStatus } from '../modules/workflow/data/workflow-ops.js';
import { getInstanceByDisplayId, getInstanceStepStates } from '../modules/workflow/data/queries.js';
import { startWorkflow, advanceAndDispatch } from '../modules/workflow/engine/executor.js';
import { signalCondition } from '../modules/workflow/engine/condition.js';
import { updateTaskStatus as updateTaskStatusDirect } from '../modules/pm/data/task-ops.js';

function textResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(msg: string): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return { content: [{ type: 'text' as const, text: msg }], isError: true };
}

function registerSearchTools(server: McpServer, svc: BrainServiceClass): void {
  server.tool(
    'brain_search',
    'Search brain knowledge base using hybrid BM25 + vector search',
    {
      query: z.string().describe('Search query'),
      limit: z.number().optional().describe('Max results (default 10)'),
    },
    async ({ query, limit }) => {
      const results = await svc.search(query, { limit: limit ?? 10 });
      return textResult(
        results.map((r) => ({
          noteId: r.noteId,
          title: r.heading,
          filePath: r.filePath,
          score: r.score,
          excerpt: r.excerpt,
          tier: r.tier,
          matchSource: r.matchSource,
        }))
      );
    }
  );

  server.tool(
    'brain_note_read',
    'Read a note by ID, returning metadata and file content',
    { id: z.string().describe('Note ID') },
    async ({ id }) => {
      const note = svc.db.getNoteById(id);
      if (!note) return errorResult(`Note "${id}" not found`);
      const body = existsSync(note.filePath) ? readFileSync(note.filePath, 'utf-8') : '';
      return textResult({
        id: note.id,
        title: note.title,
        type: note.type,
        tier: note.tier,
        filePath: note.filePath,
        tags: note.tags ? JSON.parse(note.tags) : [],
        summary: note.summary,
        body,
      });
    }
  );

  server.tool(
    'brain_memory_search',
    'Search memories using vector similarity',
    {
      query: z.string().describe('Search query'),
      limit: z.number().optional().describe('Max results (default 10)'),
      container: z.string().optional().describe('Container tag filter'),
    },
    async ({ query, limit, container }) => {
      const results = await searchMemories(svc.db, svc.embedder, query, limit ?? 10, container);
      return textResult(results);
    }
  );

  server.tool(
    'brain_memory_list',
    'List recent memories from the knowledge base',
    {
      limit: z.number().optional().describe('Max results (default 20)'),
      container: z.string().optional(),
    },
    async ({ limit, container }) => {
      svc.db.forgetExpiredMemories();
      const memories = svc.db.getLatestMemories(container);
      return textResult(
        memories.slice(0, limit ?? 20).map((m) => ({
          id: m.id,
          memory: m.memory,
          sourceNoteId: m.sourceNoteId,
          containerTag: m.containerTag,
          createdAt: m.createdAt,
        }))
      );
    }
  );
}

function registerPmTools(server: McpServer, svc: BrainServiceClass): void {
  server.tool(
    'brain_pm_task_list',
    'List PM tasks, optionally filtered by workstream or status',
    { workstream: z.string().optional(), status: z.string().optional() },
    async ({ workstream, status }) => {
      const tasks = svc.pmTaskList({ workstream, status });
      return textResult(tasks);
    }
  );

  server.tool(
    'brain_pm_task_show',
    'Show details for a specific task by display ID (e.g. VNM-01.03)',
    { displayId: z.string().describe('Task display ID') },
    async ({ displayId }) => {
      const result = getTask(svc.db, displayId);
      if (!result.ok) return errorResult(result.error.message);
      return textResult(result.data);
    }
  );

  server.tool(
    'brain_pm_task_update',
    'Update a task status (e.g. backlog, ready, in-progress, review, done)',
    {
      displayId: z.string().describe('Task display ID'),
      status: z.string().describe('New status'),
    },
    async ({ displayId, status }) => {
      const result = await updateTaskStatus(
        svc.db,
        svc.config,
        svc.embedder,
        displayId,
        status as TaskStatus
      );
      if (!result.ok) return errorResult(result.error.message);
      return textResult(result.data);
    }
  );

  server.tool(
    'brain_pm_next',
    'Get eligible tasks ready to be worked on',
    { prefix: z.string().optional().describe('Project prefix (e.g. VNM)') },
    async ({ prefix }) => {
      const tasks = svc.pmNext(prefix);
      return textResult(tasks);
    }
  );

  server.tool(
    'brain_pm_overview',
    'Strategic project overview: active workstreams with task counts, high-priority eligible tasks, and recent completions — all in one call',
    { prefix: z.string().optional().describe('Project prefix (e.g. VNM)') },
    async ({ prefix }) => {
      const resolvedResult = resolveProject(svc.db, prefix);
      if (!resolvedResult.ok) return errorResult(resolvedResult.error.message);
      const pfx = resolvedResult.data;

      const allTasksResult = listTasks(svc.db, pfx);
      const allTasks = allTasksResult.ok ? allTasksResult.data : [];

      const wsResult = listWorkstreams(svc.db, pfx);
      const workstreams = wsResult.ok ? wsResult.data : [];

      const eligible = computeEligible(svc.db, pfx);
      const eligibleSet = new Set(eligible);

      const wsOverviews = workstreams
        .map((ws) => {
          const wsTasks = allTasks.filter((t) => t.workstream === ws.number);
          const pending = wsTasks.filter((t) => t.status === 'pending').length;
          const inProgress = wsTasks.filter((t) => t.status === 'in-progress').length;
          const done = wsTasks.filter((t) => t.status === 'done').length;
          const highPri = wsTasks.filter(
            (t) =>
              (t.priority === 'critical' || t.priority === 'high') &&
              t.status === 'pending' &&
              eligibleSet.has(t.display_id)
          );
          return {
            display_id: ws.display_id,
            name: ws.title?.replace(/^Workstream\s+/i, '') ?? `#${ws.number}`,
            pending,
            inProgress,
            done,
            total: wsTasks.length,
            eligibleHighPri: highPri.map((t) => ({
              displayId: t.display_id,
              title: t.title ?? t.display_id,
              priority: t.priority,
            })),
          };
        })
        .filter((ws) => ws.pending > 0 || ws.inProgress > 0);

      const pendingTasks = allTasks.filter((t) => t.status === 'pending');

      const recentCompletions = allTasks
        .filter((t) => t.status === 'done' && t.modified)
        .sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? ''))
        .slice(0, 10)
        .map((t) => ({
          displayId: t.display_id,
          title: t.title ?? t.display_id,
          workstream: t.workstream_display_id ?? `WS-${t.workstream}`,
          modified: t.modified,
        }));

      return textResult({
        summary: {
          totalTasks: allTasks.length,
          done: allTasks.filter((t) => t.status === 'done').length,
          inProgress: allTasks.filter((t) => t.status === 'in-progress').length,
          pending: pendingTasks.length,
          eligible: eligible.length,
          activeWorkstreams: wsOverviews.length,
        },
        priorityMatrix: {
          critical: pendingTasks.filter((t) => t.priority === 'critical').length,
          high: pendingTasks.filter((t) => t.priority === 'high').length,
          medium: pendingTasks.filter((t) => t.priority === 'medium').length,
          low: pendingTasks.filter((t) => t.priority === 'low').length,
        },
        workstreams: wsOverviews,
        recentCompletions,
      });
    }
  );
}

function registerSessionAgentTools(server: McpServer, svc: BrainServiceClass): void {
  server.tool(
    'brain_session_list',
    'List recent sessions',
    { limit: z.number().optional(), status: z.string().optional() },
    async ({ limit, status }) => {
      const sessions = svc.sessionList({ limit, status });
      return textResult(sessions);
    }
  );

  server.tool(
    'brain_agent_list',
    'List agents, optionally filtered by status',
    { status: z.string().optional().describe('Filter: pending|active|completed|failed|abandoned') },
    async ({ status }) => {
      const agents = svc.agentList(status ? { status: status as AgentStatus } : undefined);
      return textResult(agents);
    }
  );

  server.tool(
    'brain_inbox_add',
    'Capture text to the brain inbox for later processing',
    { text: z.string().describe('Content to capture') },
    async ({ text }) => {
      const item: InboxItem = {
        id: randomUUID(),
        content: text,
        title: null,
        source: 'api',
        sourceUrl: null,
        sourceMeta: null,
        status: 'pending',
        createdAt: new Date().toISOString(),
        processedAt: null,
      };
      svc.db.addInboxItem(item);
      return textResult({ captured: item.id });
    }
  );
}

function registerDispatchTools(server: McpServer, svc: BrainServiceClass): void {
  server.tool(
    'brain_agent_dispatch',
    'Dispatch a headless claude -p agent for a PM task. Returns agent handle with PID and session ID. Use dryRun to preview the prompt without spawning.',
    {
      taskId: z
        .string()
        .optional()
        .describe('Task display ID (e.g. VNM-46.17). Omit to auto-pull next eligible.'),
      model: z.string().optional().describe('Model override: opus, sonnet, haiku'),
      maxBudgetUsd: z.number().optional().describe('Cost cap per session (default 2.00)'),
      dryRun: z.boolean().optional().describe('Preview prompt without spawning'),
    },
    async ({ taskId, model, maxBudgetUsd, dryRun }) => {
      try {
        const result = await dispatchTask(svc, { taskId, model, maxBudgetUsd, dryRun });
        return textResult(result);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    'brain_agent_status',
    'Get status of dispatched agents. Omit agentId for all active agents.',
    {
      agentId: z.string().optional().describe('Specific agent UUID'),
    },
    async ({ agentId }) => {
      if (agentId) {
        const agent = getAgent(svc.db, agentId);
        if (!agent) return errorResult(`Agent "${agentId}" not found`);
        return textResult(agent);
      }
      const active = listAgents(svc.db, { status: 'active' as AgentStatus });
      const pending = listAgents(svc.db, { status: 'pending' as AgentStatus });
      return textResult([...active, ...pending]);
    }
  );
}

function resetInstanceToExecuting(db: BrainDB, instanceId: string): void {
  const result = getInstanceByDisplayId(db, instanceId);
  if (!result.ok) return;
  const { note } = result.data;
  const meta = JSON.parse(note.metadata!) as Record<string, unknown>;
  if (meta.instance_status === 'stalled' || meta.instance_status === 'paused') {
    db.upsertNote({ ...note, metadata: JSON.stringify({ ...meta, instance_status: 'executing' }) });
  }
}

function registerWorkflowTools(server: McpServer, svc: BrainServiceClass): void {
  server.tool(
    'brain_workflow_start',
    'Start a workflow: instantiate, expand into tasks, and dispatch entry steps. Returns immediately — agents run in background. Poll with brain_workflow_status.',
    {
      workflowId: z.string().describe('Workflow definition ID (e.g. "planning")'),
      project: z.string().describe('Project prefix (e.g. "VNM")'),
      workstream: z.number().describe('Workstream number for created tasks'),
      context: z
        .record(z.string(), z.string())
        .optional()
        .describe('Context parameters (e.g. { planId: "my-plan", complexity: "high" })'),
      model: z.string().optional().describe('Model override for dispatched agents'),
      maxBudgetUsd: z.number().optional().describe('Cost cap per agent session (default 2.00)'),
      dryRun: z.boolean().optional().describe('Preview without spawning agents'),
    },
    async ({ workflowId, project, workstream, context, model, maxBudgetUsd, dryRun }) => {
      try {
        const result = await startWorkflow(svc, workflowId, project, context ?? {}, {
          workstream,
          model,
          maxBudgetUsd,
          dryRun,
        });
        if (!result.ok) return errorResult(result.error.message);
        return textResult(result.data);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    'brain_workflow_status',
    'Get workflow instance status: step states, progress, stalled info, and active agents.',
    {
      instanceId: z.string().describe('Workflow instance display ID'),
    },
    async ({ instanceId }) => {
      const statusResult = getWorkflowStatus(svc.db, instanceId);
      if (!statusResult.ok) return errorResult(statusResult.error.message);

      const { instance, steps, progress } = statusResult.data;

      const allActiveAgents = svc.agentList({ status: 'active' as AgentStatus });
      const activeAgents = steps
        .filter((s) => s.status === 'claimed' || s.status === 'in-progress')
        .map((s) => {
          const agent = allActiveAgents.find((a) => a.brain_task === s.taskDisplayId);
          return {
            stepId: s.stepId,
            taskId: s.taskDisplayId,
            agentId: agent?.id,
            pid: agent?.pid,
          };
        });

      return textResult({
        instance,
        steps,
        progress,
        activeAgents,
      });
    }
  );

  server.tool(
    'brain_workflow_signal',
    'Signal a workflow step: complete an assisted step, retry a failed step, skip a step, or signal a condition for routing.',
    {
      instanceId: z.string().describe('Workflow instance display ID'),
      stepId: z.string().describe('Step ID to signal'),
      action: z
        .enum(['complete', 'retry', 'skip', 'signal'])
        .describe(
          'Action: complete (assisted done), retry (re-dispatch), skip (mark done), signal (condition)'
        ),
      condition: z
        .string()
        .optional()
        .describe('Condition name for signal action (e.g. "needs_revision")'),
    },
    async ({ instanceId, stepId, action, condition }) => {
      try {
        const stepsResult = getInstanceStepStates(svc.db, instanceId);
        if (!stepsResult.ok) return errorResult(stepsResult.error.message);

        const step = stepsResult.data.steps.find((s) => s.stepId === stepId);
        if (!step) return errorResult(`Step "${stepId}" not found in instance "${instanceId}"`);

        if (action === 'complete' || action === 'skip') {
          await updateTaskStatusDirect(
            svc.db,
            svc.config,
            svc.embedder,
            step.taskDisplayId,
            'done'
          );
        }

        if (action === 'retry') {
          await updateTaskStatusDirect(
            svc.db,
            svc.config,
            svc.embedder,
            step.taskDisplayId,
            'pending' as TaskStatus
          );
        }

        if (action === 'signal' && condition) {
          const sigResult = signalCondition(svc.db, instanceId, stepId, condition);
          if (!sigResult.ok) return errorResult(sigResult.error.message);
        }

        // Clear stalled/paused status before advancing
        if (action === 'complete' || action === 'retry' || action === 'skip') {
          resetInstanceToExecuting(svc.db, instanceId);
        }

        const advResult = await advanceAndDispatch(svc, instanceId, stepId);
        if (!advResult.ok) return errorResult(advResult.error.message);

        return textResult({
          action,
          stepId,
          ...advResult.data,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

export function createBrainMcpServer(svc: BrainServiceClass): McpServer {
  const server = new McpServer(
    { name: 'brain', version: '0.7.0' },
    { capabilities: { tools: {} } }
  );

  registerSearchTools(server, svc);
  registerPmTools(server, svc);
  registerSessionAgentTools(server, svc);
  registerDispatchTools(server, svc);
  registerWorkflowTools(server, svc);

  return server;
}
