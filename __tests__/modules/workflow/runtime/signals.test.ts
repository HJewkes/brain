import { describe, test, expect } from 'vitest';
import {
  parseSignals,
  registerSignalPattern,
} from '../../../../src/modules/workflow/runtime/signals.js';

describe('parseSignals', () => {
  test('returns needs_revision for "## Verdict: NEEDS REVISION"', () => {
    const output = '## Verdict: NEEDS REVISION\n\nSome feedback here.';
    expect(parseSignals('review', 'design-review', output)).toBe('needs_revision');
  });

  test('returns has_open_questions for non-empty Open Questions section', () => {
    const output = '## Open Questions\n- What about edge cases?\n- How to handle errors?\n';
    expect(parseSignals('design', 'planning', output)).toBe('has_open_questions');
  });

  test('returns null for approved verdict', () => {
    const output = '## Verdict: APPROVED\n\nLooks good.';
    expect(parseSignals('review', 'design-review', output)).toBeNull();
  });

  test('returns null for empty output', () => {
    expect(parseSignals('step1', 'workflow1', '')).toBeNull();
    expect(parseSignals('step1', 'workflow1', undefined as unknown as string)).toBeNull();
  });

  test('registerSignalPattern adds custom pattern', () => {
    registerSignalPattern('custom_signal', (content) => content.includes('CUSTOM_TRIGGER'));

    expect(parseSignals('step', 'wf', 'contains CUSTOM_TRIGGER here')).toBe('custom_signal');
    expect(parseSignals('step', 'wf', 'no trigger here')).toBeNull();
  });

  test('needs_revision takes priority over has_open_questions', () => {
    const output = '## Verdict: NEEDS REVISION\n\n## Open Questions\n- Something?\n';
    expect(parseSignals('review', 'wf', output)).toBe('needs_revision');
  });

  test('has_open_questions ignores "(none)" and "None" content', () => {
    expect(parseSignals('s', 'w', '## Open Questions\n(none)\n')).toBeNull();
    expect(parseSignals('s', 'w', '## Open Questions\nNone\n')).toBeNull();
  });

  // --- Review signals ---

  test('returns approved for "Verdict: PASS"', () => {
    expect(parseSignals('review', 'wf', 'Verdict: PASS\n\nAll good.')).toBe('approved');
  });

  test('returns approved for "## Verdict: READY"', () => {
    expect(parseSignals('critic', 'wf', '## Verdict: READY\n\nDesign approved.')).toBe('approved');
  });

  test('returns needs_fixes for "Verdict: NEEDS WORK"', () => {
    expect(parseSignals('review', 'wf', 'Verdict: NEEDS WORK\n\n## FIX Items\n1. Fix X')).toBe(
      'needs_fixes'
    );
  });

  test('returns needs_fixes for FIX Items section with content', () => {
    expect(parseSignals('review', 'wf', '## FIX Items\n1. Something broken')).toBe('needs_fixes');
  });

  test('returns changes_requested for PR review signal', () => {
    expect(parseSignals('review', 'wf', 'Status: changes requested')).toBe('changes_requested');
  });

  // --- Brainstorming signals ---

  test('returns needs_clarification for ambiguous designs', () => {
    expect(parseSignals('design', 'wf', 'This needs clarification on the API.')).toBe(
      'needs_clarification'
    );
  });

  // --- Risk routing ---

  test('returns high_risk for risk score >= 4', () => {
    expect(parseSignals('review', 'wf', 'Risk Score: 5')).toBe('high_risk');
    expect(parseSignals('review', 'wf', 'Risk Level: 4')).toBe('high_risk');
  });

  test('returns null for low risk score', () => {
    expect(parseSignals('review', 'wf', 'Risk Score: 2')).toBeNull();
  });

  // --- UX prototype signals ---

  test('returns needs_changes for iterate verdict', () => {
    expect(parseSignals('review', 'wf', '## Verdict: ITERATE\n\nNeeds polish.')).toBe(
      'needs_changes'
    );
  });
});
