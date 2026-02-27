import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrainDB } from '../../../src/services/brain-db.js';
import { tmpDbPath } from '../../helpers.js';
import {
  generateHookScripts,
  generateSkillContent,
  installHooks,
  removeHooks,
} from '../../../src/modules/pm/commands/install-hooks.js';
import { getActiveProject, setActiveProject } from '../../../src/modules/pm/data/queries.js';
import { checkWorktreePath } from '../../../src/modules/pm/engine/worktree.js';

function makeTempClaudeDir(): string {
  return mkdtempSync(join(tmpdir(), 'brain-hook-triggers-'));
}

describe('hook script trigger content', () => {
  test('SessionStart hook reads stdin for session-start', () => {
    const scripts = generateHookScripts();
    const content = scripts['brain-pm-session.sh'];
    expect(content).toContain('< /dev/stdin');
    expect(content).toContain('brain pm orchestrate session-start');
  });

  test('SessionStart hook writes BRAIN_PM_ORCHESTRATE to CLAUDE_ENV_FILE', () => {
    const scripts = generateHookScripts();
    const content = scripts['brain-pm-session.sh'];
    expect(content).toContain('CLAUDE_ENV_FILE');
    expect(content).toContain('BRAIN_PM_ORCHESTRATE=1');
  });

  test('SessionStart hook checks for active project before activating', () => {
    const scripts = generateHookScripts();
    const content = scripts['brain-pm-session.sh'];
    expect(content).toContain('brain pm project list');
    expect(content).toContain('ACTIVE');
  });

  test('PreToolUse hook exits early when BRAIN_PM_WORKTREE is unset', () => {
    const scripts = generateHookScripts();
    const content = scripts['brain-pm-worktree.sh'];
    // First gate: BRAIN_PM_ORCHESTRATE
    expect(content).toContain('[ -z "$BRAIN_PM_ORCHESTRATE" ] && exit 0');
    // Second gate: BRAIN_PM_WORKTREE
    expect(content).toContain('[ -z "$BRAIN_PM_WORKTREE" ] && exit 0');
  });

  test('SubagentStop hook pipes stdin to agent-done', () => {
    const scripts = generateHookScripts();
    const content = scripts['brain-pm-agent-done.sh'];
    expect(content).toContain('< /dev/stdin');
    expect(content).toContain('brain pm orchestrate agent-done');
  });

  test('all hooks have no unclosed quotes', () => {
    const scripts = generateHookScripts();
    for (const content of Object.values(scripts)) {
      const singleQuotes = (content.match(/'/g) || []).length;
      const doubleQuotes = (content.match(/"/g) || []).length;
      expect(singleQuotes % 2).toBe(0);
      expect(doubleQuotes % 2).toBe(0);
    }
  });

  test('generates exactly three hook scripts', () => {
    const scripts = generateHookScripts();
    expect(Object.keys(scripts)).toHaveLength(3);
    expect(scripts).toHaveProperty('brain-pm-session.sh');
    expect(scripts).toHaveProperty('brain-pm-worktree.sh');
    expect(scripts).toHaveProperty('brain-pm-agent-done.sh');
  });
});

describe('settings.json hook entries', () => {
  let claudeDir: string;

  beforeEach(() => {
    claudeDir = makeTempClaudeDir();
  });

  test('settings entries map to correct hook type events', () => {
    installHooks(claudeDir);
    const settings = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8'));

    // SessionStart maps to the session hook
    const sessionCmd = settings.hooks.SessionStart[0].hooks[0].command;
    expect(sessionCmd).toContain('brain-pm-session.sh');

    // PreToolUse maps to the worktree hook
    const worktreeCmd = settings.hooks.PreToolUse[0].hooks[0].command;
    expect(worktreeCmd).toContain('brain-pm-worktree.sh');

    // SubagentStop maps to agent-done hook
    const agentCmd = settings.hooks.SubagentStop[0].hooks[0].command;
    expect(agentCmd).toContain('brain-pm-agent-done.sh');
  });

  test('all hook entries use type=command', () => {
    installHooks(claudeDir);
    const settings = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8'));

    for (const hookType of ['SessionStart', 'PreToolUse', 'SubagentStop']) {
      for (const entry of settings.hooks[hookType]) {
        for (const hook of entry.hooks) {
          expect(hook.type).toBe('command');
        }
      }
    }
  });

  test('install then remove then install restores state', () => {
    installHooks(claudeDir);
    const firstSettings = readFileSync(join(claudeDir, 'settings.json'), 'utf-8');

    removeHooks(claudeDir);
    installHooks(claudeDir);
    const restoredSettings = readFileSync(join(claudeDir, 'settings.json'), 'utf-8');

    expect(JSON.parse(restoredSettings)).toEqual(JSON.parse(firstSettings));
  });

  test('install preserves unrelated settings keys', () => {
    const settingsPath = join(claudeDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({ theme: 'dark', version: 2 }));

    installHooks(claudeDir);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    expect(settings.theme).toBe('dark');
    expect(settings.version).toBe(2);
    expect(settings.hooks).toBeDefined();
  });
});

describe('skill content', () => {
  test('contains session lifecycle sections', () => {
    const content = generateSkillContent();
    expect(content).toContain('## Session Start');
    expect(content).toContain('## Session End');
    expect(content).toContain('## After Task Completion');
  });

  test('contains task dispatch instructions', () => {
    const content = generateSkillContent();
    expect(content).toContain('## Task Dispatch (Agent Tasks)');
    expect(content).toContain('## Task Dispatch (Assisted/Human Tasks)');
    expect(content).toContain('brain pm task claim');
    expect(content).toContain('brain pm orchestrate route');
    expect(content).toContain('brain pm orchestrate render');
  });

  test('contains verification workflow', () => {
    const content = generateSkillContent();
    expect(content).toContain('verify=true');
    expect(content).toContain('verification agent');
    expect(content).toContain('brain pm verify');
  });

  test('contains parallel agent guidance', () => {
    const content = generateSkillContent();
    expect(content).toContain('## Parallel Agents');
    expect(content).toContain('run_in_background');
    expect(content).toContain('worktree budget');
  });

  test('contains activation gate description', () => {
    const content = generateSkillContent();
    expect(content).toContain('BRAIN_PM_ORCHESTRATE=1');
    expect(content).toContain('brain pm use');
  });
});

describe('session-start: active project detection', () => {
  let db: BrainDB;

  beforeEach(() => {
    db = new BrainDB(tmpDbPath());
    db.setEmbeddingModel('mock', 384);
  });

  afterEach(() => {
    db.close();
  });

  test('returns active project when set', () => {
    setActiveProject(db, 'MYPROJ');
    const result = getActiveProject(db);
    expect(result).toBe('MYPROJ');
  });

  test('returns null when no active project', () => {
    const result = getActiveProject(db);
    expect(result).toBeNull();
  });

  test('active project can be changed', () => {
    setActiveProject(db, 'PROJ-A');
    expect(getActiveProject(db)).toBe('PROJ-A');

    setActiveProject(db, 'PROJ-B');
    expect(getActiveProject(db)).toBe('PROJ-B');
  });
});

describe('worktree-check path validation', () => {
  test('accepts file deep inside worktree', () => {
    const result = checkWorktreePath(
      '/repo/.worktrees/ws-1',
      '/repo/.worktrees/ws-1/src/modules/deep/file.ts'
    );
    expect(result.ok).toBe(true);
  });

  test('rejects sibling worktree path', () => {
    const result = checkWorktreePath('/repo/.worktrees/ws-1', '/repo/.worktrees/ws-2/src/file.ts');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('outside expected worktree');
    }
  });

  test('rejects parent directory of worktree', () => {
    const result = checkWorktreePath('/repo/.worktrees/ws-1', '/repo/.worktrees');
    expect(result.ok).toBe(false);
  });

  test('accepts worktree root exactly', () => {
    const result = checkWorktreePath('/repo/.worktrees/ws-1', '/repo/.worktrees/ws-1');
    expect(result.ok).toBe(true);
  });

  test('normalizes trailing slashes on worktree path', () => {
    const result = checkWorktreePath('/repo/.worktrees/ws-1/', '/repo/.worktrees/ws-1/file.ts');
    expect(result.ok).toBe(true);
  });

  test('rejects path that shares prefix but is not subdirectory', () => {
    const result = checkWorktreePath(
      '/repo/.worktrees/ws-1',
      '/repo/.worktrees/ws-1-extended/file.ts'
    );
    expect(result.ok).toBe(false);
  });
});
