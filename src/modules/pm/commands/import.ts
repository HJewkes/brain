import { readFileSync } from 'node:fs';
import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import { formatError, fail } from '../errors.js';
import type { Result } from '../errors.js';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type { TaskPriority } from '../types.js';
import { createProject } from '../data/project-ops.js';
import { createWorkstream } from '../data/workstream-ops.js';
import { createTask } from '../data/task-ops.js';
import { resolveDisplayId } from '../data/queries.js';

export interface ImportTaskDef {
  name: string;
  description: string;
  priority?: TaskPriority;
  depends_on?: string[];
}

export interface ImportWorkstreamDef {
  name: string;
  tasks?: ImportTaskDef[];
}

export interface ImportProjectDef {
  name: string;
  prefix: string;
  workstreams?: ImportWorkstreamDef[];
}

interface CreatedItem {
  type: 'project' | 'workstream' | 'task';
  display_id: string;
  name: string;
}

interface ImportResult {
  created: CreatedItem[];
  errors: Array<{ context: string; code: string; message: string }>;
}

function validateImportDef(data: unknown): Result<ImportProjectDef> {
  if (!data || typeof data !== 'object') {
    return fail('INVALID_INPUT', 'Import data must be a JSON object');
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    return fail('INVALID_INPUT', 'Import data must have a non-empty "name" field');
  }

  if (typeof obj.prefix !== 'string' || obj.prefix.trim().length === 0) {
    return fail('INVALID_INPUT', 'Import data must have a non-empty "prefix" field');
  }

  if (obj.workstreams !== undefined && !Array.isArray(obj.workstreams)) {
    return fail('INVALID_INPUT', '"workstreams" must be an array');
  }

  const workstreams = (obj.workstreams as ImportWorkstreamDef[] | undefined) ?? [];
  for (let i = 0; i < workstreams.length; i++) {
    const ws = workstreams[i];
    if (typeof ws.name !== 'string' || ws.name.trim().length === 0) {
      return fail('INVALID_INPUT', `Workstream at index ${i} must have a non-empty "name" field`);
    }
    if (ws.tasks !== undefined && !Array.isArray(ws.tasks)) {
      return fail('INVALID_INPUT', `Workstream "${ws.name}" tasks must be an array`);
    }
    const tasks = ws.tasks ?? [];
    for (let j = 0; j < tasks.length; j++) {
      const t = tasks[j];
      if (typeof t.name !== 'string' || t.name.trim().length === 0) {
        return fail(
          'INVALID_INPUT',
          `Task at index ${j} in workstream "${ws.name}" must have a non-empty "name"`
        );
      }
    }
  }

  return { ok: true, data: data as ImportProjectDef };
}

export async function executeImport(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  def: ImportProjectDef
): Promise<ImportResult> {
  const result: ImportResult = { created: [], errors: [] };

  const projectResult = await createProject(db, config, embedder, {
    name: def.name,
    prefix: def.prefix.toUpperCase(),
  });

  if (!projectResult.ok) {
    result.errors.push({
      context: `project "${def.name}"`,
      code: projectResult.error.code,
      message: projectResult.error.message,
    });
    return result;
  }

  result.created.push({
    type: 'project',
    display_id: projectResult.data.display_id,
    name: def.name,
  });

  const prefix = def.prefix.toUpperCase();
  const taskDisplayIds: Map<string, string> = new Map();
  const deferredDeps: Array<{ taskDisplayId: string; dependsOn: string[] }> = [];

  for (const wsDef of def.workstreams ?? []) {
    const wsResult = await createWorkstream(db, config, embedder, {
      project: prefix,
      name: wsDef.name,
    });

    if (!wsResult.ok) {
      result.errors.push({
        context: `workstream "${wsDef.name}"`,
        code: wsResult.error.code,
        message: wsResult.error.message,
      });
      continue;
    }

    result.created.push({
      type: 'workstream',
      display_id: wsResult.data.display_id,
      name: wsDef.name,
    });

    const wsNumber = wsResult.data.number;

    for (const taskDef of wsDef.tasks ?? []) {
      const taskResult = await createTask(db, config, embedder, {
        project: prefix,
        workstream: wsNumber,
        name: taskDef.name,
        description: taskDef.description,
        priority: taskDef.priority,
      });

      if (!taskResult.ok) {
        result.errors.push({
          context: `task "${taskDef.name}"`,
          code: taskResult.error.code,
          message: taskResult.error.message,
        });
        continue;
      }

      result.created.push({
        type: 'task',
        display_id: taskResult.data.display_id,
        name: taskDef.name,
      });

      taskDisplayIds.set(taskResult.data.display_id, taskResult.data.display_id);

      if (taskDef.depends_on && taskDef.depends_on.length > 0) {
        deferredDeps.push({
          taskDisplayId: taskResult.data.display_id,
          dependsOn: taskDef.depends_on,
        });
      }
    }
  }

  for (const dep of deferredDeps) {
    const sourceResolved = resolveDisplayId(db, dep.taskDisplayId);
    if (!sourceResolved.ok) {
      result.errors.push({
        context: `dependency resolution for "${dep.taskDisplayId}"`,
        code: 'NOT_FOUND',
        message: `Could not resolve source task "${dep.taskDisplayId}"`,
      });
      continue;
    }

    const relations: Array<{ sourceId: string; targetId: string; type: string }> = [];
    for (const targetDisplayId of dep.dependsOn) {
      const targetResolved = resolveDisplayId(db, targetDisplayId);
      if (!targetResolved.ok) {
        result.errors.push({
          context: `dependency "${dep.taskDisplayId}" -> "${targetDisplayId}"`,
          code: 'NOT_FOUND',
          message: `Dependency target "${targetDisplayId}" not found`,
        });
        continue;
      }
      relations.push({
        sourceId: sourceResolved.data,
        targetId: targetResolved.data,
        type: 'depends_on',
      });
    }

    if (relations.length > 0) {
      db.upsertRelations(sourceResolved.data, relations);
    }
  }

  return result;
}

export function createImportCommand(): Command {
  const cmd = new Command('import')
    .description('Import project structure from JSON')
    .requiredOption('--from-json <file>', 'JSON file to import')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        let rawData: unknown;
        try {
          const content = readFileSync(opts.fromJson, 'utf-8');
          rawData = JSON.parse(content);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const error = fail(
            'INVALID_INPUT',
            `Failed to read/parse "${opts.fromJson}": ${message}`
          );
          if (!error.ok) {
            process.stderr.write(formatError(error.error, !!opts.json) + '\n');
          }
          process.exitCode = 1;
          return;
        }

        const validated = validateImportDef(rawData);
        if (!validated.ok) {
          process.stderr.write(formatError(validated.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const result = await executeImport(svc.db, svc.config, svc.embedder, validated.data);

        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        } else {
          for (const item of result.created) {
            process.stdout.write(`Created ${item.type}: ${item.display_id} (${item.name})\n`);
          }
          for (const err of result.errors) {
            process.stderr.write(`Error [${err.code}] in ${err.context}: ${err.message}\n`);
          }
          if (result.created.length > 0 && result.errors.length === 0) {
            process.stdout.write(`\nImport complete: ${result.created.length} item(s) created.\n`);
          }
        }

        if (result.errors.length > 0 && result.created.length === 0) {
          process.exitCode = 1;
        }
      });
    });

  return cmd;
}
