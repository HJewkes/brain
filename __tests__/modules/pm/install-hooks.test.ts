import { mkdtempSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, test, expect, beforeEach } from 'vitest';
import {
  generateHookScripts,
  generateSkillContent,
  installHooks,
  removeHooks,
} from '../../../src/modules/pm/commands/install-hooks.js';

function makeTempClaudeDir(): string {
  return mkdtempSync(join(tmpdir(), 'brain-hooks-test-'));
}

describe('generateHookScripts', () => {
  test('generates session-start hook with activation gate', () => {
    const scripts = generateHookScripts();
    const content = scripts['brain-pm-session.sh'];
    expect(content).toContain('BRAIN_PM_ORCHESTRATE');
    expect(content).toContain('brain pm orchestrate session-start');
  });

  test('generates worktree-check hook with double gate', () => {
    const scripts = generateHookScripts();
    const content = scripts['brain-pm-worktree.sh'];
    expect(content).toContain('BRAIN_PM_ORCHESTRATE');
    expect(content).toContain('BRAIN_PM_WORKTREE');
    expect(content).toContain('brain pm orchestrate worktree-check');
  });

  test('generates agent-done hook with activation gate', () => {
    const scripts = generateHookScripts();
    const content = scripts['brain-pm-agent-done.sh'];
    expect(content).toContain('BRAIN_PM_ORCHESTRATE');
    expect(content).toContain('brain pm orchestrate agent-done');
  });

  test('all hooks start with #!/bin/bash', () => {
    const scripts = generateHookScripts();
    for (const content of Object.values(scripts)) {
      expect(content.startsWith('#!/bin/bash')).toBe(true);
    }
  });
});

describe('generateSkillContent', () => {
  test('returns skill content with key sections', () => {
    const content = generateSkillContent();
    expect(content).toContain('Project Orchestrator');
    expect(content).toContain('Session Start');
    expect(content).toContain('brain pm');
  });
});

describe('installHooks', () => {
  let claudeDir: string;

  beforeEach(() => {
    claudeDir = makeTempClaudeDir();
  });

  test('creates hook files in the hooks directory', () => {
    const result = installHooks(claudeDir);
    expect(result.errors).toHaveLength(0);

    const hooksDir = join(claudeDir, 'hooks');
    expect(existsSync(join(hooksDir, 'brain-pm-session.sh'))).toBe(true);
    expect(existsSync(join(hooksDir, 'brain-pm-worktree.sh'))).toBe(true);
    expect(existsSync(join(hooksDir, 'brain-pm-agent-done.sh'))).toBe(true);
  });

  test('hook files are executable', () => {
    installHooks(claudeDir);
    const hooksDir = join(claudeDir, 'hooks');
    const stat = statSync(join(hooksDir, 'brain-pm-session.sh'));
    // Check owner execute bit
    expect(stat.mode & 0o100).toBeTruthy();
  });

  test('creates settings.json if it does not exist', () => {
    const result = installHooks(claudeDir);
    expect(result.errors).toHaveLength(0);

    const settingsPath = join(claudeDir, 'settings.json');
    expect(existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.SubagentStop).toHaveLength(1);
  });

  test('merges into existing settings.json without overwriting', () => {
    const settingsPath = join(claudeDir, 'settings.json');
    const existingSettings = {
      someKey: 'someValue',
      hooks: {
        PreToolUse: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: 'bash ~/.claude/scripts/hook-pre-tool.sh' }],
          },
        ],
        PostToolUse: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: 'bash ~/.claude/scripts/hook-post-tool.sh' }],
          },
        ],
      },
    };
    writeFileSync(settingsPath, JSON.stringify(existingSettings));

    const result = installHooks(claudeDir);
    expect(result.errors).toHaveLength(0);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    // Existing keys preserved
    expect(settings.someKey).toBe('someValue');

    // Existing hooks preserved
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain('hook-post-tool.sh');

    // PreToolUse has both old and new entries
    expect(settings.hooks.PreToolUse).toHaveLength(2);

    // New hooks added
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SubagentStop).toHaveLength(1);
  });

  test('creates skill directory and SKILL.md', () => {
    const result = installHooks(claudeDir);
    expect(result.errors).toHaveLength(0);

    const skillPath = join(claudeDir, 'skills', 'orchestrator', 'SKILL.md');
    expect(existsSync(skillPath)).toBe(true);

    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toContain('Project Orchestrator');
  });

  test('is idempotent — second run produces same result', () => {
    installHooks(claudeDir);
    const firstSettings = readFileSync(join(claudeDir, 'settings.json'), 'utf-8');

    installHooks(claudeDir);
    const secondSettings = readFileSync(join(claudeDir, 'settings.json'), 'utf-8');

    expect(secondSettings).toBe(firstSettings);

    // Verify no duplicate hook entries
    const settings = JSON.parse(secondSettings);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.SubagentStop).toHaveLength(1);
  });
});

describe('removeHooks', () => {
  let claudeDir: string;

  beforeEach(() => {
    claudeDir = makeTempClaudeDir();
    installHooks(claudeDir);
  });

  test('removes hook files', () => {
    const result = removeHooks(claudeDir);
    expect(result.errors).toHaveLength(0);

    const hooksDir = join(claudeDir, 'hooks');
    expect(existsSync(join(hooksDir, 'brain-pm-session.sh'))).toBe(false);
    expect(existsSync(join(hooksDir, 'brain-pm-worktree.sh'))).toBe(false);
    expect(existsSync(join(hooksDir, 'brain-pm-agent-done.sh'))).toBe(false);
  });

  test('removes hook entries from settings.json', () => {
    const result = removeHooks(claudeDir);
    expect(result.errors).toHaveLength(0);

    const settingsPath = join(claudeDir, 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));

    // All brain-pm hooks removed
    expect(settings.hooks).toBeUndefined();
  });

  test('preserves non-brain-pm hooks in settings.json', () => {
    // Add a non-brain-pm hook to settings
    const settingsPath = join(claudeDir, 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    settings.hooks.PreToolUse.push({
      matcher: '',
      hooks: [{ type: 'command', command: 'bash ~/.claude/scripts/other-hook.sh' }],
    });
    writeFileSync(settingsPath, JSON.stringify(settings));

    removeHooks(claudeDir);

    const updated = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    // PreToolUse still has the other hook
    expect(updated.hooks.PreToolUse).toHaveLength(1);
    expect(updated.hooks.PreToolUse[0].hooks[0].command).toContain('other-hook.sh');
    // Brain-pm only hooks are gone
    expect(updated.hooks.SessionStart).toBeUndefined();
    expect(updated.hooks.SubagentStop).toBeUndefined();
  });

  test('removes skill directory', () => {
    const result = removeHooks(claudeDir);
    expect(result.errors).toHaveLength(0);

    const skillDir = join(claudeDir, 'skills', 'orchestrator');
    expect(existsSync(skillDir)).toBe(false);
  });

  test('handles missing files gracefully', () => {
    const emptyDir = makeTempClaudeDir();
    const result = removeHooks(emptyDir);
    expect(result.errors).toHaveLength(0);
  });
});
