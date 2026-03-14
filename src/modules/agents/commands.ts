import { Command } from '@commander-js/extra-typings';
import { withBrain, withDb } from '../../services/brain-service.js';
import { createAgent, getAgent, listAgents, updateAgentStatus } from './data.js';
import type { AgentRecord } from './types.js';
import { createWorktreeCommand } from './worktree-commands.js';
import { buildAgentDispatchContext, formatDispatchBrief } from './dispatch-context.js';
import { updateTaskStatus } from '../pm/data/task-ops.js';
import { migrateAoAgents } from './migrate-ao.js';

function padRight(s: string, len: number): string {
  return s.length >= len ? s.substring(0, len) : s + ' '.repeat(len - s.length);
}

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatAgentLine(agent: AgentRecord): string {
  const age = formatAge(agent.created_at);
  return (
    `${padRight(agent.id, 36)} ` +
    `${padRight(agent.name, 20)} ` +
    `${padRight(agent.status, 12)} ` +
    `${padRight(agent.branch ?? '-', 24)} ` +
    age
  );
}

function formatDetailView(agent: AgentRecord): string {
  const lines: string[] = [];
  lines.push(`Agent:    ${agent.name} (${agent.id})`);
  lines.push(`Status:   ${agent.status}`);
  lines.push(`Parent:   ${agent.parent}`);
  lines.push(`Branch:   ${agent.branch ?? 'none'}`);
  if (agent.worktree_path) lines.push(`Worktree: ${agent.worktree_path}`);
  if (agent.ownership) {
    const paths: string[] = JSON.parse(agent.ownership) as string[];
    lines.push(`Ownership: ${paths.join(', ')}`);
  }
  if (agent.dod_spec) lines.push(`DoD:      ${agent.dod_spec}`);
  if (agent.brain_task) lines.push(`Task:     ${agent.brain_task}`);
  if (agent.claim_token) lines.push(`Token:    ${agent.claim_token}`);
  lines.push(`Created:  ${agent.created_at}`);
  if (agent.started_at) lines.push(`Started:  ${agent.started_at}`);
  if (agent.completed_at) lines.push(`Completed: ${agent.completed_at}`);
  if (agent.pid) lines.push(`PID:      ${agent.pid}`);
  if (agent.summary) lines.push(`Summary:  ${agent.summary}`);
  if (agent.exit_reason) lines.push(`Exit:     ${agent.exit_reason}`);
  return lines.join('\n');
}

