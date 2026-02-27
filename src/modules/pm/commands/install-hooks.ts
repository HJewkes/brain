import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  rmSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Command } from '@commander-js/extra-typings';

const SESSION_START_HOOK = `#!/bin/bash
[ -z "$BRAIN_PM_ORCHESTRATE" ] && {
  # Check for active project — if found, activate orchestration
  ACTIVE=$(brain pm project list --json 2>/dev/null | head -1)
  [ -z "$ACTIVE" ] || [ "$ACTIVE" = "[]" ] && exit 0
  echo "export BRAIN_PM_ORCHESTRATE=1" >> "$CLAUDE_ENV_FILE"
}
brain pm orchestrate session-start < /dev/stdin
`;

const WORKTREE_CHECK_HOOK = `#!/bin/bash
[ -z "$BRAIN_PM_ORCHESTRATE" ] && exit 0
[ -z "$BRAIN_PM_WORKTREE" ] && exit 0
brain pm orchestrate worktree-check
`;

const AGENT_DONE_HOOK = `#!/bin/bash
[ -z "$BRAIN_PM_ORCHESTRATE" ] && exit 0
brain pm orchestrate agent-done < /dev/stdin
`;

const HOOK_FILES: Record<string, string> = {
  'brain-pm-session.sh': SESSION_START_HOOK,
  'brain-pm-worktree.sh': WORKTREE_CHECK_HOOK,
  'brain-pm-agent-done.sh': AGENT_DONE_HOOK,
};

interface HookEntry {
  type: string;
  command: string;
}

interface HookMatcher {
  matcher: string;
  hooks: HookEntry[];
}

