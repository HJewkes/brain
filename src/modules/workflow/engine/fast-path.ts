import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { ok, fail } from '../../../errors.js';
import type { Result } from '../../../errors.js';
import type { ResourceMetadata, FastPathResource } from '../types.js';

function sidecarDir(config: BrainConfig): string {
  return join(config.notesDir, 'modules', 'workflow', 'resources');
}

function sidecarPath(config: BrainConfig, displayId: string): string {
  return join(sidecarDir(config), `${displayId}.json`);
}

function toFastPathResource(resource: ResourceMetadata): FastPathResource {
  return {
    id: resource.display_id,
    type: resource.resource_type,
    project: resource.project,
    status: resource.status,
    data: resource.data,
    updatedAt: new Date().toISOString(),
  };
}

function buildResourceMarkdown(resource: ResourceMetadata): string {
  const now = new Date().toISOString().slice(0, 10);
  const id = resource.display_id.toLowerCase() + '-resource';
  const dataJson = JSON.stringify(resource.data);
  const lines = [
    '---',
    `id: ${id}`,
    `title: "Resource ${resource.display_id}"`,
    'type: resource',
    'tier: fast',
    'module: workflow',
    `display_id: ${resource.display_id}`,
    `resource_type: ${resource.resource_type}`,
    `project: ${resource.project}`,
    `status: ${resource.status}`,
    `data: '${dataJson}'`,
    `created: ${now}`,
    `modified: ${now}`,
    '---',
    '',
    `# Resource ${resource.display_id}`,
    '',
    `Type: ${resource.resource_type}`,
    `Project: ${resource.project}`,
    '',
  ];
  return lines.join('\n');
}

function writeSidecarAtomic(config: BrainConfig, resource: FastPathResource): void {
  const dir = sidecarDir(config);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = join(dir, `.${resource.id}-${randomUUID().slice(0, 8)}.tmp`);
  const finalPath = sidecarPath(config, resource.id);
  writeFileSync(tmpPath, JSON.stringify(resource, null, 2), 'utf-8');
  renameSync(tmpPath, finalPath);
}

export async function writeResource(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  resource: ResourceMetadata
): Promise<Result<FastPathResource>> {
  const fastPathData = toFastPathResource(resource);

  try {
    writeSidecarAtomic(config, fastPathData);
  } catch {
    return fail('SIDECAR_WRITE_FAILED', `Failed to write sidecar for ${resource.display_id}`);
  }

  try {
    const markdown = buildResourceMarkdown(resource);
    const noteDir = join(config.notesDir, 'modules', 'workflow');
    if (!existsSync(noteDir)) {
      mkdirSync(noteDir, { recursive: true });
    }
    const filePath = join(noteDir, `${resource.display_id}.md`);
    writeFileSync(filePath, markdown, 'utf-8');
    const hash = createHash('sha256').update(markdown).digest('hex');
    await indexSingleFile(db, embedder, filePath, markdown, hash, Date.now());
  } catch {
    const sc = sidecarPath(config, resource.display_id);
    if (existsSync(sc)) {
      unlinkSync(sc);
    }
    return fail('DB_WRITE_FAILED', `Failed to index resource note for ${resource.display_id}`);
  }

  return ok(fastPathData);
}

export async function updateResourceSidecar(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  resourceId: string,
  updates: Partial<ResourceMetadata>
): Promise<Result<FastPathResource>> {
  const existing = readResourceFastPath(config.notesDir, resourceId);
  if (!existing) {
    return fail('NOT_FOUND', `Resource "${resourceId}" not found`);
  }

  const updated: FastPathResource = {
    ...existing,
    type: updates.resource_type ?? existing.type,
    project: updates.project ?? existing.project,
    status: updates.status ?? existing.status,
    data: updates.data ?? existing.data,
    updatedAt: new Date().toISOString(),
  };

  try {
    writeSidecarAtomic(config, updated);
  } catch {
    return fail('SIDECAR_WRITE_FAILED', `Failed to update sidecar for ${resourceId}`);
  }

  return ok(updated);
}

export function readResourceFastPath(notesDir: string, displayId: string): FastPathResource | null {
  const filePath = join(notesDir, 'modules', 'workflow', 'resources', `${displayId}.json`);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as FastPathResource;
  } catch {
    process.stderr.write(`fast-path: corrupt JSON in ${filePath}\n`);
    return null;
  }
}

export function listResourcesFastPath(notesDir: string, resourceType?: string): FastPathResource[] {
  const dir = join(notesDir, 'modules', 'workflow', 'resources');

  let entries: string[];
  try {
    entries = readdirSync(dir) as string[];
  } catch {
    return [];
  }

  const resources: FastPathResource[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;

    const filePath = join(dir, entry);
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as FastPathResource;
      if (resourceType && parsed.type !== resourceType) continue;
      resources.push(parsed);
    } catch {
      process.stderr.write(`fast-path: corrupt JSON in ${filePath}\n`);
    }
  }

  return resources;
}
