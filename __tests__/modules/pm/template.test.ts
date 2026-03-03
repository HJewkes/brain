import { describe, test, expect } from 'vitest';
import {
  renderAgentPrompt,
  renderVerificationPrompt,
  renderBriefingSummary,
} from '../../../src/modules/pm/engine/template.js';
import type { ContextBundle } from '../../../src/modules/pm/engine/dispatch.js';
import type { TaskMetadata } from '../../../src/modules/pm/types.js';

function makeTask(overrides: Partial<TaskMetadata> = {}): TaskMetadata {
  return {
    display_id: 'WEB-01-003',
    project: 'WEB',
    workstream: 1,
    number: 3,
    status: 'pending',
    mode: 'auto',
    category: 'implementation',
    priority: 'medium',
    ...overrides,
  };
}

function makeBundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
  return {
    task: makeTask(),
    body: '',
    relatedNotes: [],
    dependencies: [],
    decisions: [],
    constraints: [],
    contextHash: 'abc123',
    ...overrides,
  };
}

describe('renderAgentPrompt', () => {
  test('includes task display ID in header', () => {
    const result = renderAgentPrompt(makeBundle());
    expect(result).toContain('# Task WEB-01-003');
  });

  test('includes intro instruction', () => {
    const result = renderAgentPrompt(makeBundle());
    expect(result).toContain('Follow these instructions precisely');
  });

  test('includes dependency summaries when present', () => {
    const bundle = makeBundle({
      dependencies: [
        {
          displayId: 'WEB-01-001',
          name: 'Setup DB',
          status: 'done',
          summary: 'Database initialized',
        },
        { displayId: 'WEB-01-002', name: 'Add schema', status: 'done' },
      ],
    });
    const result = renderAgentPrompt(bundle);
    expect(result).toContain('## Dependencies');
    expect(result).toContain('**WEB-01-001**');
    expect(result).toContain('Database initialized');
    expect(result).toContain('**WEB-01-002**');
  });

  test('omits dependencies section when empty', () => {
    const result = renderAgentPrompt(makeBundle());
    expect(result).not.toContain('## Dependencies');
  });

  test('includes decision content when present', () => {
    const bundle = makeBundle({
      decisions: [
        { displayId: 'WEB-D-001', status: 'accepted', content: 'Use SQLite for storage' },
      ],
    });
    const result = renderAgentPrompt(bundle);
    expect(result).toContain('## Decisions');
    expect(result).toContain('WEB-D-001');
    expect(result).toContain('Use SQLite for storage');
  });

  test('includes prompt content when available', () => {
    const bundle = makeBundle({ prompt: 'Build the API endpoint for /users' });
    const result = renderAgentPrompt(bundle);
    expect(result).toContain('## Instructions');
    expect(result).toContain('Build the API endpoint for /users');
  });

  test('auto-generates instructions from context when no prompt exists', () => {
    const result = renderAgentPrompt(makeBundle());
    expect(result).toContain('## Instructions');
    expect(result).toContain('Implement: **WEB-01-003**');
  });

  test('includes worktree path when provided', () => {
    const result = renderAgentPrompt(makeBundle(), { worktreePath: '/tmp/wt-123' });
    expect(result).toContain('Work in: `/tmp/wt-123`');
  });

  test('omits worktree path when not provided', () => {
    const result = renderAgentPrompt(makeBundle());
    expect(result).toContain('No isolation');
  });

  test('includes status reporting commands with correct display ID', () => {
    const result = renderAgentPrompt(makeBundle());
    expect(result).toContain('brain pm task update WEB-01-003 --status in-progress');
    expect(result).toContain('brain pm task update WEB-01-003 --status done');
  });

  test('includes completion note about not calling brain pm complete', () => {
    const result = renderAgentPrompt(makeBundle());
    expect(result).toContain('Do NOT call brain pm complete');
    expect(result).toContain('Write a summary as final output');
  });

  test('includes validation checks for implementation category', () => {
    const result = renderAgentPrompt(makeBundle());
    expect(result).toContain('npm test');
    expect(result).toContain('npm run typecheck');
    expect(result).toContain('npm run lint');
  });

  test('includes category-specific validation for testing tasks', () => {
    const bundle = makeBundle({ task: makeTask({ category: 'testing' }) });
    const result = renderAgentPrompt(bundle);
    expect(result).toContain('npm test');
    expect(result).not.toContain('npm run lint');
  });
});

