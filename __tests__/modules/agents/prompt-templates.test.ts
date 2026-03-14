import { describe, it, expect } from 'vitest';
import {
  renderPrompt,
  selectTemplate,
  implementationTemplate,
  researchTemplate,
  refactorTemplate,
} from '../../../src/modules/agents/prompt-templates.js';
import type {
  PromptContext,
  SpawnPromptTemplate,
} from '../../../src/modules/agents/prompt-templates.js';

function makeContext(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    taskId: 'VNM-01.05',
    title: 'Add search reranking',
    branch: 'feat/vnm-01.05',
    claimToken: 'abc-123',
    projectDir: '/projects/brain',
    ...overrides,
  };
}

describe('renderPrompt', () => {
  it('renders static sections with headings', () => {
    const template: SpawnPromptTemplate = {
      name: 'test',
      description: 'test template',
      sections: [{ heading: 'Info', content: 'Static content here.' }],
    };

    const result = renderPrompt(template, makeContext());

    expect(result).toContain('## Info');
    expect(result).toContain('Static content here.');
  });

  it('renders dynamic sections by calling content function', () => {
    const template: SpawnPromptTemplate = {
      name: 'dynamic',
      description: 'dynamic test',
      sections: [{ heading: 'Task', content: (ctx) => `Task: ${ctx.taskId}` }],
    };

    const result = renderPrompt(template, makeContext());

    expect(result).toContain('Task: VNM-01.05');
  });

  it('renders multiple sections separated by blank lines', () => {
    const template: SpawnPromptTemplate = {
      name: 'multi',
      description: 'multi section',
      sections: [
        { heading: 'A', content: 'First' },
        { heading: 'B', content: 'Second' },
      ],
    };

    const result = renderPrompt(template, makeContext());

    expect(result).toContain('## A\nFirst\n\n## B\nSecond');
  });
});

describe('implementationTemplate', () => {
  it('includes task heading with id and title', () => {
    const result = renderPrompt(implementationTemplate, makeContext());

    expect(result).toContain('VNM-01.05');
    expect(result).toContain('Add search reranking');
  });

  it('includes git workflow with branch and claim token', () => {
    const result = renderPrompt(implementationTemplate, makeContext());

    expect(result).toContain('`feat/vnm-01.05`');
    expect(result).toContain('`abc-123`');
  });

  it('includes verification steps', () => {
    const result = renderPrompt(implementationTemplate, makeContext());

    expect(result).toContain('npx tsc --noEmit');
    expect(result).toContain('npm test');
    expect(result).toContain('npx eslint');
  });

  it('includes description when provided', () => {
    const ctx = makeContext({ description: 'Implement cross-encoder pipeline' });
    const result = renderPrompt(implementationTemplate, ctx);

    expect(result).toContain('Implement cross-encoder pipeline');
  });

  it('renders file ownership patterns', () => {
    const ctx = makeContext({ fileOwnership: ['src/services/', 'src/adapters/'] });
    const result = renderPrompt(implementationTemplate, ctx);

    expect(result).toContain('`src/services/`');
    expect(result).toContain('`src/adapters/`');
  });

  it('shows no constraints when file ownership is empty', () => {
    const ctx = makeContext({ fileOwnership: [] });
    const result = renderPrompt(implementationTemplate, ctx);

    expect(result).toContain('No file ownership constraints.');
  });

  it('includes wave info when provided', () => {
    const ctx = makeContext({
      waveInfo: { waveNumber: 2, totalWaves: 4, waveTasks: ['VNM-01.06', 'VNM-01.07'] },
    });
    const result = renderPrompt(implementationTemplate, ctx);

    expect(result).toContain('Wave 2 of 4');
    expect(result).toContain('VNM-01.06, VNM-01.07');
  });

  it('renders conventions list', () => {
    const ctx = makeContext({
      conventions: ['ESM imports with .js extensions', 'Max 30 lines per function'],
    });
    const result = renderPrompt(implementationTemplate, ctx);

    expect(result).toContain('ESM imports with .js extensions');
    expect(result).toContain('Max 30 lines per function');
  });

  it('includes worktree path when provided', () => {
    const ctx = makeContext({ worktreePath: '/tmp/worktree/vnm-01.05' });
    const result = renderPrompt(implementationTemplate, ctx);

    expect(result).toContain('`/tmp/worktree/vnm-01.05`');
  });
});

describe('researchTemplate', () => {
  it('includes task info', () => {
    const result = renderPrompt(researchTemplate, makeContext());

    expect(result).toContain('VNM-01.05');
  });

  it('describes output format for findings', () => {
    const result = renderPrompt(researchTemplate, makeContext());

    expect(result).toContain('findings summary');
    expect(result).toContain('Key discoveries');
  });

  it('states no git changes expected', () => {
    const result = renderPrompt(researchTemplate, makeContext());

    expect(result).toContain('No git changes');
  });

  it('does not include verification steps', () => {
    const result = renderPrompt(researchTemplate, makeContext());

    expect(result).not.toContain('npx tsc --noEmit');
  });
});

describe('refactorTemplate', () => {
  it('includes backward compatibility section', () => {
    const result = renderPrompt(refactorTemplate, makeContext());

    expect(result).toContain('Backward Compatibility');
    expect(result).toContain('existing tests must continue to pass');
  });

  it('includes git workflow', () => {
    const result = renderPrompt(refactorTemplate, makeContext());

    expect(result).toContain('`feat/vnm-01.05`');
  });

  it('includes verification steps', () => {
    const result = renderPrompt(refactorTemplate, makeContext());

    expect(result).toContain('npx tsc --noEmit');
    expect(result).toContain('npm test');
  });
});

describe('selectTemplate', () => {
  it('returns implementation template for implementation category', () => {
    expect(selectTemplate('implementation')).toBe(implementationTemplate);
  });

  it('returns implementation template for infrastructure category', () => {
    expect(selectTemplate('infrastructure')).toBe(implementationTemplate);
  });

  it('returns implementation template for migration category', () => {
    expect(selectTemplate('migration')).toBe(implementationTemplate);
  });

  it('returns implementation template for testing category', () => {
    expect(selectTemplate('testing')).toBe(implementationTemplate);
  });

  it('returns research template for research category', () => {
    expect(selectTemplate('research')).toBe(researchTemplate);
  });

  it('returns research template for design category', () => {
    expect(selectTemplate('design')).toBe(researchTemplate);
  });

  it('returns research template for documentation category', () => {
    expect(selectTemplate('documentation')).toBe(researchTemplate);
  });

  it('returns research template for review category', () => {
    expect(selectTemplate('review')).toBe(researchTemplate);
  });
});
