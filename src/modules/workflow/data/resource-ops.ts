import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import { ok, fail } from '../../../errors.js';
import type { Result } from '../../../errors.js';
import type { ResourceMetadata, FastPathResource } from '../types.js';
import { writeResource, updateResourceSidecar } from '../engine/fast-path.js';

export async function createResource(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  resource: ResourceMetadata,
): Promise<Result<FastPathResource>> {
  return writeResource(db, config, embedder, resource);
}

export async function updateResource(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  resourceId: string,
  updates: Partial<ResourceMetadata>,
): Promise<Result<FastPathResource>> {
  return updateResourceSidecar(db, config, embedder, resourceId, updates);
}

export function listResources(
  db: BrainDB,
  filters?: { type?: string; project?: string; status?: string },
): Result<FastPathResource[]> {
  const noteIds = db.getModuleNoteIds({ module: 'workflow', type: 'resource' });
  const notes = db.getNotesByIds(noteIds);

  const resources: FastPathResource[] = [];
  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;

    if (filters?.type && meta.resource_type !== filters.type) continue;
    if (filters?.project && meta.project !== filters.project) continue;
    if (filters?.status && meta.status !== filters.status) continue;

    resources.push({
      id: meta.display_id as string,
      type: meta.resource_type as string,
      project: meta.project as string,
      status: meta.status as string,
      data: (typeof meta.data === 'string' ? JSON.parse(meta.data) : meta.data ?? {}) as Record<string, unknown>,
      updatedAt: note.modifiedAt ?? note.createdAt ?? new Date().toISOString(),
    });
  }

  return ok(resources);
}

export function getResource(
  db: BrainDB,
  resourceId: string,
): Result<FastPathResource> {
  const noteIds = db.getModuleNoteIds({ module: 'workflow', type: 'resource' });
  const notes = db.getNotesByIds(noteIds);

  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.display_id !== resourceId) continue;

    return ok({
      id: meta.display_id as string,
      type: meta.resource_type as string,
      project: meta.project as string,
      status: meta.status as string,
      data: (typeof meta.data === 'string' ? JSON.parse(meta.data) : meta.data ?? {}) as Record<string, unknown>,
      updatedAt: note.modifiedAt ?? note.createdAt ?? new Date().toISOString(),
    });
  }

  return fail('NOT_FOUND', `Resource "${resourceId}" not found`);
}

export async function releaseResource(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  resourceId: string,
): Promise<Result<FastPathResource>> {
  return updateResourceSidecar(db, config, embedder, resourceId, { status: 'released' });
}
