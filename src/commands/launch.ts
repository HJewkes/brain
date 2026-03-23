import { Command } from '@commander-js/extra-typings';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { resolveInstance, loadConfig } from '../services/config.js';
import { BrainDB } from '../services/brain-db.js';
import { generateSessionBriefing } from '../modules/sessions/engine/session-briefing.js';

function findClaudeBinary(): string {
  try {
    return execFileSync('which', ['claude'], { encoding: 'utf-8', timeout: 2000 }).trim();
  } catch {
    return 'claude';
  }
}

function generateSystemPrompt(
  db: BrainDB,
  config: import('../types.js').BrainConfig,
  cwd: string
): string {
  const briefing = generateSessionBriefing(db, config, cwd);
  const lines: string[] = [];

  lines.push(
    'You are working in a brain-managed project. Use brain PM commands (not git log) for all project status queries.'
  );
  lines.push('Present this project briefing to the user at the start of the conversation.');
  lines.push('');

  if (briefing.project) {
    lines.push(`Project: ${briefing.project}`);
    lines.push('');
  }

  for (const section of briefing.sections) {
    lines.push(`${section.heading}:`);
    for (const item of section.items) {
      lines.push(`  • ${item}`);
    }
    lines.push('');
  }

  if (briefing.suggestedFocus.length > 0) {
    lines.push('Suggested focus:');
    for (const focus of briefing.suggestedFocus) {
      lines.push(`  → ${focus}`);
    }
    lines.push('');
  }

  lines.push(
    'Available commands: brain pm status, brain pm next, brain pm dispatch-wave, brain dashboard, brain session list, brain agent list, brain search'
  );

  return lines.join('\n');
}

function buildDefaultAgents(): Record<string, unknown> {
  return {
    researcher: {
      description: 'Research agent for investigation, web search, and codebase exploration.',
      prompt:
        'You are a research agent. Use brain search for project context. Use WebSearch and WebFetch for external research. Write findings to docs/plans/. Index research in brain with: brain add <file> --type research --tier slow',
      tools: ['Read', 'Grep', 'Glob', 'Bash', 'WebSearch', 'WebFetch'],
      model: 'sonnet',
    },
    implementer: {
      description: 'Implementation agent for coding tasks, bug fixes, and features.',
      prompt:
        'You are an implementation agent. After changes: run npx tsc --noEmit, run relevant tests, verify builds. Keep functions under 30 lines. Use brain PM to track task progress.',
      tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
      model: 'sonnet',
      permissionMode: 'acceptEdits',
    },
    reviewer: {
      description: 'Code review agent for quality, security, and test coverage analysis.',
      prompt:
        'You are a code reviewer. Check: logic errors, missing error handling, security issues, test gaps, dead code, type safety.',
      tools: ['Read', 'Grep', 'Glob'],
      model: 'sonnet',
    },
  };
}

function buildMcpConfig(): string {
  return JSON.stringify({
    mcpServers: {
      brain: { type: 'stdio', command: 'brain', args: ['serve'] },
    },
  });
}

interface LaunchConfig {
  claudeArgs?: string[];
  agents?: Record<string, unknown>;
}

function loadLaunchConfig(instanceRoot: string): LaunchConfig {
  // Project-level launch.json (in .brain/)
  const projectPath = join(instanceRoot, 'launch.json');
  if (existsSync(projectPath)) {
    try {
      return JSON.parse(readFileSync(projectPath, 'utf-8')) as LaunchConfig;
    } catch {
      /* ignore */
    }
  }

  // Global launch.json (~/.brain/)
  const globalPath = join(homedir(), '.brain', 'launch.json');
  if (existsSync(globalPath)) {
    try {
      return JSON.parse(readFileSync(globalPath, 'utf-8')) as LaunchConfig;
    } catch {
      /* ignore */
    }
  }

  return {};
}

export const launchCommand = new Command('launch')
  .description('Launch Claude with brain project context, MCP server, and subagents pre-configured')
  .option('--no-mcp', 'Skip registering brain as MCP server')
  .option('--no-agents', 'Skip configuring subagents')
  .option('--no-briefing', 'Skip system prompt briefing')
  .option('--model <model>', 'Override model (sonnet, opus, haiku)')
  .option('--continue', 'Continue most recent conversation')
  .option('--resume <session>', 'Resume a specific session')
  .allowUnknownOption(true)
  .action(async (opts, cmd) => {
    const cwd = process.cwd();
    const instance = resolveInstance({ cwd });

    // If no brain instance found, fall back to plain claude
    if (!instance.isLocal && !existsSync(join(cwd, '.brain'))) {
      process.stderr.write('No brain instance found — launching plain claude\n');
      const claude = findClaudeBinary();
      const child = spawn(claude, process.argv.slice(3), { stdio: 'inherit' });
      child.on('exit', (code) => process.exit(code ?? 0));
      return;
    }

    const config = loadConfig(instance);
    const launchConfig = loadLaunchConfig(instance.root);
    const claudeArgs: string[] = [];

    // System prompt with project briefing
    if (opts.briefing !== false) {
      let db: BrainDB | null = null;
      try {
        db = new BrainDB(config.dbPath);
        const systemPrompt = generateSystemPrompt(db, config, cwd);
        claudeArgs.push('--append-system-prompt', systemPrompt);
      } catch {
        process.stderr.write('Warning: could not generate briefing\n');
      } finally {
        db?.close();
      }
    }

    // MCP server
    if (opts.mcp !== false) {
      claudeArgs.push('--mcp-config', buildMcpConfig());
    }

    // Subagents (from launch config or defaults)
    if (opts.agents !== false) {
      const agents = launchConfig.agents ?? buildDefaultAgents();
      claudeArgs.push('--agents', JSON.stringify(agents));
    }

    // Extra CLI args from launch config
    if (launchConfig.claudeArgs) {
      claudeArgs.push(...launchConfig.claudeArgs);
    }

    // Model override
    if (opts.model) {
      claudeArgs.push('--model', opts.model);
    }

    // Session management
    if (opts.continue) {
      claudeArgs.push('--continue');
    }
    if (opts.resume) {
      claudeArgs.push('--resume', opts.resume);
    }

    // Pass through any extra args from the user
    const extraArgs = cmd.args;
    claudeArgs.push(...extraArgs);

    const claude = findClaudeBinary();
    const agentCount =
      opts.agents !== false ? Object.keys(launchConfig.agents ?? buildDefaultAgents()).length : 0;
    process.stderr.write(
      `Brain launch: project=${instance.isLocal ? 'local' : 'global'}, agents=${agentCount}, mcp=${opts.mcp !== false ? 'brain' : 'off'}\n`
    );

    const child = spawn(claude, claudeArgs, {
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('exit', (code) => process.exit(code ?? 0));
  });