interface SettingsJson {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

const SETTINGS_HOOK_ENTRIES: Record<string, HookMatcher> = {
  SessionStart: {
    matcher: '',
    hooks: [{ type: 'command', command: 'bash ~/.claude/hooks/brain-pm-session.sh' }],
  },
  PreToolUse: {
    matcher: '',
    hooks: [{ type: 'command', command: 'bash ~/.claude/hooks/brain-pm-worktree.sh' }],
  },
  SubagentStop: {
    matcher: '',
    hooks: [{ type: 'command', command: 'bash ~/.claude/hooks/brain-pm-agent-done.sh' }],
  },
};

export function generateHookScripts(): Record<string, string> {
  return { ...HOOK_FILES };
}

export function generateSkillContent(): string {
  return `# Project Orchestrator

Manage project execution through brain PM. All state lives in brain.

## Activation
This skill activates when BRAIN_PM_ORCHESTRATE=1 is set (auto-detected on session start
when an active PM project exists). If not set, tell the user to run \`brain pm use <PREFIX>\`.

## Session Start
1. Run \`brain pm briefing --json\` and present a human-friendly summary
2. Show eligible tasks, in-progress work, recent decisions, cost since last session
3. Recommend first action (review tasks first, then blocking tasks, then by priority)

## Task Dispatch (Agent Tasks)
1. \`brain pm task claim <id> --json\` → get claim token
2. \`brain pm orchestrate route <id> --json\` → get routing (model, isolation, verify)
3. If isolation=worktree: \`brain pm orchestrate worktree-alloc <id> --json\`
4. \`brain pm task start <id> --token <token>\`
5. \`brain pm orchestrate render <id> --json\` → get full agent prompt
6. Spawn agent via Task tool with rendered prompt and model from routing
7. Run in background if human has other work to do

## Task Dispatch (Assisted/Human Tasks)
1. \`brain pm dispatch <id> --json\` → get context bundle
2. Present steps to user, help with automatable parts
3. Wait for user confirmation on manual steps
4. Record any decisions made

## After Task Completion
1. If routing said verify=true, spawn verification agent first (Haiku, read-only)
2. \`brain pm complete <id> --token <token> --summary "..."\`
3. If worktree was used: \`brain pm orchestrate worktree-release <id>\`
4. Check output for newly eligible tasks
5. Record any decisions made during execution

## Parallel Agents
- Run agent tasks in background (run_in_background: true)
- Surface completed agent work at natural break points
- Respect project's worktree budget (\`brain pm orchestrate worktree-status --json\`)
- User can say "pause agents" to stop auto-dispatch

## Session End
Run \`brain pm orchestrate session-end --json\` to get session summary.
Present: tasks completed, decisions made, cost estimate, next steps.

## Key Commands Reference
- \`brain pm briefing --json\` — session overview
- \`brain pm next --json\` — ranked eligible tasks
- \`brain pm waves --json\` — dependency wave groups
- \`brain pm orchestrate route <id> --json\` — routing decision
- \`brain pm orchestrate render <id> --json\` — rendered agent prompt
- \`brain pm complete <id> --token <token> --summary "..."\` — mark done
- \`brain pm verify <id> --json\` — verification plan
- \`brain pm decision add "..." --task <id>\` — record decision
- \`brain pm orchestrate worktree-status --json\` — worktree budget
`;
}

export function generateSanityCheckSkillContent(): string {
  return `# Sanity Check

Run a consistency check on a PM project.

Invoke with: /sanity-check

## When to Use
- After bulk ingesting planning docs into a PM project
- Periodically during active project execution
- When you suspect contradicting information in the project

## Workflow

### Step 1: Get structural report
Run: \`brain pm check --project <PREFIX> --json\`
Review the structural section. Report any issues found.

### Step 2: Get deep analysis (if project has decisions/docs)
Run: \`brain pm check --deep --project <PREFIX> --json\`
Review the semantic section:
- For each decision pair: read both decision contents, determine if they contradict
- For each task-decision pair: verify the task's work aligns with its impacting decisions
- For each supersession gap: determine if the older decision is effectively superseded

### Step 3: Review source document clusters
For each cluster with multiple docs:
- Identify which is most recent / authoritative
- Flag older docs that contain contradicted information
- Recommend: annotate source doc, archive brain note, or produce consolidated doc

### Step 4: Write report
Save to: docs/pm-module/reports/sanity-check-YYYY-MM-DD.md
Include sections: Summary, Critical Issues, Contradictions, Supersession Gaps, Stale Content, Source Document Freshness, Structural Issues, Recommended Actions.

### Step 5: Offer actions
Ask user if they want to:
- Create PM tasks for actionable findings
- Archive superseded notes
- Produce a consolidated document for any topic with contradicting sources
`;
}

function isBrainPmHook(entry: HookMatcher): boolean {
  return entry.hooks.some((h) => h.command.includes('brain-pm-'));
}

export function installHooks(claudeDir?: string): { installed: string[]; errors: string[] } {
  const baseDir = claudeDir ?? join(homedir(), '.claude');
  const hooksDir = join(baseDir, 'hooks');
  const skillDir = join(baseDir, 'skills', 'orchestrator');
  const settingsPath = join(baseDir, 'settings.json');
  const installed: string[] = [];
  const errors: string[] = [];

  mkdirSync(hooksDir, { recursive: true });
  mkdirSync(skillDir, { recursive: true });

  for (const [filename, content] of Object.entries(HOOK_FILES)) {
    const filePath = join(hooksDir, filename);
    try {
      writeFileSync(filePath, content, { mode: 0o755 });
      chmodSync(filePath, 0o755);
      installed.push(filePath);
    } catch (err) {
      errors.push(`Failed to write ${filePath}: ${(err as Error).message}`);
    }
  }

  try {
    let settings: SettingsJson = {};
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as SettingsJson;
    }

    if (!settings.hooks) {
      settings.hooks = {};
    }

    for (const [hookType, entry] of Object.entries(SETTINGS_HOOK_ENTRIES)) {
      if (!settings.hooks[hookType]) {
        settings.hooks[hookType] = [];
      }

      const existing = settings.hooks[hookType];
      const alreadyInstalled = existing.some((e) => isBrainPmHook(e));
      if (!alreadyInstalled) {
        existing.push(entry);
      }
    }

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    installed.push(settingsPath);
  } catch (err) {
    errors.push(`Failed to update settings: ${(err as Error).message}`);
  }

  try {
    const skillPath = join(skillDir, 'SKILL.md');
    writeFileSync(skillPath, generateSkillContent());
    installed.push(skillPath);
  } catch (err) {
    errors.push(`Failed to write skill: ${(err as Error).message}`);
  }

