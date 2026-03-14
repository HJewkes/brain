import type { BrainDB } from '../../services/brain-db.js';
import type { TaskMetadata } from '../pm/types.js';
import { getPmNotes } from '../pm/data/queries.js';
import { buildAgentDispatchContext } from './dispatch-context.js';
import type { AgentDispatchContext, DispatchContextOptions } from './dispatch-context.js';
import { selectTemplate, renderPrompt } from './prompt-templates.js';
import type { PromptContext, SpawnPromptTemplate } from './prompt-templates.js';

export interface BuildPromptOptions extends DispatchContextOptions {
  templateOverride?: SpawnPromptTemplate;
  conventions?: string[];
}

export function buildSpawnPrompt(
  db: BrainDB,
  taskDisplayId: string,
  options?: BuildPromptOptions
): string | null {
  const dispatch = buildAgentDispatchContext(db, taskDisplayId, options);
  if (!dispatch) return null;

  const category = resolveCategory(db, taskDisplayId);
  const template = options?.templateOverride ?? selectTemplate(category);
  const context = toPromptContext(dispatch, taskDisplayId, options);

  return renderPrompt(template, context);
}

function resolveCategory(db: BrainDB, taskDisplayId: string): TaskMetadata['category'] {
  const notes = getPmNotes(db, 'task', { display_id: taskDisplayId });
  if (notes.length === 0) return 'implementation';
  const meta = JSON.parse(notes[0].metadata!) as TaskMetadata;
  return meta.category;
}

function toPromptContext(
  dispatch: AgentDispatchContext,
  taskDisplayId: string,
  options?: BuildPromptOptions
): PromptContext {
  const ownership = dispatch.fileOwnership?.rules ?? [];
  const taskRule = ownership.find((r) => r.agentId === taskDisplayId);

  return {
    taskId: taskDisplayId,
    title: dispatch.context.title,
    description: dispatch.context.body || undefined,
    branch: `feat/${taskDisplayId.toLowerCase()}`,
    claimToken: '',
    projectDir: options?.projectDir ?? process.cwd(),
    fileOwnership: taskRule?.patterns,
    waveInfo: dispatch.waveInfo,
    conventions: options?.conventions,
  };
}