export function createAgentCommands(): Command {
  const cmd = new Command('agent').description('Manage agent lifecycle');

  // brain agent register
  cmd
    .command('register')
    .description('Register a new agent')
    .requiredOption('--name <name>', 'Agent name')
    .option('--parent <parent>', 'Parent agent ID or orchestrator name', 'human')
    .option('--branch <branch>', 'Git branch for this agent')
    .option('--worktree-path <path>', 'Absolute worktree path')
    .option('--ownership <paths>', 'Comma-separated ownership paths')
    .option('--dod-spec <spec>', 'Definition of done spec path')
    .option('--brain-task <task>', 'PM task display_id')
    .option('--claim-token <token>', 'Claim token from PM task')
    .action(async (opts) => {
      await withDb((svc) => {
        const ownership = opts.ownership
          ? opts.ownership.split(',').map((p) => p.trim())
          : undefined;

        const id = createAgent(svc.db, {
          name: opts.name,
          parent: opts.parent,
          branch: opts.branch,
          worktree_path: opts.worktreePath,
          ownership,
          dod_spec: opts.dodSpec,
          brain_task: opts.brainTask,
          claim_token: opts.claimToken,
        });

        process.stdout.write(id + '\n');
      });
    });

  // brain agent start <id>
  cmd
    .command('start')
    .description('Transition agent from pending to active')
    .argument('<id>', 'Agent ID')
    .action(async (id) => {
      await withDb((svc) => {
        const agent = getAgent(svc.db, id);
        if (!agent) {
          process.stderr.write(`Error: Agent not found: ${id}\n`);
          process.exitCode = 1;
          return;
        }

        if (agent.status !== 'pending') {
          process.stderr.write(`Error: Agent ${id} is not pending (current: ${agent.status})\n`);
          process.exitCode = 1;
          return;
        }

        updateAgentStatus(svc.db, id, 'active', { pid: process.pid });

        if (agent.brain_task) process.env.BRAIN_PM_TASK = agent.brain_task;
        if (agent.claim_token) process.env.BRAIN_PM_CLAIM_TOKEN = agent.claim_token;

        const updated = getAgent(svc.db, id)!;
        process.stdout.write(formatDetailView(updated) + '\n');
      });
    });

  // brain agent complete <id>
  cmd
    .command('complete')
    .description('Transition agent from active to completed')
    .argument('<id>', 'Agent ID')
    .requiredOption('--summary <text>', 'Completion summary')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const agent = getAgent(svc.db, id);
        if (!agent) {
          process.stderr.write(`Error: Agent not found: ${id}\n`);
          process.exitCode = 1;
          return;
        }

        if (agent.status !== 'active') {
          process.stderr.write(`Error: Agent ${id} is not active (current: ${agent.status})\n`);
          process.exitCode = 1;
          return;
        }

        updateAgentStatus(svc.db, id, 'completed', { summary: opts.summary });
        process.stdout.write(`Agent ${id} completed.\n`);

        if (agent.brain_task) {
          const result = await updateTaskStatus(
            svc.db,
            svc.config,
            svc.embedder,
            agent.brain_task,
            'done'
          );
          if (result.ok) {
            process.stdout.write(`Task ${agent.brain_task} → done\n`);
          } else {
            process.stderr.write(
              `Warning: Failed to update task ${agent.brain_task}: ${result.error.message}\n`
            );
          }
        }
      });
    });

  // brain agent abandon <id>
  cmd
    .command('abandon')
    .description('Transition agent from active to abandoned')
    .argument('<id>', 'Agent ID')
    .requiredOption('--reason <text>', 'Reason for abandoning')
    .action(async (id, opts) => {
      await withBrain(async (svc) => {
        const agent = getAgent(svc.db, id);
        if (!agent) {
          process.stderr.write(`Error: Agent not found: ${id}\n`);
          process.exitCode = 1;
          return;
        }

        if (agent.status !== 'active') {
          process.stderr.write(`Error: Agent ${id} is not active (current: ${agent.status})\n`);
          process.exitCode = 1;
          return;
        }

        updateAgentStatus(svc.db, id, 'abandoned', { exit_reason: opts.reason });
        process.stdout.write(`Agent ${id} abandoned.\n`);

        if (agent.brain_task) {
          const result = await updateTaskStatus(
            svc.db,
            svc.config,
            svc.embedder,
            agent.brain_task,
            'pending'
          );
          if (result.ok) {
            process.stdout.write(`Task ${agent.brain_task} → pending\n`);
          } else {
            process.stderr.write(
              `Warning: Failed to update task ${agent.brain_task}: ${result.error.message}\n`
            );
          }
        }
      });
    });

  // brain agent status
  cmd
    .command('status')
    .description('List agents or show detail for one agent')
    .option('--active', 'Filter to active agents only')
    .option('--json', 'Output JSON')
    .option('--agent <id>', 'Show detail for a specific agent')
    .action(async (opts) => {
      await withDb((svc) => {
        if (opts.agent) {
          const agent = getAgent(svc.db, opts.agent);
          if (!agent) {
            process.stderr.write(`Error: Agent not found: ${opts.agent}\n`);
            process.exitCode = 1;
            return;
          }
          if (opts.json) {
            process.stdout.write(JSON.stringify(agent, null, 2) + '\n');
          } else {
            process.stdout.write(formatDetailView(agent) + '\n');
          }
          return;
        }

        const filter = opts.active ? { status: 'active' as const } : undefined;
        const agents = listAgents(svc.db, filter);

        if (opts.json) {
          process.stdout.write(JSON.stringify(agents, null, 2) + '\n');
          return;
        }

        if (agents.length === 0) {
          process.stdout.write('No agents found.\n');
          return;
        }

        const header =
          `${padRight('ID', 36)} ` +
          `${padRight('Name', 20)} ` +
          `${padRight('Status', 12)} ` +
          `${padRight('Branch', 24)} ` +
          'Age';
        const rows = agents.map(formatAgentLine);
        process.stdout.write([header, ...rows].join('\n') + '\n');
      });
    });

  // brain agent dispatch <task-id>
  cmd
    .command('dispatch')
    .description('Show PM dispatch context an agent would receive for a task')
    .argument('<task-id>', 'PM task display_id (e.g. VNM-01.03)')
    .option('--json', 'Output JSON')
    .action(async (taskId, opts) => {
      await withDb((svc) => {
        const ctx = buildAgentDispatchContext(svc.db, taskId.toUpperCase());
        if (!ctx) {
          process.stderr.write(`Error: Task not found: ${taskId}\n`);
          process.exitCode = 1;
          return;
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify(ctx, null, 2) + '\n');
        } else {
          process.stdout.write(formatDispatchBrief(ctx) + '\n');
        }
      });
    });

  // brain agent migrate-ao
  cmd
    .command('migrate-ao')
    .description('Import agent state from ao YAML files into brain SQLite')
    .option('--cwd <path>', 'Project directory to read ao state from', process.cwd())
    .option('--dry-run', 'Show what would be imported without writing')
    .option('--json', 'Output results as JSON')
    .action(async (opts) => {
      await withDb((svc) => {
        return migrateAoAgents(svc.db, opts.cwd, !!opts.dryRun).then((result) => {
          if (opts.json) {
            process.stdout.write(JSON.stringify(result, null, 2) + '\n');
            return;
          }

          const prefix = opts.dryRun ? '[dry-run] ' : '';
          process.stdout.write(`${prefix}Imported: ${result.imported}\n`);
          process.stdout.write(`${prefix}Skipped:  ${result.skipped}\n`);
          if (result.errors.length > 0) {
            process.stdout.write(`${prefix}Errors:   ${result.errors.length}\n`);
            for (const err of result.errors) {
              process.stderr.write(`  ${err}\n`);
            }
          }
        });
      });
    });

  cmd.addCommand(createWorktreeCommand());

  return cmd;
}
