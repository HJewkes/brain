import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BrainServiceClass } from '../services/brain-service.js';
import type { InboxItem, MemoryEntry, MemoryCategory } from '../types.js';
import { searchMemories } from '../services/search.js';
import { indexSingleFile } from '../services/indexing.js';
import { slugify } from '../utils.js';
import { getTask, listTasks, createTask } from '../modules/pm/data/task-ops.js';
import { updateTaskStatus } from '../modules/pm/data/task-ops.js';
import { listWorkstreams, createWorkstream } from '../modules/pm/data/workstream-ops.js';
import { computeEligible, computeWaves } from '../modules/pm/engine/dependency.js';
import { resolveProject, getPmNotes } from '../modules/pm/data/queries.js';
import { readTaskBody } from '../modules/pm/engine/dispatch.js';
import type { TaskStatus } from '../modules/pm/types.js';
import type { AgentStatus } from '../modules/agents/types.js';
import { getAgent, listAgents, getAgentContext } from '../modules/agents/data.js';
import { signalDelivery } from '../modules/agents/delivery.js';
import { dispatchTask, resolveProjectDir } from './dispatch.js';
import { OrchestrationService } from './orchestration.js';
import type { WorkflowRuntime } from '../modules/workflow/runtime/runtime.js';
import { askAdvisor, reviewAdvisor } from './advisor.js';

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
    {
      workstream: z
        .string()
        .optional()
        .describe('Workstream filter (number or display ID like VNM-48)'),
      status: z.string().optional(),
      limit: z.number().optional().describe('Max results (default 100)'),
    },
    async ({ workstream, status, limit }) => {
      const tasks = svc.pmTaskList({ workstream, status, limit });
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

function registerNoteTools(server: McpServer, svc: BrainServiceClass): void {
  const TYPE_DIRS: Record<string, string> = {
    note: 'notes',
    decision: 'decisions',
    research: 'research',
    pattern: 'patterns',
    guide: 'guides',
    workflow: 'workflows',
  };

  server.tool(
    'brain_note_list',
    'List notes, optionally filtered by type or tier',
    {
      type: z.string().optional().describe('Filter by type (note, research, guide, etc.)'),
      tier: z.string().optional().describe('Filter by tier (slow, fast)'),
      limit: z.number().optional().describe('Max results (default 50)'),
    },
    async ({ type, tier, limit }) => {
      const all = svc.db.getAllNotes();
      let filtered = all;
      if (type) filtered = filtered.filter((n) => n.type === type);
      if (tier) filtered = filtered.filter((n) => n.tier === tier);
      return textResult(
        filtered.slice(0, limit ?? 50).map((n) => ({
          id: n.id,
          title: n.title,
          type: n.type,
          tier: n.tier,
          filePath: n.filePath,
          summary: n.summary,
        }))
      );
    }
  );

  server.tool(
    'brain_note_add',
    'Create a new note from content and index it in the knowledge base',
    {
      title: z.string().describe('Note title'),
      content: z.string().describe('Note body content in markdown'),
      type: z
        .enum(['note', 'decision', 'research', 'pattern', 'guide', 'workflow'])
        .optional()
        .describe('Note type (default: note)'),
      tier: z.enum(['slow', 'fast']).optional().describe('Storage tier (default: slow)'),
      tags: z.array(z.string()).optional().describe('List of tags'),
      summary: z.string().optional().describe('Short summary of the note'),
    },
    async ({ title, content, type, tier, tags, summary }) => {
      const noteType = type ?? 'note';
      const noteTier = tier ?? 'slow';
      const id = slugify(title);
      const now = new Date().toISOString().slice(0, 10);
      const typeDir = TYPE_DIRS[noteType] ?? 'notes';
      const outPath = join(svc.config.notesDir, typeDir, `${id}.md`);

      const lines = [
        '---',
        `id: ${id}`,
        `title: "${title}"`,
        `type: ${noteType}`,
        `tier: ${noteTier}`,
      ];
      if (tags?.length) lines.push(`tags: [${tags.join(', ')}]`);
      if (summary) lines.push(`summary: "${summary}"`);
      lines.push(`created: ${now}`, `modified: ${now}`, '---');

      const markdown = lines.join('\n') + '\n\n# ' + title + '\n\n' + content;
      const dir = dirname(outPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(outPath, markdown, 'utf-8');

      const hash = createHash('sha256').update(markdown).digest('hex');
      const noteId = await indexSingleFile(
        svc.db,
        svc.embedder,
        outPath,
        markdown,
        hash,
        Date.now()
      );
      return textResult({ noteId, filePath: outPath, title, type: noteType, tier: noteTier });
    }
  );
}

function registerMemoryTools(server: McpServer, svc: BrainServiceClass): void {
  server.tool(
    'brain_memory_add',
    'Add a memory directly to the knowledge base',
    {
      memory: z.string().describe('Memory content to store'),
      containerTag: z
        .string()
        .optional()
        .describe('Container tag for namespacing (e.g. session:SES-01)'),
      category: z.string().optional().describe('Memory category'),
      sourceNoteId: z.string().optional().describe('Source note ID this memory derives from'),
    },
    async ({ memory, containerTag, category, sourceNoteId }) => {
      const now = new Date().toISOString();
      const entry: MemoryEntry = {
        id: randomUUID(),
        memory,
        sourceNoteId: sourceNoteId ?? '',
        sourceChunkId: null,
        containerTag: containerTag ?? '',
        category: (category as MemoryCategory | null) ?? null,
        isLatest: true,
        parentMemoryId: null,
        rootMemoryId: null,
        relationType: null,
        validAt: now,
        invalidAt: null,
        forgetAfter: null,
        isForgotten: false,
        isInference: false,
        createdAt: now,
      };
      svc.db.addMemory(entry);
      return textResult({ id: entry.id, memory: entry.memory });
    }
  );
}

function registerPmExtTools(server: McpServer, svc: BrainServiceClass): void {
  server.tool(
    'brain_pm_task_add',
    'Create a new PM task in a workstream',
    {
      project: z.string().describe('Project prefix (e.g. VNM)'),
      workstream: z.number().describe('Workstream number'),
      name: z.string().describe('Task name/title'),
      description: z.string().describe('Task description (required for search indexing)'),
      priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
      category: z
        .enum([
          'implementation',
          'testing',
          'documentation',
          'research',
          'review',
          'infrastructure',
          'configuration',
          'design',
          'migration',
        ])
        .optional(),
      dependsOn: z.array(z.string()).optional().describe('Task display IDs this task depends on'),
      acceptanceCriteria: z.array(z.string()).optional(),
    },
    async ({
      project,
      workstream,
      name,
      description,
      priority,
      category,
      dependsOn,
      acceptanceCriteria,
    }) => {
      const result = await createTask(svc.db, svc.config, svc.embedder, {
        project,
        workstream,
        name,
        description,
        priority,
        category,
        dependsOn,
        acceptanceCriteria,
      });
      if (!result.ok) return errorResult(result.error.message);
      return textResult(result.data);
    }
  );

  server.tool(
    'brain_pm_workstream_list',
    'List workstreams for a project',
    {
      prefix: z.string().optional().describe('Project prefix (e.g. VNM)'),
    },
    async ({ prefix }) => {
      const resolvedResult = resolveProject(svc.db, prefix);
      if (!resolvedResult.ok) return errorResult(resolvedResult.error.message);
      const result = listWorkstreams(svc.db, resolvedResult.data);
      if (!result.ok) return errorResult(result.error.message);
      return textResult(result.data);
    }
  );

  server.tool(
    'brain_pm_workstream_add',
    'Create a new workstream in a project',
    {
      project: z.string().describe('Project prefix (e.g. VNM)'),
      name: z.string().describe('Workstream name'),
      description: z.string().optional().describe('Workstream description'),
    },
    async ({ project, name, description }) => {
      const result = await createWorkstream(svc.db, svc.config, svc.embedder, {
        project,
        name,
        description,
      });
      if (!result.ok) return errorResult(result.error.message);
      return textResult(result.data);
    }
  );

  server.tool(
    'brain_pm_wave',
    'Get dependency-ordered dispatch waves — tasks grouped by what can be parallelized',
    {
      prefix: z.string().optional().describe('Project prefix (e.g. VNM)'),
    },
    async ({ prefix }) => {
      const resolvedResult = resolveProject(svc.db, prefix);
      if (!resolvedResult.ok) return errorResult(resolvedResult.error.message);
      const waves = computeWaves(svc.db, resolvedResult.data);
      return textResult(waves);
    }
  );

  server.tool(
    'brain_pm_context',
    'Rich context bundle for a task: details, body, sessions, and related notes',
    {
      displayId: z.string().describe('Task display ID (e.g. VNM-01.03)'),
    },
    async ({ displayId }) => {
      const taskResult = getTask(svc.db, displayId);
      if (!taskResult.ok) return errorResult(taskResult.error.message);

      const notes = getPmNotes(svc.db, 'task', { display_id: displayId });
      const body = notes.length > 0 ? readTaskBody(notes[0]) : '';

      const sessions = svc
        .sessionsByTask(displayId)
        .slice(0, 5)
        .map((s) => ({ displayId: s.display_id, status: s.status, startedAt: s.started_at }));

      const relations = notes.length > 0 ? svc.db.getRelationsFrom(notes[0].id) : [];
      const relatedNotes = relations
        .filter((r) => r.type !== 'depends_on')
        .slice(0, 10)
        .flatMap((r) => {
          const n = svc.db.getNoteById(r.targetId);
          return n ? [{ id: n.id, title: n.title, type: n.type, relation: r.type }] : [];
        });

      return textResult({ task: taskResult.data, body, sessions, relatedNotes });
    }
  );

  server.tool(
    'brain_pm_capture',
    'Lightweight PM intake: capture a task idea without full task creation ceremony',
    {
      text: z.string().describe('Task description or idea to capture'),
      project: z.string().optional().describe('Project prefix (e.g. VNM)'),
      workstream: z.string().optional().describe('Workstream display ID (e.g. VNM-42)'),
    },
    async ({ text, project, workstream }) => {
      const prefix = project
        ? `[PM${project ? ` | ${project}` : ''}${workstream ? ` | ${workstream}` : ''}]`
        : '[PM Capture]';
      const item: InboxItem = {
        id: randomUUID(),
        content: `${prefix}\n\n${text}`,
        title: null,
        source: 'api',
        sourceUrl: null,
        sourceMeta: project || workstream ? JSON.stringify({ project, workstream }) : null,
        status: 'pending',
        createdAt: new Date().toISOString(),
        processedAt: null,
      };
      svc.db.addInboxItem(item);
      return textResult({
        captured: item.id,
        hint: 'Use brain_pm_task_add to formalize into a task',
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
    'List agents with pagination and filtering. Defaults to last 24h when no status filter.',
    {
      status: z.string().optional().describe('Filter: pending|active|completed|failed|abandoned'),
      since: z
        .string()
        .optional()
        .describe('ISO date — filter by created_at (default: last 24h when no status)'),
      task: z.string().optional().describe('Filter by brain_task prefix (e.g. "VNM-45")'),
      limit: z.number().optional().describe('Max results (default 50)'),
      offset: z.number().optional().describe('Pagination offset (default 0)'),
      sortBy: z.string().optional().describe('Sort field: created_at (default) or status'),
    },
    async ({ status, since, task, limit, offset, sortBy }) => {
      const effectiveSince =
        since ?? (!status ? new Date(Date.now() - 86400000).toISOString() : undefined);
      const agents = svc.agentList({
        status: status as AgentStatus | undefined,
        since: effectiveSince,
        task,
        limit: limit ?? 50,
        offset,
        sortBy,
      });
      return textResult(agents);
    }
  );

  server.tool(
    'brain_session_show',
    'Get detailed information about a specific session including turns, tool calls, and token usage',
    {
      displayId: z.string().describe('Session display ID (e.g. SES-01)'),
    },
    async ({ displayId }) => {
      const detail = svc.sessionDetail(displayId);
      if (!detail) return errorResult(`Session "${displayId}" not found`);
      return textResult(detail);
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
      maxBudgetUsd: z.number().optional().describe('Cost cap per session (default 5.00)'),
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
    'brain_agent_dispatch_workstream',
    'Execute all pending tasks in a workstream in dependency-ordered waves. Dispatches agents concurrently within each wave (up to WIP limit), then gates on the next wave. Runs in background — returns immediately.',
    {
      workstream: z.string().describe('Workstream display ID (e.g. VNM-48)'),
      wipLimit: z.number().optional().describe('Max concurrent agents (default 3)'),
    },
    async ({ workstream, wipLimit }) => {
      try {
        const orch = new OrchestrationService(svc.db, wipLimit ?? 3, resolveProjectDir(svc));
        // Fire-and-forget: waves take minutes; MCP tool returns immediately
        orch.executeWorkstream(svc, workstream).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[orchestration] workstream ${workstream} error: ${msg}\n`);
        });
        return textResult({
          workstream,
          status: 'started',
          message: 'Dispatch running in background',
        });
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

  server.tool(
    'brain_agent_activity',
    'Live activity feed for an active agent: recent tool calls, errors, files touched, and progress indicators from session events captured by hooks.',
    {
      agentId: z.string().describe('Agent UUID'),
      limit: z.number().optional().describe('Max events to return (default 30)'),
    },
    async ({ agentId, limit }) => {
      const agent = getAgent(svc.db, agentId);
      if (!agent) return errorResult(`Agent "${agentId}" not found`);

      const sessionId = getAgentContext(svc.db, agentId, 'session_id') as string | undefined;

      if (!sessionId) {
        return textResult({
          agent: { id: agent.id, status: agent.status, task: agent.brain_task },
          events: [],
          message: 'No session ID linked — hooks may not have fired yet',
        });
      }

      const rawDb = svc.db.rawDb;
      const events = rawDb
        .prepare(
          `SELECT event_type, category, data, timestamp
           FROM session_events
           WHERE session_id = ?
           ORDER BY timestamp DESC
           LIMIT ?`
        )
        .all(sessionId, limit ?? 30) as Array<{
        event_type: string;
        category: string | null;
        data: string;
        timestamp: string;
      }>;

      const toolCalls = events.filter((e) => e.event_type.startsWith('tool:'));
      const errors = events.filter((e) => e.event_type === 'error' || e.category === 'error');

      const filesSet = new Set<string>();
      for (const e of events) {
        if (e.event_type === 'file_touch') {
          try {
            const d = JSON.parse(e.data) as { filePath?: string };
            if (d.filePath) filesSet.add(d.filePath);
          } catch {
            /* skip */
          }
        }
      }

      return textResult({
        agent: {
          id: agent.id,
          status: agent.status,
          task: agent.brain_task,
          pid: (agent as unknown as Record<string, unknown>).pid,
        },
        sessionId,
        summary: {
          totalEvents: events.length,
          toolCalls: toolCalls.length,
          errors: errors.length,
          filesTouched: filesSet.size,
        },
        recentEvents: events.slice(0, 15).map((e) => ({
          type: e.event_type,
          timestamp: e.timestamp,
          data: JSON.parse(e.data),
        })),
        filesTouched: [...filesSet].slice(0, 20),
      });
    }
  );

  server.tool(
    'brain_delivery_signal',
    'Signal a human review decision on a paused delivery. Use approve to resume merge, needs_fixes to trigger a fixup cycle.',
    {
      taskId: z.string().describe('PM task display_id (e.g. VNM-56.30)'),
      action: z
        .enum(['approve', 'needs_fixes'])
        .describe('Approve to merge; needs_fixes to iterate'),
    },
    async ({ taskId, action }) => {
      try {
        const delivery = signalDelivery(svc.db.rawDb, taskId.toUpperCase(), action);
        if (!delivery) return errorResult(`No delivery found for task: ${taskId}`);
        return textResult({
          taskId: delivery.task_id,
          agentId: delivery.agent_id,
          status: delivery.status,
          humanSignal: action,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

function isAlive(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getV2Runtime(svc: BrainServiceClass): WorkflowRuntime | null {
  return ((svc as unknown as Record<string, unknown>)._workflowRuntime as WorkflowRuntime) ?? null;
}

function registerWorkflowTools(server: McpServer, svc: BrainServiceClass): void {
  server.tool(
    'brain_workflow_start',
    'Start a workflow. Returns immediately — agents run in background. Poll with brain_workflow_status. ' +
      'Planning workflow requires context.brief describing what to build. ' +
      'wave-execution workflow dispatches tasks in dependency-ordered waves for a workstream (context: wipLimit, template).',
    {
      workflowId: z.string().describe('Workflow definition ID (e.g. "planning")'),
      project: z.string().describe('Project prefix (e.g. "VNM")'),
      workstream: z.number().describe('Workstream number for created tasks'),
      context: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          'Context parameters. Planning workflow requires: brief (what to build), planId, complexity (low/medium/high). ' +
            'Optional: brainNotes (comma-separated slugs), files (comma-separated paths), priorContext, interviewAnswers.'
        ),
      model: z.string().optional().describe('Model override for dispatched agents'),
      maxBudgetUsd: z.number().optional().describe('Cost cap per agent session (default 5.00)'),
      dryRun: z.boolean().optional().describe('Preview without spawning agents'),
    },
    async ({ workflowId, project, workstream, context, model, maxBudgetUsd, dryRun }) => {
      try {
        const runtime = getV2Runtime(svc);
        if (!runtime) return errorResult('Workflow runtime not initialized');

        if (!runtime.hasWorkflow(workflowId)) {
          const known = runtime.registeredWorkflows();
          return errorResult(
            `Unknown workflow "${workflowId}". Registered workflows: ${known.join(', ') || '(none)'}`
          );
        }

        // Validate required context per workflow type
        if (workflowId === 'planning' && !context?.brief) {
          return errorResult('Planning workflow requires context.brief describing what to build.');
        }

        // Validate project/workstream exist
        const wsDisplayId = `${project}-${String(workstream).padStart(2, '0')}`;
        const wsNote = svc.db.getNoteById(`${wsDisplayId.toLowerCase()}-workstream`);
        if (!wsNote) {
          return errorResult(
            `Workstream ${wsDisplayId} not found. Check that project "${project}" and workstream ${workstream} exist.`
          );
        }

        if (dryRun) {
          return textResult({ workflowId, project, workstream, context, dryRun: true });
        }

        const params: Record<string, string> = {
          ...context,
          project,
          workstream: String(workstream),
        };
        const runId = await runtime.start(workflowId, params, { model, maxBudgetUsd });
        const status = runtime.getStatus(runId);
        return textResult({
          instanceId: runId,
          workflowId,
          status: status?.status ?? 'running',
          runtimeVersion: 'v2',
        });
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
      const runtime = getV2Runtime(svc);
      if (!runtime) return errorResult('Workflow runtime not initialized');

      const status = runtime.getStatus(instanceId);
      if (!status) return errorResult('Workflow not found');
      const stepEntries = Object.values(status.stepResults);
      return textResult({
        instance: {
          workflow_id: status.workflowName,
          instance_status: status.status,
          context: status.context,
        },
        steps: stepEntries.map((r) => ({
          stepId: r.stepId,
          taskDisplayId: r.taskId,
          status: 'done',
        })),
        progress: {
          total: stepEntries.length,
          done: stepEntries.length,
          pruned: 0,
          skipped: 0,
          active: Object.keys(status.activeAgents ?? {}).length,
          pending: 0,
        },
        activeAgents: Object.values(status.activeAgents ?? {}).map((slot) => ({
          stepId: slot.stepId,
          taskId: slot.taskId,
          pid: slot.pid,
          alive: isAlive(slot.pid),
        })),
        runtimeVersion: 'v2',
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
        const runtime = getV2Runtime(svc);
        if (!runtime) return errorResult('Workflow runtime not initialized');

        if (action === 'complete' || action === 'signal') {
          runtime.signal(instanceId, stepId, condition ? { signal: condition } : undefined);
        }
        return textResult({
          action,
          stepId,
          instanceId,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    'brain_workflow_events',
    'Poll for workflow run states. Returns current snapshot of workflow runs with a cursor for incremental polling. Use this as the reliable alternative to push notifications (notifications/claude/channel is not reliable in all Claude Code versions).',
    {
      instanceId: z.string().optional().describe('Filter by specific workflow instance ID'),
      since: z
        .string()
        .optional()
        .describe(
          'ISO timestamp — return runs updated after this time (use cursor from previous response)'
        ),
      limit: z.number().optional().describe('Max results (default 20)'),
    },
    async ({ instanceId, since, limit }) => {
      interface WorkflowRunRow {
        id: string;
        workflow_name: string;
        status: string;
        current_step: string | null;
        started_at: string;
        completed_at: string | null;
        error: string | null;
      }

      const rawDb = svc.db.rawDb;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (instanceId) {
        conditions.push('id = ?');
        params.push(instanceId);
      }
      if (since) {
        conditions.push('(completed_at > ? OR started_at > ?)');
        params.push(since, since);
      }

      const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
      const query =
        `SELECT id, workflow_name, status, current_step, started_at, completed_at, error` +
        ` FROM workflow_runs${where} ORDER BY started_at DESC LIMIT ?`;
      params.push(limit ?? 20);

      const rows = rawDb.prepare(query).all(...params) as WorkflowRunRow[];
      const events = rows.map((r) => ({
        instanceId: r.id,
        workflowId: r.workflow_name,
        status: r.status,
        currentStep: r.current_step,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        error: r.error,
      }));

      return textResult({
        events,
        cursor: new Date().toISOString(),
        hint: 'Pass cursor as "since" in the next call for incremental updates',
      });
    }
  );

  server.resource('workflow-runs', 'brain://workflow/runs', async () => ({
    contents: [
      {
        uri: 'brain://workflow/runs',
        mimeType: 'application/json',
        text: 'Use the brain_workflow_events tool to poll for workflow run states.',
      },
    ],
  }));
}

// ---------------------------------------------------------------------------
// Advisor tools
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Advisor context assembly
// ---------------------------------------------------------------------------

function assembleReviewContext(
  svc: BrainServiceClass,
  opts: { workstream?: string; includeSession?: boolean }
): string {
  const sections: string[] = [];

  // 1. PM state: waves, task statuses, recent completions
  const prefix = resolveProject(svc.db, opts.workstream?.toUpperCase());
  if (prefix.ok) {
    const wsFilter = opts.workstream ? { workstream: opts.workstream } : undefined;
    const allTasks = svc.pmTaskList({ ...wsFilter, limit: 200 });
    const waves = computeWaves(svc.db, prefix.data);

    const byStatus = new Map<string, number>();
    for (const t of allTasks) {
      byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
    }

    const statusSummary = Array.from(byStatus.entries())
      .map(([s, c]) => `${s}: ${c}`)
      .join(', ');
    sections.push(`## PM State\nTask counts: ${statusSummary}`);

    if (waves.length > 0) {
      const waveLines = waves.map((w) => `Wave ${w.wave}: ${w.taskIds.join(', ')}`);
      sections.push(`### Waves\n${waveLines.join('\n')}`);
    }

    const inProgress = allTasks.filter((t) => t.status === 'in-progress');
    if (inProgress.length > 0) {
      const ipLines = inProgress.map(
        (t) => `- ${t.display_id}: ${t.title} (claimed: ${t.claimed_at ?? 'unknown'})`
      );
      sections.push(`### In-Progress Tasks\n${ipLines.join('\n')}`);
    }

    const recentDone = allTasks.filter((t) => t.status === 'done').slice(0, 10);
    if (recentDone.length > 0) {
      const doneLines = recentDone.map((t) => `- ${t.display_id}: ${t.title}`);
      sections.push(`### Recently Completed\n${doneLines.join('\n')}`);
    }
  }

  // 2. Recent agent outcomes
  const rawDb = (svc.db as unknown as { db: unknown }).db;
  const recentAgents = listAgents(rawDb, { limit: 15 });
  if (recentAgents.length > 0) {
    const agentLines = recentAgents.map((a) => {
      const duration =
        a.started_at && a.completed_at
          ? `${Math.round((new Date(a.completed_at).getTime() - new Date(a.started_at).getTime()) / 1000)}s`
          : 'unknown';
      return `- ${a.name} [${a.status}] task=${a.brain_task ?? 'none'} duration=${duration}${a.exit_reason ? ` exit=${a.exit_reason}` : ''}`;
    });
    sections.push(`## Recent Agents\n${agentLines.join('\n')}`);
  }

  // 3. Session transcript summary (if requested)
  if (opts.includeSession) {
    const sessions = svc.sessionList({ limit: 1, status: 'active' });
    if (sessions.length > 0) {
      const s = sessions[0];
      sections.push(
        `## Current Session\nID: ${s.displayId}, started: ${s.startedAt ?? 'unknown'}, ` +
          `tools: ${s.toolCalls ?? 0}, errors: ${s.errors ?? 0}`
      );
    }
  }

  return sections.join('\n\n');
}

function registerAdvisorTools(server: McpServer, svc: BrainServiceClass): void {
  server.tool(
    'brain_advisor_ask',
    'Ask the strategic advisor (Opus) a focused question. Returns concise, actionable advice. The coordinator assembles context; the advisor reasons over it.',
    {
      question: z.string().describe('The question to ask the advisor'),
      context: z
        .string()
        .optional()
        .describe(
          'Optional context the coordinator has assembled (task state, code snippets, constraints)'
        ),
      max_tokens: z.number().optional().describe('Max response tokens (default 500)'),
    },
    async ({ question, context, max_tokens }) => {
      try {
        const result = askAdvisor({
          question,
          context,
          maxTokens: max_tokens,
        });
        return textResult({
          advice: result.advice,
          usage: result.usage,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.tool(
    'brain_advisor_review',
    'Request a full strategic review from the advisor (Opus). Automatically assembles PM state, agent outcomes, and session context. Returns structured assessment with action items and risk flags.',
    {
      focus: z
        .string()
        .optional()
        .describe(
          'What aspect to review: "wave_plan", "error_recovery", "completion_check", or free text'
        ),
      workstream: z
        .string()
        .optional()
        .describe('Scope PM context to a specific workstream (e.g. "VNM-45")'),
      include_session: z
        .boolean()
        .optional()
        .describe('Whether to include session transcript summary (default false)'),
      max_tokens: z.number().optional().describe('Max response tokens (default 1500)'),
    },
    async ({ focus, workstream, include_session, max_tokens }) => {
      try {
        const context = assembleReviewContext(svc, {
          workstream,
          includeSession: include_session ?? false,
        });

        if (!context.trim()) {
          return errorResult('No context could be assembled — check that PM data exists');
        }

        const result = reviewAdvisor({
          focus,
          context,
          maxTokens: max_tokens,
        });

        return textResult({
          advice: result.advice,
          usage: result.usage,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

export interface BrainMcpServerOptions {
  channelInstructions?: string;
}

export function createBrainMcpServer(
  svc: BrainServiceClass,
  options?: BrainMcpServerOptions
): McpServer {
  const server = new McpServer(
    { name: 'brain', version: '0.7.0' },
    {
      capabilities: {
        tools: {},
        resources: {},
        ...(options?.channelInstructions ? { experimental: { 'claude/channel': {} } } : {}),
      },
      ...(options?.channelInstructions ? { instructions: options.channelInstructions } : {}),
    }
  );

  registerSearchTools(server, svc);
  registerNoteTools(server, svc);
  registerMemoryTools(server, svc);
  registerPmTools(server, svc);
  registerPmExtTools(server, svc);
  registerSessionAgentTools(server, svc);
  registerDispatchTools(server, svc);
  registerWorkflowTools(server, svc);
  registerAdvisorTools(server, svc);

  return server;
}
