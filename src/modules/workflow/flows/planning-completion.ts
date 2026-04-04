/**
 * Planning completion handler — ingests plan artifacts into the brain
 * knowledge base and creates an implementation task.
 *
 * Called as a seed step after spec-tests completes in the planning flow.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type { SeedResult } from '../runtime/types.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { createTask } from '../../pm/data/task-ops.js';
import { slugify } from '../../../utils.js';

const PLAN_ARTIFACTS = [
  'spec.md',
  'design.md',
  'acceptance-criteria.md',
  'critic-report.md',
] as const;

interface CompletionParams {
  projectDir: string;
  planId: string;
  brief: string;
  workflowName: string;
  project: string;
  workstream: number;
  db: BrainDB;
  config: BrainConfig;
  embedder: Embedder;
}

/** Build frontmatter for a plan artifact note. */
function buildArtifactFrontmatter(
  planId: string,
  workflowName: string,
  title: string,
  artifactName: string
): string {
  const now = new Date().toISOString().slice(0, 10);
  const id = slugify(`plan-${planId}-${artifactName.replace('.md', '')}`);
  return [
    '---',
    `id: ${id}`,
    `title: "${title}"`,
    'type: plan-artifact',
    'tier: slow',
    'module: sessions',
    'visibility: private',
    `tags: [plan:${planId}, workflow:${workflowName}]`,
    `created: ${now}`,
    `modified: ${now}`,
    '---',
  ].join('\n');
}

/** Ingest a single plan artifact file as a brain note. */
async function ingestArtifact(
  params: CompletionParams,
  artifactName: string
): Promise<string | null> {
  const artifactPath = resolve(params.projectDir, '.plans', params.planId, artifactName);
  if (!existsSync(artifactPath)) return null;

  const rawContent = readFileSync(artifactPath, 'utf-8');
  const title = `Plan ${params.planId}: ${artifactName.replace('.md', '')}`;
  const frontmatter = buildArtifactFrontmatter(
    params.planId,
    params.workflowName,
    title,
    artifactName
  );
  const fullContent = `${frontmatter}\n\n${rawContent}`;

  const hash = createHash('sha256').update(fullContent).digest('hex');
  const destDir = resolve(params.config.notesDir, 'modules', 'sessions');
  const destPath = resolve(destDir, `plan-${params.planId}-${artifactName}`);

  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(destDir, { recursive: true });
  writeFileSync(destPath, fullContent, 'utf-8');

  const noteId = await indexSingleFile(
    params.db,
    params.embedder,
    destPath,
    fullContent,
    hash,
    Date.now()
  );
  return noteId;
}

/** Ingest all plan artifacts and return their note IDs. */
async function ingestAllArtifacts(
  params: CompletionParams
): Promise<Map<string, string>> {
  const noteIds = new Map<string, string>();
  for (const artifact of PLAN_ARTIFACTS) {
    const noteId = await ingestArtifact(params, artifact);
    if (noteId) noteIds.set(artifact, noteId);
  }
  return noteIds;
}

/** Create an implementation task referencing the ingested artifacts. */
async function createImplementationTask(
  params: CompletionParams,
  noteIds: Map<string, string>
): Promise<string | null> {
  const titleBrief = params.brief.slice(0, 60);
  const title = `Implement: ${titleBrief}${params.brief.length > 60 ? '...' : ''}`;

  const references = Array.from(noteIds.values());
  const refList = Array.from(noteIds.entries())
    .map(([name, id]) => `- ${name}: ${id}`)
    .join('\n');

  const description = [
    `Implementation task generated from planning workflow (plan: ${params.planId}).`,
    '',
    '## Plan Artifacts',
    refList,
  ].join('\n');

  const result = await createTask(params.db, params.config, params.embedder, {
    project: params.project,
    workstream: params.workstream,
    name: title,
    category: 'implementation',
    priority: 'high',
    description,
    references,
  });

  if (!result.ok) return null;
  return result.data.display_id;
}

/** Remove .plans/<planId>/ after successful ingestion. */
function cleanupPlanDir(projectDir: string, planId: string): void {
  const planDir = resolve(projectDir, '.plans', planId);
  if (existsSync(planDir)) {
    rmSync(planDir, { recursive: true, force: true });
  }
}

/** Build the seed function for the planning completion step. */
export function buildPlanningCompletion(params: CompletionParams): () => Promise<SeedResult> {
  return async (): Promise<SeedResult> => {
    const noteIds = await ingestAllArtifacts(params);
    if (noteIds.size === 0) {
      return {
        data: { ingestedCount: '0' },
        output: 'No plan artifacts found to ingest.',
      };
    }

    const taskDisplayId = await createImplementationTask(params, noteIds);
    cleanupPlanDir(params.projectDir, params.planId);

    const output = [
      `Ingested ${noteIds.size} plan artifact(s) as brain notes.`,
      taskDisplayId ? `Created implementation task: ${taskDisplayId}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      data: {
        ingestedCount: String(noteIds.size),
        implementationTask: taskDisplayId ?? '',
        noteIds: Array.from(noteIds.values()).join(','),
      },
      output,
    };
  };
}
