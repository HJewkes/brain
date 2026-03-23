import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HookHandler, HookInput, HookConfig, HookResult } from '../types.js';
import { hookAllow, hookBlock } from '../types.js';

/**
 * Gates browser automation, build, and process-spawning tools to a designated
 * "deploy" agent. Research/builder agents queue demo requests instead of
 * opening browsers or running builds themselves.
 *
 * The designated agent is read from ao.config.json `browserGate.agent` field
 * (preferred — works for all agents in the project) or the BROWSER_GATE_AGENT
 * env var (fallback). When neither is set, the check is a no-op.
 */

interface BrowserGateConfig {
  agent: string;
  tools?: string[]; // tool name patterns (supports * glob)
  bashPatterns?: string[]; // regex patterns for dangerous bash commands
}

const DEFAULT_BROWSER_TOOLS = new Set([
  // Claude-in-Chrome MCP tools
  'mcp__claude-in-chrome__navigate',
  'mcp__claude-in-chrome__computer',
  'mcp__claude-in-chrome__tabs_create_mcp',
  'mcp__claude-in-chrome__javascript_tool',
  'mcp__claude-in-chrome__read_page',
  'mcp__claude-in-chrome__get_page_text',
  'mcp__claude-in-chrome__form_input',
  'mcp__claude-in-chrome__find',
  'mcp__claude-in-chrome__gif_creator',
  // Playwright MCP tools
  'mcp__plugin_playwright_playwright__browser_navigate',
  'mcp__plugin_playwright_playwright__browser_click',
  'mcp__plugin_playwright_playwright__browser_snapshot',
  'mcp__plugin_playwright_playwright__browser_take_screenshot',
  'mcp__plugin_playwright_playwright__browser_evaluate',
  'mcp__plugin_playwright_playwright__browser_run_code',
]);

/** Shell commands that spawn heavy processes or open the browser */
const DEFAULT_BASH_PATTERNS = [
  /\bnpm\s+install\b/,
  /\bnpm\s+ci\b/,
  /\bpnpm\s+install\b/,
  /\byarn\s+(install|add)\b/,
  /\bvite\b/,
  /\bwebpack\b/,
  /\bnext\s+(dev|build|start)\b/,
  /\bopen\s+["']?https?:/,
  /\bopen\s+.*\.html\b/,
  /\bnpx\s+serve\b/,
  /\bnpx\s+http-server\b/,
  /\bnpx\s+vite\b/,
  /\bnpm\s+run\s+(dev|start|preview)\b/,
  /\bnpm\s+link\b/,
];

/** Convert a glob pattern (supporting only * wildcard) to a RegExp */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function isBrowserTool(toolName: string, configTools?: string[]): boolean {
  if (configTools) {
    return configTools.some((p) => globToRegex(p).test(toolName));
  }
  if (DEFAULT_BROWSER_TOOLS.has(toolName)) return true;
  if (toolName.startsWith('mcp__claude-in-chrome__')) return true;
  if (toolName.startsWith('mcp__plugin_playwright_playwright__browser_')) return true;
  return false;
}

function isDangerousBashCommand(input: string, configPatterns?: string[]): boolean {
  if (configPatterns) {
    return configPatterns.some((p) => new RegExp(p).test(input));
  }
  return DEFAULT_BASH_PATTERNS.some((pattern) => pattern.test(input));
}

function resolveGateConfig(cwd: string): BrowserGateConfig | null {
  try {
    const configPath = join(cwd, 'ao.config.json');
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as {
        browserGate?: BrowserGateConfig;
      };
      if (raw.browserGate?.agent) return raw.browserGate;
    }
  } catch {
    // Fall through to env var
  }
  const agent = process.env.BROWSER_GATE_AGENT;
  return agent ? { agent } : null;
}

export const browserGateCheck: HookHandler = {
  name: 'browser-gate',
  event: 'pre-tool-use',
  priority: 3,

  enabled(_config: HookConfig): boolean {
    return !!resolveGateConfig(process.cwd());
  },

  run(input: HookInput, _config: HookConfig): HookResult {
    const gateConfig = resolveGateConfig(input.cwd);
    if (!gateConfig) return hookAllow();

    const { agent: gateAgent, tools, bashPatterns } = gateConfig;
    const currentAgent = process.env.AGENT_NAME ?? '';

    // Don't gate the main session (no AGENT_NAME) — only gate spawned agents
    if (!currentAgent) return hookAllow();

    // The designated deploy agent is always allowed
    if (currentAgent === gateAgent) return hookAllow();

    const parsed = input.parsed as { tool_name?: string; tool_input?: Record<string, unknown> };
    const toolName = parsed.tool_name ?? '';

    // Block browser automation tools
    if (isBrowserTool(toolName, tools)) {
      return hookBlock(
        `Blocked: browser tools restricted to deploy agent "${gateAgent}". ` +
          `Queue a demo request via SendMessage instead of using ${toolName} directly.`
      );
    }

    // Block dangerous bash commands (builds, installs, browser opens)
    if (toolName === 'Bash') {
      const command = (parsed.tool_input?.command as string) ?? '';
      if (isDangerousBashCommand(command, bashPatterns)) {
        return hookBlock(
          `Blocked: build/install/browser commands restricted to deploy agent "${gateAgent}". ` +
            `Write your code and queue a DEMO_REQUEST via SendMessage to ${gateAgent} for building and testing.`
        );
      }
    }

    return hookAllow();
  },
};
