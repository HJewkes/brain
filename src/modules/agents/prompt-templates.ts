import type { TaskCategory } from '../pm/types.js';

export interface PromptContext {
  taskId: string;
  title: string;
  description?: string;
  branch: string;
  claimToken: string;
  projectDir: string;
  worktreePath?: string;
  fileOwnership?: string[];
  waveInfo?: { waveNumber: number; totalWaves: number; waveTasks: string[] };
  conventions?: string[];
}

export interface PromptSection {
  heading: string;
  content: string | ((context: PromptContext) => string);
}

export interface SpawnPromptTemplate {
  name: string;
  description: string;
  sections: PromptSection[];
}

export function renderPrompt(template: SpawnPromptTemplate, context: PromptContext): string {
  const lines: string[] = [];
  for (const section of template.sections) {
    lines.push(`## ${section.heading}`);
    const body = typeof section.content === 'function' ? section.content(context) : section.content;
    lines.push(body);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function formatTaskSection(ctx: PromptContext): string {
  const lines = [`**Task**: ${ctx.taskId} — ${ctx.title}`];
  if (ctx.description) lines.push('', ctx.description);
  return lines.join('\n');
}

function formatGitSection(ctx: PromptContext): string {
  const lines = [
    `- Branch: \`${ctx.branch}\``,
    `- Commit message format: imperative mood, short subject (<72 chars)`,
    `- Claim token: \`${ctx.claimToken}\``,
  ];
  if (ctx.worktreePath) lines.push(`- Worktree: \`${ctx.worktreePath}\``);
  return lines.join('\n');
}

function formatFileOwnershipSection(ctx: PromptContext): string {
  if (!ctx.fileOwnership || ctx.fileOwnership.length === 0) {
    return 'No file ownership constraints.';
  }
  const items = ctx.fileOwnership.map((p) => `- \`${p}\``);
  return ['Only modify files matching:', ...items].join('\n');
}

function formatConventionsSection(ctx: PromptContext): string {
  if (!ctx.conventions || ctx.conventions.length === 0) {
    return 'Follow project conventions.';
  }
  return ctx.conventions.map((c) => `- ${c}`).join('\n');
}

function formatWaveSection(ctx: PromptContext): string {
  if (!ctx.waveInfo) return 'No wave context.';
  const lines = [`Wave ${ctx.waveInfo.waveNumber} of ${ctx.waveInfo.totalWaves}.`];
  if (ctx.waveInfo.waveTasks.length > 0) {
    lines.push(`Parallel tasks: ${ctx.waveInfo.waveTasks.join(', ')}`);
  }
  return lines.join('\n');
}

export const implementationTemplate: SpawnPromptTemplate = {
  name: 'implementation',
  description: 'For feature and bug tasks with code changes',
  sections: [
    { heading: 'Task', content: formatTaskSection },
    { heading: 'Git Workflow', content: formatGitSection },
    { heading: 'File Ownership', content: formatFileOwnershipSection },
    { heading: 'Wave Context', content: formatWaveSection },
    { heading: 'Conventions', content: formatConventionsSection },
    {
      heading: 'Verification',
      content: [
        'Before marking complete, run:',
        '1. `npx tsc --noEmit` (typecheck)',
        '2. `npm test` (tests)',
        '3. `npx eslint` (lint)',
      ].join('\n'),
    },
  ],
};

export const researchTemplate: SpawnPromptTemplate = {
  name: 'research',
  description: 'For research tasks producing findings without code changes',
  sections: [
    { heading: 'Task', content: formatTaskSection },
    {
      heading: 'Output Format',
      content: [
        'Produce a findings summary covering:',
        '- Key discoveries and insights',
        '- Comparison of alternatives (if applicable)',
        '- Recommendations with justification',
        '- Open questions for follow-up',
      ].join('\n'),
    },
    { heading: 'Conventions', content: formatConventionsSection },
    {
      heading: 'Scope',
      content: 'This is a research task. No git changes or code modifications are expected.',
    },
  ],
};

export const refactorTemplate: SpawnPromptTemplate = {
  name: 'refactor',
  description: 'For refactoring with backward compatibility requirements',
  sections: [
    { heading: 'Task', content: formatTaskSection },
    { heading: 'Git Workflow', content: formatGitSection },
    { heading: 'File Ownership', content: formatFileOwnershipSection },
    {
      heading: 'Backward Compatibility',
      content: [
        'Refactoring must preserve existing behavior:',
        '- All existing tests must continue to pass',
        '- Public API signatures must remain unchanged (or add deprecation notices)',
        '- No breaking changes to consumers',
      ].join('\n'),
    },
    { heading: 'Wave Context', content: formatWaveSection },
    { heading: 'Conventions', content: formatConventionsSection },
    {
      heading: 'Verification',
      content: [
        'Verify backward compatibility:',
        '1. `npx tsc --noEmit` (typecheck)',
        '2. `npm test` (all tests pass, not just new ones)',
        '3. `npx eslint` (lint)',
      ].join('\n'),
    },
  ],
};

const TEMPLATE_REGISTRY: Record<string, SpawnPromptTemplate> = {
  implementation: implementationTemplate,
  infrastructure: implementationTemplate,
  migration: implementationTemplate,
  testing: implementationTemplate,
  configuration: implementationTemplate,
  research: researchTemplate,
  design: researchTemplate,
  documentation: researchTemplate,
  review: researchTemplate,
  refactor: refactorTemplate,
};

export function selectTemplate(category: TaskCategory): SpawnPromptTemplate {
  return TEMPLATE_REGISTRY[category] ?? implementationTemplate;
}
