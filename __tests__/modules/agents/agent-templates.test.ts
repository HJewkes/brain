import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderTemplate } from '../../../src/modules/agents/template-renderer.js';
import { buildTemplateVariables } from '../../../src/modules/pm/commands/orchestration.js';
import type { AgentDispatchContext } from '../../../src/modules/agents/dispatch-context.js';

const TEMPLATES_DIR = join(__dirname, '..', '..', '..', 'templates', 'agents');

function makeDispatch(overrides?: Partial<AgentDispatchContext>): AgentDispatchContext {
  return {
    taskId: 'TST-01.01',
    routing: { model: 'opus', agentType: 'worker', isolation: 'worktree', verify: true },
    agentDispatchable: true,
    context: {
      title: 'Implement feature X',
      body: 'Add the new feature to src/services/search.ts',
      workstream: { displayId: 'TST-01', title: 'Search' },
      prompt: undefined,
      dependencies: [{ displayId: 'TST-00.01', name: 'Setup scaffolding', status: 'done' }],
      decisions: [{ displayId: 'DEC-001', status: 'accepted', content: 'Use FTS5 for search' }],
      constraints: [],
    },
    waveInfo: { waveNumber: 2, totalWaves: 4, waveTasks: ['TST-01.02'] },
    contextHash: 'abc123',
    extensions: {},
    fileOwnership: {
      rules: [
        { agentId: 'TST-01.01', patterns: ['src/services/search.ts'] },
        { agentId: 'TST-01.02', patterns: ['src/services/graph.ts'] },
      ],
    },
    ...overrides,
  };
}

describe('coordinator.md template', () => {
  it('renders without unfilled placeholders', () => {
    const raw = readFileSync(join(TEMPLATES_DIR, 'coordinator.md'), 'utf-8');
    const dispatch = makeDispatch();
    const vars = buildTemplateVariables(dispatch, '/project/brain', {
      teamName: 'burndown-tst',
      claimToken: 'tok-abc',
    });

    const rendered = renderTemplate(raw, vars);

    expect(rendered).toContain('burndown-tst');
    expect(rendered).toContain('/project/brain');
    expect(rendered).toContain('npx tsx src/cli.ts');
    expect(rendered).not.toMatch(/\{[A-Z][A-Z0-9_]*\}/);
  });

  it('contains key coordinator instructions', () => {
    const raw = readFileSync(join(TEMPLATES_DIR, 'coordinator.md'), 'utf-8');
    expect(raw).toContain('pm next --json');
    expect(raw).toContain('pm task claim');
    expect(raw).toContain('render-prompt');
    expect(raw).toContain('Agent tool');
    expect(raw).toContain('SendMessage');
    expect(raw).toContain('DONE');
    expect(raw).toContain('FAILED');
  });
});

describe('worker.md template', () => {
  it('renders without unfilled placeholders', () => {
    const raw = readFileSync(join(TEMPLATES_DIR, 'worker.md'), 'utf-8');
    const dispatch = makeDispatch();
    const vars = buildTemplateVariables(dispatch, '/project/brain', {
      teamName: 'burndown-tst',
      claimToken: 'tok-abc',
    });

    const rendered = renderTemplate(raw, vars);

    expect(rendered).toContain('TST-01.01');
    expect(rendered).toContain('Implement feature X');
    expect(rendered).toContain('burndown-tst');
    expect(rendered).toContain('tok-abc');
    expect(rendered).toContain('src/services/search.ts');
    expect(rendered).toContain('npx tsc --noEmit');
    expect(rendered).not.toMatch(/\{[A-Z][A-Z0-9_]*\}/);
  });

  it('contains key worker instructions', () => {
    const raw = readFileSync(join(TEMPLATES_DIR, 'worker.md'), 'utf-8');
    expect(raw).toContain('CLAUDE.md');
    expect(raw).toContain('SendMessage');
    expect(raw).toContain('DONE {TASK_ID}');
    expect(raw).toContain('FAILED {TASK_ID}');
    expect(raw).toContain('{VERIFY_COMMANDS}');
    expect(raw).toContain('{FILE_OWNERSHIP}');
    expect(raw).toContain('{DESCRIPTION}');
  });
});
