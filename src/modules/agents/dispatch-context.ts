import type { BrainDB } from '../../services/brain-db.js';
import type { BrainConfig } from '../../types.js';
import type { RoutingResult } from '../pm/engine/routing.js';
import { computeRouting, isAgentDispatchable } from '../pm/engine/routing.js';
import { assembleContext } from '../pm/engine/dispatch.js';
import { getPmNotes } from '../pm/data/queries.js';
import type { TaskMetadata } from '../pm/types.js';
import type { FileOwnershipManifest } from './file-ownership.js';
import { formatOwnershipBrief } from './file-ownership.js';
import type { SessionBriefing } from '../sessions/engine/session-briefing.js';
import { generateSessionBriefing } from '../sessions/engine/session-briefing.js';

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
  fileOwnership?: FileOwnershipManifest;
  sessionBriefing?: SessionBriefing;
}

export interface DispatchContextOptions {
  config?: BrainConfig;
  projectDir?: string;
}

export function buildAgentDispatchContext(
  db: BrainDB,
  taskDisplayId: string,
  options?: DispatchContextOptions
): AgentDispatchContext | null {
  const taskMeta = resolveTaskMetadata(db, taskDisplayId);
  if (!taskMeta) return null;

  const routing = computeRouting(taskMeta.category, taskMeta.mode);
  const agentDispatchable = isAgentDispatchable(taskMeta.mode);

  const ctxResult = assembleContext(db, taskDisplayId);
  if (!ctxResult.ok) return null;

  const ctx = ctxResult.data;

  let sessionBriefing: SessionBriefing | undefined;
  if (options?.config && options?.projectDir) {
    try {
      sessionBriefing = generateSessionBriefing(db, options.config, options.projectDir);
    } catch {
      // Session briefing is best-effort; don't block dispatch on failure
    }
  }

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
    sessionBriefing,
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

  if (ctx.fileOwnership) {
    lines.push(formatOwnershipBrief(ctx.fileOwnership, ctx.taskId));
    lines.push('');
  }

  if (ctx.sessionBriefing) {
    lines.push(formatSessionBriefing(ctx.sessionBriefing));
    lines.push('');
  }

  return lines.join('\n');
}

export function formatSessionBriefing(briefing: SessionBriefing): string {
  const lines: string[] = [];
  lines.push('--- Session Briefing ---');

  if (briefing.project) {
    lines.push(`Project: ${briefing.project}`);
  }

  for (const section of briefing.sections) {
    lines.push(`[${section.heading}]`);
    for (const item of section.items) {
      lines.push(`  ${item}`);
    }
  }

  if (briefing.suggestedFocus.length > 0) {
    lines.push('[Suggested Focus]');
    for (const focus of briefing.suggestedFocus) {
      lines.push(`  ${focus}`);
    }
  }

  return lines.join('\n');
}
