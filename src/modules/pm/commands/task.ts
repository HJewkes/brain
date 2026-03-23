import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Command } from '@commander-js/extra-typings';
import { withBrain } from '../../../services/brain-service.js';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder, Relation } from '../../../types.js';
import { replaceFrontmatterField } from '../../../utils.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { formatError, fail, pmError } from '../errors.js';
import type { Result } from '../errors.js';
import { resolveWorkstreamFilter, parseDisplayId } from '../ids.js';
import type { TaskMetadata, TaskStatus, VirtualState } from '../types.js';
import {
  createTask,
  listTasks,
  getTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
} from '../data/task-ops.js';
import type { ListMode, EnrichedTaskFields } from '../data/task-ops.js';
import {
  getPmNotes,
  resolveProject,
  resolveProjectOrAll,
  getAllProjectPrefixes,
  resolveDisplayId,
} from '../data/queries.js';
import { generateClaim, validateClaimToken } from '../engine/claims.js';
import { validateTransition } from '../engine/state-machine.js';
import { readTaskBody } from '../engine/dispatch.js';
import { checkNamespaceMismatch } from '../engine/routing.js';
import { computeDispatchWave } from './dispatch-wave.js';

function outputResult(data: unknown, json: boolean, filters?: Record<string, string>): void {
  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else if (Array.isArray(data)) {
    for (const item of data) {
      process.stdout.write(formatTaskLine(item) + '\n');
    }
    if (data.length === 0) {
      if (filters && Object.keys(filters).length > 0) {
        const filterStr = Object.entries(filters)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        process.stdout.write(`0 tasks found matching: ${filterStr}\n`);
      } else {
        process.stdout.write('No tasks found.\n');
      }
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
    .requiredOption('--workstream <id>', 'Workstream number or display ID (e.g. 1 or PROJ-01)')
    .option('--mode <mode>', 'Task mode (auto|interactive|review)')
    .option('--category <cat>', 'Task category')
    .option('--priority <pri>', 'Task priority (critical|high|medium|low)')
    .option('--depends-on <ids...>', 'Display IDs this task depends on')
    .requiredOption(
      '--description <text>',
      'Task description/body content (required for search indexing)'
    )
    .option('--due <date>', 'Due date (YYYY-MM-DD)')
    .option('--milestone <name>', 'Milestone name')
    .option('--done-when <text>', 'Completion definition (1-2 sentences)')
    .option(
      '--ac <criterion>',
      'Acceptance criterion (repeatable)',
      (val: string, prev: string[]) => [...prev, val],
      [] as string[]
    )
    .option('--refs <refs>', 'Comma-separated file/doc references')
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
        // Parse workstream: accept integer or display ID (e.g. PROJ-01)
        let workstreamNum: number;
        const wsStr = String(opts.workstream);
        if (/^\d+$/.test(wsStr)) {
          workstreamNum = parseInt(wsStr, 10);
        } else {
          const parsed = parseDisplayId(wsStr.toUpperCase());
          if (parsed?.workstream !== undefined) {
            workstreamNum = parsed.workstream;
          } else {
            process.stderr.write(
              formatError(
                pmError(
                  'INVALID_INPUT',
                  `Invalid workstream: ${wsStr}. Use a number (e.g. 1) or display ID (e.g. ${project}-01)`
                ),
                !!opts.json
              ) + '\n'
            );
            process.exitCode = 1;
            return;
          }
        }
        const result = await createTask(svc.db, svc.config, svc.embedder, {
          project,
          workstream: workstreamNum,
          name,
          mode: opts.mode as never,
          category: opts.category as never,
          priority: opts.priority as never,
          dependsOn: opts.dependsOn,
          description: opts.description,
          dueDate: opts.due,
          milestone: opts.milestone,
          doneWhen: opts.doneWhen,
          acceptanceCriteria: opts.ac && opts.ac.length > 0 ? opts.ac : undefined,
          references: opts.refs ? opts.refs.split(',').map((r: string) => r.trim()) : undefined,
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
    .option('--workstream <n>', 'Filter by workstream number or display ID (e.g. 6 or PROJ-06)')
    .option('--status <status>', 'Filter by status')
    .option('--priority <level>', 'Filter by priority (critical|high|medium|low)')
    .option('--category <cat>', 'Filter by category')
    .option('--search <text>', 'Filter by keyword (searches title, body, and display ID)')
    .option('--due-before <date>', 'Filter tasks due before date (YYYY-MM-DD)')
    .option('--milestone <name>', 'Filter by milestone')
    .option('--json', 'Output JSON')
    .option('--full', 'Include complete task body in JSON output')
    .option('--short', 'Minimal output — structural fields only, no descriptions')
    .option('--sort <field>', 'Sort by: priority, workstream, status, created')
    .option('--limit <n>', 'Limit number of results', parseInt)
    .action(async (opts) => {
      await withBrain(async (svc) => {
        const projectResult = resolveProjectOrAll(svc.db, opts.project);
        if (!projectResult.ok) {
          process.stderr.write(formatError(projectResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        const prefixes =
          projectResult.data === null ? getAllProjectPrefixes(svc.db) : [projectResult.data];

        if (prefixes.length === 0) {
          process.stderr.write(
            formatError(
              pmError(
                'INVALID_INPUT',
                'No projects found. Run "brain pm onboard <name>" to create one.'
              ),
              !!opts.json
            ) + '\n'
          );
          process.exitCode = 1;
          return;
        }

        let workstreamNumber: number | undefined;
        if (opts.workstream) {
          const wsResult = resolveWorkstreamFilter(opts.workstream);
          if (!wsResult.ok) {
            process.stderr.write(formatError(wsResult.error, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }
          workstreamNumber = wsResult.data;
        }

        const validStatuses = [
          'pending',
          'claimed',
          'in-progress',
          'done',
          'blocked',
          'cancelled',
          'eligible',
          'ready',
          'all',
        ];
        const validPriorities = ['critical', 'high', 'medium', 'low'];

        if (opts.status && !validStatuses.includes(opts.status)) {
          process.stderr.write(
            formatError(
              pmError(
                'INVALID_INPUT',
                `Invalid status "${opts.status}". Valid values: ${validStatuses.join(', ')}`
              ),
              !!opts.json
            ) + '\n'
          );
          process.exitCode = 1;
          return;
        }
        if (opts.priority && !validPriorities.includes(opts.priority)) {
          process.stderr.write(
            formatError(
              pmError(
                'INVALID_INPUT',
                `Invalid priority "${opts.priority}". Valid values: ${validPriorities.join(', ')}`
              ),
              !!opts.json
            ) + '\n'
          );
          process.exitCode = 1;
          return;
        }

        const mode: ListMode = opts.full ? 'full' : opts.short ? 'short' : 'default';
        let allTasks: (TaskMetadata & EnrichedTaskFields & { virtualStates: VirtualState[] })[] =
          [];

        for (const prefix of prefixes) {
          const result = listTasks(
            svc.db,
            prefix,
            {
              workstream: workstreamNumber,
              status: opts.status,
              priority: opts.priority,
              category: opts.category,
              search: opts.search,
              dueBefore: opts.dueBefore,
              milestone: opts.milestone,
            },
            mode
          );
          if (!result.ok) {
            process.stderr.write(formatError(result.error, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }
          allTasks = allTasks.concat(result.data);
        }

        let tasks = allTasks;

        if (opts.sort) {
          const PRIORITY_ORDER: Record<string, number> = {
            critical: 0,
            high: 1,
            medium: 2,
            low: 3,
          };
          const STATUS_ORDER: Record<string, number> = {
            pending: 0,
            claimed: 1,
            'in-progress': 2,
            blocked: 3,
            done: 4,
          };

          const TERMINAL_STATUSES = new Set(['done', 'cancelled']);
          tasks = [...tasks].sort((a, b) => {
            switch (opts.sort) {
              case 'priority': {
                const aTerminal = TERMINAL_STATUSES.has(a.status) ? 1 : 0;
                const bTerminal = TERMINAL_STATUSES.has(b.status) ? 1 : 0;
                if (aTerminal !== bTerminal) return aTerminal - bTerminal;
                return (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
              }
              case 'workstream':
                return a.workstream - b.workstream;
              case 'status':
                return (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
              default:
                return 0;
            }
          });
        }

        if (opts.limit && opts.limit > 0) {
          tasks = tasks.slice(0, opts.limit);
        }

        const activeFilters: Record<string, string> = {};
        if (opts.workstream) activeFilters.workstream = opts.workstream;
        if (opts.status) activeFilters.status = opts.status;
        if (opts.priority) activeFilters.priority = opts.priority;
        if (opts.category) activeFilters.category = opts.category;
        if (opts.search) activeFilters.search = opts.search;
        if (opts.dueBefore) activeFilters.dueBefore = opts.dueBefore;
        if (opts.milestone) activeFilters.milestone = opts.milestone;

        outputResult(tasks, !!opts.json, activeFilters);
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
        const redirectMsg = checkNamespaceMismatch(displayId, 'task');
        if (redirectMsg) {
          process.stderr.write(`Error: ${redirectMsg}\n`);
          process.exitCode = 1;
          return;
        }
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
        lines.push(
          `  Status: ${task.status} | Priority: ${task.priority} | Category: ${task.category}`
        );
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
    .option('--due <date>', 'Due date (YYYY-MM-DD)')
    .option('--milestone <name>', 'Milestone name')
    .option('--depends-on <ids...>', 'Display IDs this task depends on')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const redirectMsg = checkNamespaceMismatch(id.toUpperCase(), 'task');
        if (redirectMsg) {
          process.stderr.write(`Error: ${redirectMsg}\n`);
          process.exitCode = 1;
          return;
        }
        const updates: Record<string, unknown> = {};
        if (opts.mode) updates.mode = opts.mode;
        if (opts.category) updates.category = opts.category;
        if (opts.priority) updates.priority = opts.priority;
        if (opts.due) updates.due_date = opts.due;
        if (opts.milestone) updates.milestone = opts.milestone;

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

        if (opts.dependsOn && opts.dependsOn.length > 0) {
          const taskResolved = resolveDisplayId(svc.db, id.toUpperCase());
          if (taskResolved.ok) {
            const taskNoteId = taskResolved.data;
            const relations: Relation[] = [];
            for (const depId of opts.dependsOn as string[]) {
              const depResolved = resolveDisplayId(svc.db, depId.toUpperCase());
              if (depResolved.ok) {
                relations.push({
                  sourceId: taskNoteId,
                  targetId: depResolved.data,
                  type: 'depends_on',
                });
              } else {
                process.stderr.write(`Warning: dependency "${depId}" not found, skipping\n`);
              }
            }
            if (relations.length > 0) {
              svc.db.upsertRelations(taskNoteId, relations);
            }
          }
        }

        outputResult(result.data, !!opts.json);
      });
    });

  cmd
    .command('done')
    .description('Mark task as done (low-level — use "brain pm complete" for full impact tracking)')
    .argument('<id>', 'Task display ID')
    .option('--token <token>', 'Claim token for verification')
    .option('--cascade', 'Show newly eligible tasks after completion')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const displayId = id.toUpperCase();
        const redirectMsg = checkNamespaceMismatch(displayId, 'task');
        if (redirectMsg) {
          process.stderr.write(`Error: ${redirectMsg}\n`);
          process.exitCode = 1;
          return;
        }

        const taskResult = getTask(svc.db, displayId);
        if (!taskResult.ok) {
          process.stderr.write(formatError(taskResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        if (opts.token) {
          if (taskResult.data.claim_token && taskResult.data.claim_token !== opts.token) {
            process.stderr.write(
              `Warning: Token mismatch (expected ${taskResult.data.claim_token}, got ${opts.token})\n`
            );
          }
        }

        const currentStatus = taskResult.data.status;

        if (currentStatus === 'done') {
          const err = pmError('ALREADY_COMPLETED', `Task "${displayId}" is already completed`);
          process.stderr.write(formatError(err, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        if (currentStatus === 'cancelled' || currentStatus === 'pruned') {
          const err = pmError(
            'INVALID_TRANSITION',
            `Task "${displayId}" is ${currentStatus} and cannot be completed`
          );
          process.stderr.write(formatError(err, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        if (currentStatus === 'pending') {
          process.stderr.write(`Auto-claiming ${displayId}...\n`);
          const claim = generateClaim();
          const claimResult = await updateTaskMetadataFields(
            svc.db,
            svc.config,
            svc.embedder,
            displayId,
            { status: 'claimed', claim_token: claim.token, claimed_at: claim.claimedAt }
          );
          if (!claimResult.ok) {
            process.stderr.write(formatError(claimResult.error, !!opts.json) + '\n');
            process.exitCode = 1;
            return;
          }

          process.stderr.write(`Auto-starting ${displayId}...\n`);
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
        } else if (currentStatus === 'claimed') {
          process.stderr.write(`Auto-starting ${displayId}...\n`);
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
        }

        const result = await updateTaskStatus(
          svc.db,
          svc.config,
          svc.embedder,
          displayId,
          'done' as TaskStatus
        );
        if (!result.ok) {
          process.stderr.write(formatError(result.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }
        outputResult(result.data, !!opts.json);

        if (opts.cascade) {
          const taskProject = result.data.project;
          const wave = computeDispatchWave(svc.db, taskProject);
          const eligible = wave.eligible;
          if (eligible.length > 0) {
            process.stdout.write(
              `\nPost-merge cascade: ${eligible.length} task${eligible.length !== 1 ? 's' : ''} now eligible\n`
            );
            for (const t of eligible) {
              process.stdout.write(`  ${t.displayId} [${t.priority}] ${t.title}\n`);
            }
          } else {
            process.stdout.write('\nPost-merge cascade: no new tasks unblocked\n');
          }
        }
      });
    });

  cmd
    .command('block')
    .description('Mark task as blocked')
    .argument('<id>', 'Task display ID')
    .option('--reason <text>', 'Reason for blocking')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const redirectMsg = checkNamespaceMismatch(id.toUpperCase(), 'task');
        if (redirectMsg) {
          process.stderr.write(`Error: ${redirectMsg}\n`);
          process.exitCode = 1;
          return;
        }
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
        if (opts.reason) {
          await updateTaskMetadataFields(svc.db, svc.config, svc.embedder, id.toUpperCase(), {
            block_reason: opts.reason,
          });
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
        const redirectMsg = checkNamespaceMismatch(id.toUpperCase(), 'task');
        if (redirectMsg) {
          process.stderr.write(`Error: ${redirectMsg}\n`);
          process.exitCode = 1;
          return;
        }
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
    .command('reset')
    .description('Reset a completed task to pending')
    .argument('<id>', 'Task display ID')
    .option('--force', 'Skip confirmation (required)')
    .option('--json', 'Output JSON')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const displayId = id.toUpperCase();
        const redirectMsg = checkNamespaceMismatch(displayId, 'task');
        if (redirectMsg) {
          process.stderr.write(`Error: ${redirectMsg}\n`);
          process.exitCode = 1;
          return;
        }

        if (!opts.force) {
          process.stderr.write(
            `Error: --force is required to reset a completed task. ` +
              `This clears claim token and all progress metadata.\n`
          );
          process.exitCode = 1;
          return;
        }

        const taskResult = getTask(svc.db, displayId);
        if (!taskResult.ok) {
          process.stderr.write(formatError(taskResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        if (taskResult.data.status !== 'done') {
          const err = pmError(
            'INVALID_TRANSITION',
            `Task "${displayId}" is ${taskResult.data.status}, not done. ` +
              `Use 'brain pm task release' for claimed tasks or 'brain pm task unblock' for blocked tasks.`
          );
          process.stderr.write(formatError(err, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        // Transition to pending (records 'reset' activity)
        const statusResult = await updateTaskStatus(
          svc.db,
          svc.config,
          svc.embedder,
          displayId,
          'pending' as TaskStatus
        );
        if (!statusResult.ok) {
          process.stderr.write(formatError(statusResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        // Clear claim metadata
        await updateTaskMetadataFields(svc.db, svc.config, svc.embedder, displayId, {
          claim_token: '',
          claimed_at: '',
          spawn_timestamp: '',
        });

        outputResult(statusResult.data, !!opts.json);
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
        const redirectMsg = checkNamespaceMismatch(id.toUpperCase(), 'task');
        if (redirectMsg) {
          process.stderr.write(`Error: ${redirectMsg}\n`);
          process.exitCode = 1;
          return;
        }
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
        const redirectMsg = checkNamespaceMismatch(displayId, 'task');
        if (redirectMsg) {
          process.stderr.write(`Error: ${redirectMsg}\n`);
          process.exitCode = 1;
          return;
        }
        const taskResult = getTask(svc.db, displayId);
        if (!taskResult.ok) {
          process.stderr.write(formatError(taskResult.error, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

        if (taskResult.data.status === 'done') {
          const err = pmError(
            'ALREADY_COMPLETED',
            `Task "${displayId}" is already completed and cannot be claimed`
          );
          process.stderr.write(formatError(err, !!opts.json) + '\n');
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
            process.stdout.write(
              JSON.stringify({ ...startResult.data, token: claim.token }, null, 2) + '\n'
            );
          } else {
            process.stdout.write(`${displayId} claimed and started (in-progress)\n`);
          }
          return;
        }

        if (opts.json) {
          process.stdout.write(
            JSON.stringify({ ...metaResult.data, token: claim.token }, null, 2) + '\n'
          );
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
        if (meta.status === 'done') {
          const err = pmError(
            'ALREADY_COMPLETED',
            `Task "${displayId}" is already completed and cannot be started`
          );
          process.stderr.write(formatError(err, !!opts.json) + '\n');
          process.exitCode = 1;
          return;
        }

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
  return readTaskBody(notes[0]);
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