  // Write sanity-check skill
  const sanitySkillDir = join(baseDir, 'skills', 'sanity-check');
  mkdirSync(sanitySkillDir, { recursive: true });
  try {
    const sanitySkillPath = join(sanitySkillDir, 'SKILL.md');
    writeFileSync(sanitySkillPath, generateSanityCheckSkillContent());
    installed.push(sanitySkillPath);
  } catch (err) {
    errors.push(`Failed to write sanity-check skill: ${(err as Error).message}`);
  }

  return { installed, errors };
}

export function removeHooks(claudeDir?: string): { removed: string[]; errors: string[] } {
  const baseDir = claudeDir ?? join(homedir(), '.claude');
  const hooksDir = join(baseDir, 'hooks');
  const skillDir = join(baseDir, 'skills', 'orchestrator');
  const settingsPath = join(baseDir, 'settings.json');
  const removed: string[] = [];
  const errors: string[] = [];

  for (const filename of Object.keys(HOOK_FILES)) {
    const filePath = join(hooksDir, filename);
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        removed.push(filePath);
      }
    } catch (err) {
      errors.push(`Failed to remove ${filePath}: ${(err as Error).message}`);
    }
  }

  try {
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as SettingsJson;

      if (settings.hooks) {
        for (const hookType of Object.keys(SETTINGS_HOOK_ENTRIES)) {
          if (settings.hooks[hookType]) {
            settings.hooks[hookType] = settings.hooks[hookType].filter((e) => !isBrainPmHook(e));
            if (settings.hooks[hookType].length === 0) {
              delete settings.hooks[hookType];
            }
          }
        }

        if (Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }
      }

      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      removed.push(settingsPath);
    }
  } catch (err) {
    errors.push(`Failed to update settings: ${(err as Error).message}`);
  }

  try {
    if (existsSync(skillDir)) {
      rmSync(skillDir, { recursive: true });
      removed.push(skillDir);
    }
  } catch (err) {
    errors.push(`Failed to remove skill directory: ${(err as Error).message}`);
  }

  try {
    const sanitySkillDir = join(baseDir, 'skills', 'sanity-check');
    if (existsSync(sanitySkillDir)) {
      rmSync(sanitySkillDir, { recursive: true });
      removed.push(sanitySkillDir);
    }
  } catch (err) {
    errors.push(`Failed to remove sanity-check skill directory: ${(err as Error).message}`);
  }

  return { removed, errors };
}

export function createInstallHooksCommand(): Command {
  return new Command('install-hooks')
    .description('Install orchestration hooks and skill for Claude Code')
    .option('--remove', 'Remove installed hooks and skill')
    .option('--dry-run', 'Preview changes without writing files')
    .action((opts) => {
      if (opts.dryRun) {
        if (opts.remove) {
          process.stdout.write('Would remove:\n');
          for (const filename of Object.keys(HOOK_FILES)) {
            process.stdout.write(`  ~/.claude/hooks/${filename}\n`);
          }
          process.stdout.write('  ~/.claude/skills/orchestrator/\n');
          process.stdout.write('  ~/.claude/skills/sanity-check/\n');
          process.stdout.write('  Hook entries in ~/.claude/settings.json\n');
        } else {
          process.stdout.write('Would install:\n');
          for (const filename of Object.keys(HOOK_FILES)) {
            process.stdout.write(`  ~/.claude/hooks/${filename}\n`);
          }
          process.stdout.write('  ~/.claude/skills/orchestrator/SKILL.md\n');
          process.stdout.write('  ~/.claude/skills/sanity-check/SKILL.md\n');
          process.stdout.write('  Hook entries in ~/.claude/settings.json\n');
        }
        return;
      }

      if (opts.remove) {
        const result = removeHooks();
        if (result.errors.length > 0) {
          for (const err of result.errors) {
            process.stderr.write(`Error: ${err}\n`);
          }
          process.exitCode = 1;
          return;
        }
        process.stdout.write(`Removed ${result.removed.length} items.\n`);
      } else {
        const result = installHooks();
        if (result.errors.length > 0) {
          for (const err of result.errors) {
            process.stderr.write(`Error: ${err}\n`);
          }
          process.exitCode = 1;
          return;
        }
        process.stdout.write(`Installed ${result.installed.length} items.\n`);
        process.stdout.write(
          'Orchestration hooks are ready. Start a new Claude Code session to activate.\n'
        );
      }
    }) as unknown as Command;
}
