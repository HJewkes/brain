import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { browserGateCheck } from '../../../src/hooks/checks/browser-gate.js';
import type { HookConfig, HookInput } from '../../../src/hooks/types.js';
import { DEFAULT_HOOK_CONFIG } from '../../../src/hooks/config.js';
import { existsSync, readFileSync } from 'node:fs';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

/** Use a cwd with no ao.config.json so tests control activation via env */
const TEST_CWD = '/tmp/browser-gate-test';

function makeInput(toolName: string, toolInput?: Record<string, unknown>): HookInput {
  return {
    event: 'pre-tool-use',
    raw: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
    parsed: { tool_name: toolName, tool_input: toolInput },
    cwd: TEST_CWD,
  };
}

describe('browser-gate check', () => {
  const config: HookConfig = DEFAULT_HOOK_CONFIG;
  const savedEnv: Record<string, string | undefined> = {};
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    savedEnv.BROWSER_GATE_AGENT = process.env.BROWSER_GATE_AGENT;
    savedEnv.AGENT_NAME = process.env.AGENT_NAME;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(TEST_CWD);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('is disabled when neither config nor env var is set', () => {
    delete process.env.BROWSER_GATE_AGENT;
    expect(browserGateCheck.enabled(config)).toBe(false);
  });

  it('is enabled when BROWSER_GATE_AGENT env var is set', () => {
    process.env.BROWSER_GATE_AGENT = 'deploy-agent';
    expect(browserGateCheck.enabled(config)).toBe(true);
  });

  it('allows the designated agent to use browser tools', () => {
    process.env.BROWSER_GATE_AGENT = 'deploy-agent';
    process.env.AGENT_NAME = 'deploy-agent';
    const result = browserGateCheck.run(makeInput('mcp__claude-in-chrome__navigate'), config);
    expect(result.exitCode).toBe(0);
  });

  it('blocks non-designated agents from browser tools', () => {
    process.env.BROWSER_GATE_AGENT = 'deploy-agent';
    process.env.AGENT_NAME = 'researcher-1';
    const result = browserGateCheck.run(makeInput('mcp__claude-in-chrome__navigate'), config);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('deploy-agent');
  });

  it('blocks playwright tools for non-designated agents', () => {
    process.env.BROWSER_GATE_AGENT = 'deploy-agent';
    process.env.AGENT_NAME = 'researcher-1';
    const result = browserGateCheck.run(
      makeInput('mcp__plugin_playwright_playwright__browser_navigate'),
      config
    );
    expect(result.exitCode).toBe(2);
  });

  it('blocks npm install in Bash for non-designated agents', () => {
    process.env.BROWSER_GATE_AGENT = 'deploy-agent';
    process.env.AGENT_NAME = 'researcher-1';
    const result = browserGateCheck.run(
      makeInput('Bash', { command: 'npm install react vite' }),
      config
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('build/install/browser');
  });

  it('blocks vite in Bash for non-designated agents', () => {
    process.env.BROWSER_GATE_AGENT = 'deploy-agent';
    process.env.AGENT_NAME = 'researcher-1';
    const result = browserGateCheck.run(makeInput('Bash', { command: 'npx vite build' }), config);
    expect(result.exitCode).toBe(2);
  });

  it('blocks open HTML in Bash for non-designated agents', () => {
    process.env.BROWSER_GATE_AGENT = 'deploy-agent';
    process.env.AGENT_NAME = 'researcher-1';
    const result = browserGateCheck.run(
      makeInput('Bash', { command: 'open /tmp/demo.html' }),
      config
    );
    expect(result.exitCode).toBe(2);
  });

  it('allows normal Bash commands for non-designated agents', () => {
    process.env.BROWSER_GATE_AGENT = 'deploy-agent';
    process.env.AGENT_NAME = 'researcher-1';
    const result = browserGateCheck.run(makeInput('Bash', { command: 'git status' }), config);
    expect(result.exitCode).toBe(0);
  });

  it('allows Write tool for non-designated agents', () => {
    process.env.BROWSER_GATE_AGENT = 'deploy-agent';
    process.env.AGENT_NAME = 'researcher-1';
    const result = browserGateCheck.run(makeInput('Write'), config);
    expect(result.exitCode).toBe(0);
  });

  it('allows the designated agent to run npm install', () => {
    process.env.BROWSER_GATE_AGENT = 'deploy-agent';
    process.env.AGENT_NAME = 'deploy-agent';
    const result = browserGateCheck.run(
      makeInput('Bash', { command: 'npm install react' }),
      config
    );
    expect(result.exitCode).toBe(0);
  });

  it('allows the main session (no AGENT_NAME) to use browser tools', () => {
    process.env.BROWSER_GATE_AGENT = 'deploy-agent';
    delete process.env.AGENT_NAME;
    const result = browserGateCheck.run(makeInput('mcp__claude-in-chrome__navigate'), config);
    expect(result.exitCode).toBe(0);
  });

  it('allows the main session to run npm install', () => {
    process.env.BROWSER_GATE_AGENT = 'deploy-agent';
    delete process.env.AGENT_NAME;
    const result = browserGateCheck.run(
      makeInput('Bash', { command: 'npm install react' }),
      config
    );
    expect(result.exitCode).toBe(0);
  });
});

describe('browser-gate check — config-driven lists', () => {
  const config: HookConfig = DEFAULT_HOOK_CONFIG;
  const CONFIG_CWD = '/tmp/browser-gate-config-test';
  const savedEnv: Record<string, string | undefined> = {};
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  function setupConfig(browserGate: object): void {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === `${CONFIG_CWD}/ao.config.json` ? true : false
    );
    vi.mocked(readFileSync).mockImplementation((p, enc) => {
      if (String(p) === `${CONFIG_CWD}/ao.config.json`) {
        return JSON.stringify({ browserGate });
      }
      const actual = vi.importActual<typeof import('node:fs')>('node:fs');
      return (actual as typeof import('node:fs')).readFileSync(p as string, enc as BufferEncoding);
    });
  }

  function makeConfigInput(toolName: string, toolInput?: Record<string, unknown>): HookInput {
    return {
      event: 'pre-tool-use',
      raw: '{}',
      parsed: { tool_name: toolName, tool_input: toolInput },
      cwd: CONFIG_CWD,
    };
  }

  beforeEach(() => {
    savedEnv.BROWSER_GATE_AGENT = process.env.BROWSER_GATE_AGENT;
    savedEnv.AGENT_NAME = process.env.AGENT_NAME;
    delete process.env.BROWSER_GATE_AGENT;
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(CONFIG_CWD);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    vi.mocked(existsSync).mockRestore();
    vi.mocked(readFileSync).mockRestore();
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('blocks config-driven tool list using exact match', () => {
    setupConfig({ agent: 'deploy-agent', tools: ['custom__tool__run'] });
    process.env.AGENT_NAME = 'researcher-1';
    const result = browserGateCheck.run(makeConfigInput('custom__tool__run'), config);
    expect(result.exitCode).toBe(2);
  });

  it('blocks config-driven tool via glob pattern', () => {
    setupConfig({ agent: 'deploy-agent', tools: ['mcp__chrome__*'] });
    process.env.AGENT_NAME = 'researcher-1';
    const result = browserGateCheck.run(makeConfigInput('mcp__chrome__navigate'), config);
    expect(result.exitCode).toBe(2);
  });

  it('does not block tool not matching config-driven tool list', () => {
    setupConfig({ agent: 'deploy-agent', tools: ['mcp__chrome__*'] });
    process.env.AGENT_NAME = 'researcher-1';
    // Default browser tool not in config list — should be allowed
    const result = browserGateCheck.run(makeConfigInput('mcp__claude-in-chrome__navigate'), config);
    expect(result.exitCode).toBe(0);
  });

  it('blocks bash command matching config-driven pattern', () => {
    setupConfig({ agent: 'deploy-agent', bashPatterns: ['custom-build'] });
    process.env.AGENT_NAME = 'researcher-1';
    const result = browserGateCheck.run(
      makeConfigInput('Bash', { command: 'run custom-build now' }),
      config
    );
    expect(result.exitCode).toBe(2);
  });

  it('does not block bash when command does not match config pattern', () => {
    setupConfig({ agent: 'deploy-agent', bashPatterns: ['custom-build'] });
    process.env.AGENT_NAME = 'researcher-1';
    // Default pattern like npm install is NOT active when bashPatterns is provided
    const result = browserGateCheck.run(
      makeConfigInput('Bash', { command: 'npm install react' }),
      config
    );
    expect(result.exitCode).toBe(0);
  });

  it('falls back to default tool detection when config has no tools field', () => {
    setupConfig({ agent: 'deploy-agent' });
    process.env.AGENT_NAME = 'researcher-1';
    const result = browserGateCheck.run(makeConfigInput('mcp__claude-in-chrome__navigate'), config);
    expect(result.exitCode).toBe(2);
  });

  it('falls back to default bash patterns when config has no bashPatterns field', () => {
    setupConfig({ agent: 'deploy-agent' });
    process.env.AGENT_NAME = 'researcher-1';
    const result = browserGateCheck.run(
      makeConfigInput('Bash', { command: 'npm install react' }),
      config
    );
    expect(result.exitCode).toBe(2);
  });

  it('is disabled when ao.config.json has no browserGate section and no env var', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(browserGateCheck.enabled(config)).toBe(false);
  });
});
