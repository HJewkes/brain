import type { BrainDB } from '../../services/brain-db.js';
import type { RoutingResult } from '../pm/engine/routing.js';
import { computeRouting, isAgentDispatchable } from '../pm/engine/routing.js';
import { assembleContext } from '../pm/engine/dispatch.js';
import { getPmNotes } from '../pm/data/queries.js';
import type { TaskMetadata } from '../pm/types.js';

export interface AgentDispatchContext {
  taskId: string;
  routing: RoutingResult;
  agentDispatchable: boolean;
  context: {
    title: string;
    body: string;
    workstream: { displayId: string; title: string } | undefined;
    prompt: string | undefined;
    dependencies: Array<{ displayId: string; name: string; status: string }>;
    decisions: Array<{ displayId: string; status: string; content: string }>;
    constraints: string[];
  };
  contextHash: string;
}

export function buildAgentDispatchContext(
  db: BrainDB,
  taskDisplayId: string
): AgentDispatchContext | null {
  const taskMeta = resolveTaskMetadata(db, taskDisplayId);
  if (!taskMeta) return null;

  const routing = computeRouting(taskMeta.category, taskMeta.mode);
  const agentDispatchable = isAgentDispatchable(taskMeta.mode);

  const ctxResult = assembleContext(db, taskDisplayId);
  if (!ctxResult.ok) return null;

  const ctx = ctxResult.data;
  return {
    taskId: taskDisplayId,
    routing,
    agentDispatchable,
    context: {
      title: ctx.task.title ?? taskDisplayId,
      body: ctx.body,
      workstream: ctx.workstream,
      prompt: ctx.prompt,
      dependencies: ctx.dependencies.map((d) => ({
        displayId: d.displayId,
        name: d.name,
        status: d.status,
      })),
      decisions: ctx.decisions,
      constraints: ctx.constraints,
    },
    contextHash: ctx.contextHash,
  };
}

function resolveTaskMetadata(db: BrainDB, taskDisplayId: string): TaskMetadata | null {
  const taskNotes = getPmNotes(db, 'task', { display_id: taskDisplayId });
  if (taskNotes.length === 0) return null;
  return JSON.parse(taskNotes[0].metadata!) as TaskMetadata;
}

export function formatDispatchBrief(ctx: AgentDispatchContext): string {
  const lines: string[] = [];

  lines.push(`Task: ${ctx.taskId} - ${ctx.context.title}`);
  lines.push(`Model: ${ctx.routing.model} | Agent: ${ctx.routing.agentType}`);
  lines.push(`Isolation: ${ctx.routing.isolation} | Verify: ${ctx.routing.verify}`);
  lines.push(`Dispatchable: ${ctx.agentDispatchable}`);
  lines.push('');

  if (ctx.context.body) {
    lines.push('--- Description ---');
    lines.push(ctx.context.body);
    lines.push('');
  }

  if (ctx.context.workstream) {
    lines.push(`Workstream: ${ctx.context.workstream.displayId} - ${ctx.context.workstream.title}`);
    lines.push('');
  }

  if (ctx.context.prompt) {
    lines.push('--- Prompt ---');
    lines.push(ctx.context.prompt);
    lines.push('');
  }

  if (ctx.context.dependencies.length > 0) {
    lines.push('--- Dependencies ---');
    for (const dep of ctx.context.dependencies) {
      lines.push(`  ${dep.displayId} [${dep.status}] ${dep.name}`);
    }
    lines.push('');
  }

  if (ctx.context.decisions.length > 0) {
    lines.push('--- Decisions ---');
    for (const dec of ctx.context.decisions) {
      lines.push(`  ${dec.displayId} [${dec.status}] ${dec.content}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
