import type { BrainDB } from '../../services/brain-db.js';
import type { BrainConfig } from '../../types.js';
import type { RoutingResult } from '../pm/engine/routing.js';
import { computeRouting, isAgentDispatchable } from '../pm/engine/routing.js';
import type { TaskRoutingOverrides } from '../pm/engine/routing.js';
import { assembleContext } from '../pm/engine/dispatch.js';
import { computeWaves } from '../pm/engine/dependency.js';
import { getPmNotes } from '../pm/data/queries.js';
import type { TaskMetadata } from '../pm/types.js';
import type { FileOwnershipManifest } from './file-ownership.js';
import type { SessionBriefing } from '../sessions/engine/session-briefing.js';
import type { BreakingChange } from './breaking-changes.js';
import type { CompletionCheck } from './dispatch-guard.js';
import type { InterfaceSnapshot } from './interface-snapshot.js';
import type { ArchitectureContext } from './extensions/architecture-ext.js';
import { getRegisteredExtensions } from './dispatch-extensions.js';
import { ensureExtensionsInitialized } from './extensions/index.js';

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
  waveInfo?: { waveNumber: number; totalWaves: number; waveTasks: string[] };
  contextHash: string;
  extensions: Record<string, unknown>;
  // Typed accessors for backward compatibility
  fileOwnership?: FileOwnershipManifest;
  sessionBriefing?: SessionBriefing;
  breakingChanges?: BreakingChange[];
  interfaceSnapshot?: InterfaceSnapshot;
  alreadyCompleted?: CompletionCheck;
  architecture?: ArchitectureContext;
}

export interface DispatchContextOptions {
  config?: BrainConfig;
  projectDir?: string;
  scopePatterns?: string[];
  dryRun?: boolean;
}

export function buildAgentDispatchContext(
  db: BrainDB,
  taskDisplayId: string,
  options?: DispatchContextOptions
): AgentDispatchContext | null {
  const taskMeta = resolveTaskMetadata(db, taskDisplayId);
  if (!taskMeta) return null;

  ensureExtensionsInitialized();
  const extData = computeExtensions(db, taskDisplayId, options);

  const completionCheck = extData['alreadyCompleted'] as CompletionCheck | undefined;
  const overrides: TaskRoutingOverrides = {};
  if (taskMeta.template) overrides.template = taskMeta.template;
  if (taskMeta.model_override) overrides.model = taskMeta.model_override;
  if (taskMeta.allowed_tools) overrides.allowedTools = taskMeta.allowed_tools;
  const routing = computeRouting(taskMeta.category, taskMeta.mode, overrides);
  const dispatchable = isAgentDispatchable(taskMeta.mode) && !completionCheck?.alreadyDone;

  const ctxResult = assembleContext(db, taskDisplayId);
  if (!ctxResult.ok) return null;

  const ctx = ctxResult.data;
  const waveInfo = resolveWaveInfo(db, ctx.task.project, taskDisplayId);

  return {
    taskId: taskDisplayId,
    routing,
    agentDispatchable: dispatchable,
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
    waveInfo,
    contextHash: ctx.contextHash,
    extensions: extData,
    // Backward-compatible typed fields from extensions
    fileOwnership: extData['fileOwnership'] as FileOwnershipManifest | undefined,
    sessionBriefing: extData['sessionBriefing'] as SessionBriefing | undefined,
    breakingChanges: extData['breakingChanges'] as BreakingChange[] | undefined,
    interfaceSnapshot: extData['interfaceSnapshot'] as InterfaceSnapshot | undefined,
    alreadyCompleted: completionCheck,
    architecture: extData['architecture'] as ArchitectureContext | undefined,
  };
}

function computeExtensions(
  db: BrainDB,
  taskDisplayId: string,
  options?: DispatchContextOptions
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const ext of getRegisteredExtensions()) {
    const data = ext.compute({ db, taskDisplayId, options });
    if (data !== undefined) {
      result[ext.name] = data;
    }
  }
  return result;
}

function resolveTaskMetadata(db: BrainDB, taskDisplayId: string): TaskMetadata | null {
  const taskNotes = getPmNotes(db, 'task', { display_id: taskDisplayId });
  if (taskNotes.length === 0) return null;
  return JSON.parse(taskNotes[0].metadata!) as TaskMetadata;
}

function resolveWaveInfo(
  db: BrainDB,
  project: string,
  taskDisplayId: string
): AgentDispatchContext['waveInfo'] {
  try {
    const waves = computeWaves(db, project);
    if (waves.length === 0) return undefined;

    for (const wave of waves) {
      if (wave.taskIds.includes(taskDisplayId)) {
        return {
          waveNumber: wave.wave + 1,
          totalWaves: waves.length,
          waveTasks: wave.taskIds.filter((id) => id !== taskDisplayId),
        };
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function formatDispatchBrief(ctx: AgentDispatchContext): string {
  const lines: string[] = [];

  lines.push(`Task: ${ctx.taskId} - ${ctx.context.title}`);
  lines.push(`Model: ${ctx.routing.model} | Agent: ${ctx.routing.agentType}`);
  lines.push(`Isolation: ${ctx.routing.isolation} | Verify: ${ctx.routing.verify}`);
  lines.push(`Dispatchable: ${ctx.agentDispatchable}`);

  if (ctx.alreadyCompleted) {
    lines.push(
      `Already Completed: commit ${ctx.alreadyCompleted.commitHash} — ${ctx.alreadyCompleted.commitMessage}`
    );
  }

  lines.push('');

  formatCoreContext(lines, ctx);
  formatExtensionSections(lines, ctx);

  return lines.join('\n');
}

function formatCoreContext(lines: string[], ctx: AgentDispatchContext): void {
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

  if (ctx.waveInfo) {
    lines.push('--- Wave Info ---');
    lines.push(
      `This task is in wave ${ctx.waveInfo.waveNumber} of ${ctx.waveInfo.totalWaves}. All prior wave tasks are complete.`
    );
    if (ctx.waveInfo.waveTasks.length > 0) {
      lines.push(`Parallel tasks in this wave: ${ctx.waveInfo.waveTasks.join(', ')}`);
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
}

function formatExtensionSections(lines: string[], ctx: AgentDispatchContext): void {
  ensureExtensionsInitialized();
  const skipNames = new Set(['alreadyCompleted']);

  for (const ext of getRegisteredExtensions()) {
    if (skipNames.has(ext.name)) continue;
    const data =
      ctx.extensions?.[ext.name] ?? (ctx as unknown as Record<string, unknown>)[ext.name];
    if (data === undefined) continue;
    const formatted = ext.format(data, ctx.taskId);
    if (formatted) {
      lines.push(formatted);
      lines.push('');
    }
  }
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
