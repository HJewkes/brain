import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { formatError, fail, pmError } from '../errors.js';
import type { Result } from '../errors.js';
import type { TaskMetadata, TaskStatus } from '../types.js';
import {
  createTask,
  listTasks,
  getTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
} from '../data/task-ops.js';
import { getPmNotes, resolveProject } from '../data/queries.js';
import { generateClaim, validateClaimToken } from '../engine/claims.js';
import { validateTransition } from '../engine/state-machine.js';

function outputResult(data: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else if (Array.isArray(data)) {
    for (const item of data) {
      process.stdout.write(formatTaskLine(item) + '\n');
    }
    if (data.length === 0) {
      process.stdout.write('No tasks found.\n');
    }
  } else {
    process.stdout.write(formatTaskLine(data) + '\n');
  }
}

function formatTaskLine(task: unknown): string {
  const t = task as Record<string, unknown>;
  const title = t.title ? ` ${t.title}` : '';
  const priority = t.priority ? ` [${t.priority}]` : '';
  const mode = t.mode ? ` (${t.mode})` : '';
  const vs = t.virtualStates as string[] | undefined;
  const virtualStates = vs && vs.length > 0 ? ` ${vs.join(' ')}` : '';
  return `${t.display_id} -${title}${priority} ${t.status}${mode}${virtualStates}`;
}