describe('renderVerificationPrompt', () => {
  test('includes verification header', () => {
    const result = renderVerificationPrompt(makeBundle());
    expect(result).toContain('# Verification: WEB-01-003');
  });

  test('includes do-not-modify warning', () => {
    const result = renderVerificationPrompt(makeBundle());
    expect(result).toContain('Do NOT modify any code');
  });

  test('lists standard checks', () => {
    const result = renderVerificationPrompt(makeBundle());
    expect(result).toContain('npm test');
    expect(result).toContain('npm run typecheck');
    expect(result).toContain('npm run lint');
    expect(result).toContain('npm run build');
  });

  test('includes worktree path when provided', () => {
    const result = renderVerificationPrompt(makeBundle(), { worktreePath: '/tmp/verify-wt' });
    expect(result).toContain('Work in: `/tmp/verify-wt`');
  });

  test('includes reporting format', () => {
    const result = renderVerificationPrompt(makeBundle());
    expect(result).toContain('PASS or FAIL');
  });
});

describe('renderBriefingSummary', () => {
  test('renders project name and status', () => {
    const result = renderBriefingSummary({ projectName: 'WebApp', status: 'active' });
    expect(result).toContain('# WebApp');
    expect(result).toContain('Status: **active**');
  });

  test('falls back to project field when projectName missing', () => {
    const result = renderBriefingSummary({ project: 'WEB', status: 'active' });
    expect(result).toContain('# WEB');
  });

  test('shows task counts', () => {
    const tasks = [
      { displayId: 'WEB-01-001', status: 'done', title: 'A' },
      { displayId: 'WEB-01-002', status: 'in-progress', title: 'B' },
      { displayId: 'WEB-01-003', status: 'pending', title: 'C' },
      { displayId: 'WEB-01-004', status: 'blocked', title: 'D' },
    ];
    const result = renderBriefingSummary({ projectName: 'P', status: 'active', tasks });
    expect(result).toContain('Done | 1');
    expect(result).toContain('In Progress | 1');
    expect(result).toContain('Eligible | 1');
    expect(result).toContain('Blocked | 1');
    expect(result).toContain('**Total** | **4**');
  });

  test('shows recommended next actions', () => {
    const result = renderBriefingSummary({
      projectName: 'P',
      status: 'active',
      recommendations: ['Focus on WEB-01-003', 'Review decision D-001'],
    });
    expect(result).toContain('## Recommendations');
    expect(result).toContain('Focus on WEB-01-003');
    expect(result).toContain('Review decision D-001');
  });

  test('handles empty task lists gracefully', () => {
    const result = renderBriefingSummary({ projectName: 'Empty', status: 'active', tasks: [] });
    expect(result).toContain('**Total** | **0**');
    expect(result).not.toContain('## Eligible Tasks');
  });

  test('handles missing fields gracefully', () => {
    const result = renderBriefingSummary({});
    expect(result).toContain('Unknown Project');
    expect(result).toContain('**unknown**');
  });

  test('lists eligible tasks', () => {
    const tasks = [{ displayId: 'WEB-01-005', status: 'pending', name: 'Build API' }];
    const result = renderBriefingSummary({ projectName: 'P', status: 'active', tasks });
    expect(result).toContain('## Eligible Tasks');
    expect(result).toContain('WEB-01-005: Build API');
  });
});
