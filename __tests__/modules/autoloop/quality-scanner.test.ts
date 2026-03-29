import { describe, it, expect } from 'vitest';
import { scoreTask } from '../../../src/modules/autoloop/engine/quality-scanner.js';

describe('scoreTask', () => {
  it('scores a fully specified task near 1.0', () => {
    const score = scoreTask({
      display_id: 'VNM-01.01',
      title: 'Add SessionReviewLoop orchestrator',
      description:
        'Build the orchestrator that ties together session discovery, transcript reading, and insight extraction. See synthesis-execution-loop-autonomous-agent-patterns.md for patterns. Ref: VNM-45 design doc.',
      depends_on: ['VNM-45.02', 'VNM-45.03'],
      done_when: 'Orchestrator runs end-to-end on uncommitted sessions',
    });

    expect(score.overall).toBe(1.0);
    expect(score.dimensions.hasDescription).toBe(true);
    expect(score.dimensions.hasDependencies).toBe(true);
    expect(score.dimensions.hasRelatedResearch).toBe(true);
    expect(score.dimensions.hasDoneWhen).toBe(true);
    expect(score.dimensions.isSpecific).toBe(true);
    expect(score.suggestions).toHaveLength(0);
  });

  it('scores a completely bare task near 0.0', () => {
    const score = scoreTask({
      display_id: 'VNM-99.01',
      title: 'Fix bug',
    });

    expect(score.overall).toBe(0);
    expect(score.dimensions.hasDescription).toBe(false);
    expect(score.dimensions.hasDependencies).toBe(false);
    expect(score.dimensions.hasRelatedResearch).toBe(false);
    expect(score.dimensions.hasDoneWhen).toBe(false);
    expect(score.dimensions.isSpecific).toBe(false);
    expect(score.suggestions.length).toBeGreaterThan(0);
  });

  it('detects vague title with short description', () => {
    const score = scoreTask({
      display_id: 'VNM-01.02',
      title: 'Improve error handling',
      description: 'Make it better',
    });

    expect(score.dimensions.isSpecific).toBe(false);
    expect(score.suggestions).toContainEqual(expect.stringContaining('vague'));
  });

  it('recognizes specific title even without long description', () => {
    const score = scoreTask({
      display_id: 'VNM-01.03',
      title: 'Add `readSessionTranscript` to discovery.ts',
    });

    expect(score.dimensions.isSpecific).toBe(true);
  });

  it('recognizes PascalCase component references as specific', () => {
    const score = scoreTask({
      display_id: 'VNM-01.04',
      title: 'Build TaskReadinessCard component',
    });

    expect(score.dimensions.isSpecific).toBe(true);
  });

  it('detects research references in description', () => {
    const score = scoreTask({
      display_id: 'VNM-01.05',
      title: 'Implement inbox',
      description:
        'Build unified inbox. See synthesis-human-in-the-loop-ui-patterns.md for design.',
    });

    expect(score.dimensions.hasRelatedResearch).toBe(true);
  });

  it('credits done_when as hasDoneWhen', () => {
    const score = scoreTask({
      display_id: 'VNM-01.06',
      title: 'Add bounds checker',
      done_when: 'All bounds are enforced and tested',
    });

    expect(score.dimensions.hasDoneWhen).toBe(true);
  });

  it('credits acceptance_criteria as hasDoneWhen', () => {
    const score = scoreTask({
      display_id: 'VNM-01.07',
      title: 'Add bounds checker',
      acceptance_criteria: ['Bounds are enforced', 'Tests pass'],
    });

    expect(score.dimensions.hasDoneWhen).toBe(true);
  });

  it('penalizes missing done-when with a suggestion', () => {
    const score = scoreTask({
      display_id: 'VNM-01.08',
      title: 'Build the feature',
      description: 'A sufficiently detailed description that exceeds the minimum length threshold.',
    });

    expect(score.dimensions.hasDoneWhen).toBe(false);
    expect(score.suggestions).toContainEqual(expect.stringContaining('done-when'));
  });

  it('weights sum to 1.0', () => {
    // Verify the scoring is normalized by checking a task with all dimensions true
    const score = scoreTask({
      display_id: 'VNM-01.09',
      title: 'Implement SessionReviewLoop orchestrator in engine/review-loop.ts',
      description:
        'Build the main orchestrator loop. Research shows dispatch daemon pattern is optimal. Ref: Stoneforge analysis.',
      depends_on: ['VNM-45.01'],
      done_when: 'Loop processes all uncommitted sessions',
    });

    expect(score.overall).toBe(1.0);
  });

  it('produces correct partial score with some dimensions', () => {
    const score = scoreTask({
      display_id: 'VNM-01.10',
      title: 'Add SessionReviewLoop',
      description: 'A long enough description to pass the minimum length check for readiness.',
      depends_on: ['VNM-45.01'],
    });

    // hasDescription (0.25) + hasDependencies (0.1) + isSpecific (0.4) = 0.75
    expect(score.dimensions.hasDescription).toBe(true);
    expect(score.dimensions.hasDependencies).toBe(true);
    expect(score.dimensions.hasRelatedResearch).toBe(false);
    expect(score.dimensions.hasDoneWhen).toBe(false);
    expect(score.dimensions.isSpecific).toBe(true);
    expect(score.overall).toBeCloseTo(0.75);
  });

  it('detects file extension references as specific', () => {
    const score = scoreTask({
      display_id: 'VNM-01.11',
      title: 'Fix parser.py crash',
    });

    expect(score.dimensions.isSpecific).toBe(true);
  });

  it('detects structured content markers as specific', () => {
    const score = scoreTask({
      display_id: 'VNM-01.12',
      title: 'Session review: extract → score → store',
    });

    expect(score.dimensions.isSpecific).toBe(true);
  });
});