export function createTaskCommands(): Command {
  const cmd = new Command('task').description('Manage tasks');

  cmd
    .command('add')
    .description('Create a new task')
    .argument('<name>', 'Task name')
    .option('--project <prefix>', 'Project prefix (uses active if omitted)')
    .requiredOption('--workstream <n>', 'Workstream number', parseInt)
    .option('--mode <mode>', 'Task mode (auto|interactive|review)')
    .option('--category <cat>', 'Task category')
    .option('--priority <pri>', 'Task priority (critical|high|medium|low)')
    .option('--depends-on <ids...>', 'Display IDs this task depends on')
    .option('--json', 'Output JSON')
    .action(async (name, opts) => {
      await withBrain(async (svc) => {
        const projectResult = resolveProject(svc.db, opts.project);
        if (!projectResult.ok) {
          process.stderr.write(formatError(projectResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        const project = projectResult.data;
        const result = await createTask(svc.db, svc.config, svc.embedder, {
          project,
          workstream: opts.workstream,
          name,
          mode: opts.mode as never,
          category: opts.category as never,
          priority: opts.priority as never,
          dependsOn: opts.dependsOn,
        });
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  cmd
    .command('list')
    .description('List tasks')
    .option('--project <prefix>', 'Filter by project prefix')
    .option('--workstream <n>', 'Filter by workstream number', parseInt)
    .option('--status <status>', 'Filter by status')
    .option('--priority <level>', 'Filter by priority (critical|high|medium|low)')
    .option('--category <cat>', 'Filter by category')
    .option('--search <text>', 'Filter by title (case-insensitive substring)')
    .option('--json', 'Output JSON')
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const projectResult = resolveProject(svc.db, opts.project);
        if (!projectResult.ok) {
          process.stderr.write(formatError(projectResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        const result = listTasks(svc.db, projectResult.data, {
          workstream: opts.workstream,
          status: opts.status,
          priority: opts.priority,
          category: opts.category,
          search: opts.search,
        });
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  cmd
    .command('show')
    .description('Show task detail')
    .argument('<id>', 'Task display ID (e.g. WEB-01.03)')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const displayId = id.toUpperCase();
        const result = getTask(svc.db, displayId);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const task = result.data;

        if (opts.json) {
          const body = readTaskBodyFromDb(svc.db, displayId);
          process.stdout.write(JSON.stringify({ ...task, body }, null, 2) + '\n');
          return;
        }

        const lines: string[] = [];
        lines.push(formatTaskLine(task));
        lines.push(`  Status: ${task.status} | Priority: ${task.priority} | Category: ${task.category}`);
        if (task.mode) lines.push(`  Mode: ${task.mode}`);
        if (task.depends_on && task.depends_on.length > 0) {
          lines.push(`  Depends on: ${task.depends_on.join(', ')}`);
        }
        if (task.virtualStates.length > 0) {
          lines.push(`  Virtual states: ${task.virtualStates.join(' ')}`);
        }

        const body = readTaskBodyFromDb(svc.db, displayId);
        if (body) {
          lines.push('');
          lines.push(body);
        }

        process.stdout.write(lines.join('\n') + '\n');
      });
    });

  cmd
    .command('update')
    .description('Update task fields')
    .argument('<id>', 'Task display ID')
    .option('--mode <mode>', 'New mode')
    .option('--category <cat>', 'New category')
    .option('--priority <pri>', 'New priority')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const updates: Record<string, unknown> = {};
        if (opts.mode) updates.mode = opts.mode;
        if (opts.category) updates.category = opts.category;
        if (opts.priority) updates.priority = opts.priority;

        const result = await updateTask(
          svc.db,
          svc.config,
          svc.embedder,
          id.toUpperCase(),
          updates
        );
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  cmd
    .command('done')
    .description('Mark task as done')
    .argument('<id>', 'Task display ID')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const result = await updateTaskStatus(
          svc.db,
          svc.config,
          svc.embedder,
          id.toUpperCase(),
          'done' as TaskStatus
        );
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  cmd
    .command('block')
    .description('Mark task as blocked')
    .argument('<id>', 'Task display ID')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const result = await updateTaskStatus(
          svc.db,
          svc.config,
          svc.embedder,
          id.toUpperCase(),
          'blocked' as TaskStatus
        );
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  cmd
    .command('unblock')
    .description('Unblock a task (set to pending)')
    .argument('<id>', 'Task display ID')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const result = await updateTaskStatus(
          svc.db,
          svc.config,
          svc.embedder,
          id.toUpperCase(),
          'pending' as TaskStatus
        );
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  cmd
    .command('delete')
    .description('Delete a task')
    .argument('<id>', 'Task display ID')
    .option('--force', 'Force delete even with dependents')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const result = await deleteTask(svc.db, svc.config, id.toUpperCase(), opts.force);
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        if (opts.json) {
          process.stdout.write(JSON.stringify({ deleted: true, id: id.toUpperCase() }) + '\n');
        } else {
          process.stdout.write(`Deleted task ${id.toUpperCase()}\n`);
        }
      });
    });

  cmd
    .command('claim')
    .description('Claim an eligible task (pending → claimed)')
    .argument('<id>', 'Task display ID')
    .option('--start', 'Also start the task (claim + start atomically)')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const displayId = id.toUpperCase();
        const taskResult = getTask(svc.db, displayId);
        if (!taskResult.ok) {
          process.stderr.write(formatError(taskResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        if (taskResult.data.status === 'claimed') {
          const err = pmError('ALREADY_CLAIMED', `Task "${displayId}" is already claimed`);
          process.stderr.write(formatError(err, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const transResult = validateTransition(taskResult.data.status, 'claimed');
        if (!transResult.ok) {
          process.stderr.write(formatError(transResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const claim = generateClaim();
        const metaResult = await updateTaskMetadataFields(
          svc.db,
          svc.config,
          svc.embedder,
          displayId,
          { status: 'claimed', claim_token: claim.token, claimed_at: claim.claimedAt }
        );
        if (!metaResult.ok) {
          process.stderr.write(formatError(metaResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        if (opts.start) {
          const startResult = await updateTaskStatus(
            svc.db,
            svc.config,
            svc.embedder,
            displayId,
            'in-progress' as TaskStatus
          );
          if (!startResult.ok) {
            process.stderr.write(formatError(startResult.error, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }

          if (opts.json) {
            process.stdout.write(JSON.stringify({ ...startResult.data, token: claim.token }, null, 2) + '\n');
          } else {
            process.stdout.write(`${displayId} claimed and started (in-progress)\n`);
          }
          return;
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify({ ...metaResult.data, token: claim.token }, null, 2) + '\n');
        } else {
          process.stdout.write(`${displayId} claimed. Token: ${claim.token}\n`);
          process.stdout.write(`Start: brain pm task start ${displayId} --token ${claim.token}\n`);
        }
      });
    });

  cmd
    .command('start')
    .description('Start a claimed task (claimed → in-progress)')
    .argument('<id>', 'Task display ID')
    .requiredOption('--token <token>', 'Claim token')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const displayId = id.toUpperCase();
        const taskResult = getTask(svc.db, displayId);
        if (!taskResult.ok) {
          process.stderr.write(formatError(taskResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const meta = taskResult.data;
        if (!meta.claim_token) {
          const err = pmError('INVALID_CLAIM_TOKEN', 'Task has no active claim');
          process.stderr.write(formatError(err, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const tokenCheck = validateClaimToken(meta.claim_token, opts.token);
        if (!tokenCheck.ok) {
          process.stderr.write(formatError(tokenCheck.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const result = await updateTaskStatus(
          svc.db,
          svc.config,
          svc.embedder,
          displayId,
          'in-progress' as TaskStatus
        );
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);
      });
    });

  cmd
    .command('release')
    .description('Release a claim (claimed → pending)')
    .argument('<id>', 'Task display ID')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const displayId = id.toUpperCase();
        const taskResult = getTask(svc.db, displayId);
        if (!taskResult.ok) {
          process.stderr.write(formatError(taskResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const transResult = validateTransition(taskResult.data.status, 'pending');
        if (!transResult.ok) {
          process.stderr.write(formatError(transResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const metaResult = await updateTaskMetadataFields(
          svc.db,
          svc.config,
          svc.embedder,
          displayId,
          { status: 'pending', claim_token: '', claimed_at: '' }
        );
        if (!metaResult.ok) {
          process.stderr.write(formatError(metaResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(metaResult.data, !!opts.json);
      });
    });

  return cmd;
}

function readTaskBodyFromDb(db: BrainDB, displayId: string): string {
  const notes = getPmNotes(db, 'task', { display_id: displayId });
  if (notes.length === 0) return '';
  const note = notes[0];
  if (!existsSync(note.filePath)) return '';
  const content = readFileSync(note.filePath, 'utf-8');
  const fmEnd = content.indexOf('\n---', 4);
  if (fmEnd === -1) return '';
  let body = content.slice(fmEnd + 4).trim();
  const headingEnd = body.indexOf('\n');
  if (headingEnd !== -1 && body.startsWith('#')) {
    body = body.slice(headingEnd + 1).trim();
  }
  return body;
}

function replaceFrontmatterField(content: string, field: string, value: string): string {
  const endOfFrontmatter = content.indexOf('\n---', 4);
  if (endOfFrontmatter === -1) return content;

  const frontmatter = content.slice(0, endOfFrontmatter);
  const rest = content.slice(endOfFrontmatter);
  const fieldRegex = new RegExp(`^${field}:.*$`, 'm');
  const quoted = value.includes(' ') ? `"${value}"` : value;

  if (fieldRegex.test(frontmatter)) {
    if (!value) {
      return frontmatter.replace(new RegExp(`\n${field}:.*$`, 'm'), '') + rest;
    }
    return frontmatter.replace(fieldRegex, `${field}: ${quoted}`) + rest;
  }
  if (!value) return content;
  return frontmatter + `\n${field}: ${quoted}` + rest;
}

async function updateTaskMetadataFields(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  displayId: string,
  fields: Record<string, string>
): Promise<Result<TaskMetadata>> {
  const notes = getPmNotes(db, 'task', { display_id: displayId });
  if (notes.length === 0) {
    return fail('NOT_FOUND', `Task "${displayId}" not found`);
  }

  const note = notes[0];
  const filePath = note.filePath;
  if (!existsSync(filePath)) {
    return fail('NOT_FOUND', `Task file not found at "${filePath}"`);
  }

  let content = readFileSync(filePath, 'utf-8');
  for (const [key, value] of Object.entries(fields)) {
    content = replaceFrontmatterField(content, key, value);
  }
  const now = new Date().toISOString().slice(0, 10);
  content = replaceFrontmatterField(content, 'modified', now);

  writeFileSync(filePath, content, 'utf-8');

  const hash = createHash('sha256').update(content).digest('hex');
  const noteId = await indexSingleFile(db, embedder, filePath, content, hash, Date.now());

  const refreshedNote = db.getNoteById(noteId);
  const refreshedMeta = JSON.parse(refreshedNote!.metadata!) as TaskMetadata;

  return { ok: true, data: refreshedMeta };
}
