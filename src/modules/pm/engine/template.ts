import type { ContextBundle, DependencySummary, DecisionSummary } from './dispatch.js';

export interface RenderOptions {
  worktreePath?: string;
  model?: string;
  verificationRequired?: boolean;
}

export function renderAgentPrompt(bundle: ContextBundle, options?: RenderOptions): string {
  const { task, prompt, dependencies, decisions } = bundle;
  const sections: string[] = [];

  sections.push(`# Task ${task.display_id}`);
  sections.push(
    'You are executing a project task. Follow these instructions precisely.',
  );

  if (dependencies.length > 0) {
    sections.push(renderDependenciesSection(dependencies));
  }

  if (decisions.length > 0) {
    sections.push(renderDecisionsSection(decisions));
  }

  sections.push(renderInstructionsSection(prompt));
  sections.push(renderValidationSection(task.category));
  sections.push(renderStatusReportingSection(task.display_id));
  sections.push(renderWorktreeSection(options?.worktreePath));
  sections.push(
    '## Completion\n\nDo NOT call brain pm complete. Write a summary as final output.',
  );

  return sections.join('\n\n');
}

export function renderVerificationPrompt(bundle: ContextBundle, options?: RenderOptions): string {
  const { task } = bundle;
  const sections: string[] = [];

  sections.push(`# Verification: ${task.display_id}`);
  sections.push(
    'You are verifying the output of a completed implementation task. Do NOT modify any code.',
  );

  sections.push(renderWorktreeSection(options?.worktreePath));

  sections.push(`## Checks

Run each of the following and report results:

1. \`npm test\`
2. \`npm run typecheck\`
3. \`npm run lint\`
4. \`npm run build\`

## Reporting

For each check, report:
- **Command**: the command run
- **Output**: relevant output (truncate if long)
- **Result**: PASS or FAIL`);

  return sections.join('\n\n');
}

export interface BriefingTask {
  displayId: string;
  name?: string;
  title?: string;
  status: string;
  category?: string;
  priority?: string;
}

export interface BriefingJson {
  project?: string;
  projectName?: string;
  status?: string;
  tasks?: BriefingTask[];
  recommendations?: string[];
  [key: string]: unknown;
}

export function renderBriefingSummary(briefingJson: Record<string, unknown>): string {
  const data = briefingJson as BriefingJson;
  const sections: string[] = [];

  const projectName = data.projectName ?? data.project ?? 'Unknown Project';
  const status = data.status ?? 'unknown';
  sections.push(`# ${projectName}\n\nStatus: **${status}**`);

  const tasks = data.tasks ?? [];
  const done = tasks.filter((t) => t.status === 'done').length;
  const inProgress = tasks.filter((t) => t.status === 'in-progress').length;
  const eligible = tasks.filter((t) => t.status === 'pending').length;
  const blocked = tasks.filter((t) => t.status === 'blocked').length;

  sections.push(`## Tasks

| State | Count |
|-------|-------|
| Done | ${done} |
| In Progress | ${inProgress} |
| Eligible | ${eligible} |
| Blocked | ${blocked} |
| **Total** | **${tasks.length}** |`);

  const eligibleTasks = tasks.filter((t) => t.status === 'pending');
  if (eligibleTasks.length > 0) {
    const list = eligibleTasks
      .map((t) => `- ${t.displayId}: ${t.name ?? t.title ?? 'Untitled'}`)
      .join('\n');
    sections.push(`## Eligible Tasks\n\n${list}`);
  }

  const recs = data.recommendations ?? [];
  if (recs.length > 0) {
    const list = recs.map((r) => `- ${r}`).join('\n');
    sections.push(`## Recommendations\n\n${list}`);
  }

  return sections.join('\n\n');
}

function renderDependenciesSection(deps: DependencySummary[]): string {
  const items = deps
    .map((d) => {
      const summary = d.summary ? `: ${d.summary}` : '';
      return `- **${d.displayId}** (${d.name}) — ${d.status}${summary}`;
    })
    .join('\n');
  return `## Dependencies\n\n${items}`;
}

function renderDecisionsSection(decisions: DecisionSummary[]): string {
  const items = decisions
    .map((d) => `- **${d.displayId}** [${d.status}]: ${d.content}`)
    .join('\n');
  return `## Decisions\n\n${items}`;
}

function renderInstructionsSection(prompt: string | undefined): string {
  const content = prompt ?? 'No specific prompt provided.';
  return `## Instructions\n\n${content}`;
}

function renderValidationSection(category: string): string {
  const checks = validationChecksFor(category);
  const items = checks.map((c) => `- ${c}`).join('\n');
  return `## Validation\n\n${items}`;
}

function validationChecksFor(category: string): string[] {
  switch (category) {
    case 'implementation':
      return [
        'Run `npm test` and confirm all tests pass',
        'Run `npm run typecheck` with no errors',
        'Run `npm run lint` with no warnings',
      ];
    case 'testing':
      return [
        'Run `npm test` and confirm new tests pass',
        'Run `npm run typecheck` with no errors',
      ];
    case 'documentation':
      return [
        'Verify all links resolve',
        'Run `npm run lint` with no warnings',
      ];
    case 'infrastructure':
      return [
        'Run `npm run build` and confirm success',
        'Run `npm test` and confirm all tests pass',
        'Run `npm run typecheck` with no errors',
      ];
    default:
      return [
        'Run `npm test` and confirm all tests pass',
        'Run `npm run typecheck` with no errors',
      ];
  }
}

function renderStatusReportingSection(displayId: string): string {
  return `## Status Reporting

Update task status as you work:

\`\`\`bash
brain pm task update ${displayId} --status in-progress
brain pm task update ${displayId} --status done
\`\`\``;
}

function renderWorktreeSection(worktreePath: string | undefined): string {
  if (!worktreePath) {
    return '## Worktree\n\nNo isolation — working in main tree.';
  }
  return `## Worktree\n\nWork in: \`${worktreePath}\``;
}
