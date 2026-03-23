import { describe, it, expect } from 'vitest';
import {
  formatFeedbackSummary,
  parsePRUrl,
  prFeedbackCommand,
} from '../../src/commands/pr-feedback.js';
import type { PRReview, PRComment } from '../../src/commands/pr-feedback.js';

describe('parsePRUrl', () => {
  it('parses a standard GitHub PR URL', () => {
    const result = parsePRUrl('https://github.com/owner/repo/pull/123');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', number: '123' });
  });

  it('returns null for non-PR URLs', () => {
    expect(parsePRUrl('https://github.com/owner/repo')).toBeNull();
    expect(parsePRUrl('not-a-url')).toBeNull();
  });
});

describe('formatFeedbackSummary', () => {
  it('shows no-feedback message when both arrays are empty', () => {
    const result = formatFeedbackSummary(42, [], []);
    expect(result).toContain('No review feedback found.');
    expect(result).toContain('#42');
  });

  it('includes review state and reviewer name', () => {
    const reviews: PRReview[] = [
      { id: 1, user: { login: 'alice' }, state: 'CHANGES_REQUESTED', body: 'Please fix the nit.' },
    ];
    const result = formatFeedbackSummary(10, reviews, []);
    expect(result).toContain('### Review by alice — CHANGES_REQUESTED');
    expect(result).toContain('Please fix the nit.');
  });

  it('formats inline comment with file and line', () => {
    const comments: PRComment[] = [
      {
        id: 1,
        user: { login: 'bob' },
        path: 'src/foo.ts',
        line: 42,
        original_line: null,
        body: 'This looks wrong.',
      },
    ];
    const result = formatFeedbackSummary(5, [], comments);
    expect(result).toContain('**src/foo.ts:42** — This looks wrong.');
  });

  it('falls back to original_line when line is null', () => {
    const comments: PRComment[] = [
      {
        id: 1,
        user: { login: 'carol' },
        path: 'src/bar.ts',
        line: null,
        original_line: 99,
        body: 'Outdated comment.',
      },
    ];
    const result = formatFeedbackSummary(7, [], comments);
    expect(result).toContain('**src/bar.ts:99** — Outdated comment.');
  });

  it('omits line number when both line fields are null', () => {
    const comments: PRComment[] = [
      {
        id: 1,
        user: { login: 'dave' },
        path: 'README.md',
        line: null,
        original_line: null,
        body: 'General comment.',
      },
    ];
    const result = formatFeedbackSummary(3, [], comments);
    expect(result).toContain('**README.md** — General comment.');
  });

  it('groups comments under the correct reviewer section', () => {
    const reviews: PRReview[] = [
      { id: 1, user: { login: 'alice' }, state: 'APPROVED', body: 'LGTM' },
    ];
    const comments: PRComment[] = [
      {
        id: 2,
        user: { login: 'alice' },
        path: 'src/index.ts',
        line: 1,
        original_line: null,
        body: 'Minor nit.',
      },
      {
        id: 3,
        user: { login: 'bob' },
        path: 'src/utils.ts',
        line: 5,
        original_line: null,
        body: 'Could be cleaner.',
      },
    ];
    const result = formatFeedbackSummary(20, reviews, comments);
    // Alice appears with APPROVED state
    expect(result).toContain('### Review by alice — APPROVED');
    expect(result).toContain('LGTM');
    expect(result).toContain('Minor nit.');
    // Bob has no top-level review, defaults to COMMENTED
    expect(result).toContain('### Review by bob — COMMENTED');
    expect(result).toContain('Could be cleaner.');
  });

  it('handles review with no body', () => {
    const reviews: PRReview[] = [{ id: 1, user: { login: 'alice' }, state: 'APPROVED', body: '' }];
    const result = formatFeedbackSummary(1, reviews, []);
    expect(result).toContain('### Review by alice — APPROVED');
    // No extra blank content from empty body
    expect(result).not.toContain('undefined');
  });
});

describe('prFeedbackCommand structure', () => {
  it('is named pr', () => {
    expect(prFeedbackCommand.name()).toBe('pr');
  });

  it('has feedback subcommand', () => {
    const subNames = prFeedbackCommand.commands.map((c) => c.name());
    expect(subNames).toContain('feedback');
  });

  it('feedback subcommand has --auto-resume option', () => {
    const feedback = prFeedbackCommand.commands.find((c) => c.name() === 'feedback')!;
    const optionNames = feedback.options.map((o) => o.long);
    expect(optionNames).toContain('--auto-resume');
  });

  it('feedback subcommand accepts url argument', () => {
    const feedback = prFeedbackCommand.commands.find((c) => c.name() === 'feedback')!;
    const argNames = feedback.registeredArguments.map((a) => a.name());
    expect(argNames).toContain('url');
  });
});
