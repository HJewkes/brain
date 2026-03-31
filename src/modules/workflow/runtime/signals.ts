/**
 * Signal parsing from agent output.
 *
 * Extracts structured condition signals (needs_revision, has_open_questions)
 * from agent output text. Used by WorkflowContext.dispatch() to populate
 * StepResult.signal.
 */

type SignalMatcher = (content: string) => boolean;

const CONDITION_PATTERNS: Record<string, SignalMatcher> = {
  needs_revision: (content) => /##\s*Verdict:\s*NEEDS\s+REVISION/i.test(content),
  has_open_questions: (content) => {
    const match = content.match(/##\s*Open\s+Questions\s*\n([\s\S]*?)(?=\n##\s|\n$|$)/i);
    if (!match) return false;
    const section = match[1].trim();
    return section.length > 0 && section !== '(none)' && section !== 'None';
  },
};

/**
 * Parse condition signals from agent output text.
 * Returns the first matching signal name, or null if no patterns match.
 */
export function parseSignals(
  _stepId: string,
  _workflowName: string,
  output: string | undefined
): string | null {
  if (!output) return null;

  for (const [signal, matcher] of Object.entries(CONDITION_PATTERNS)) {
    if (matcher(output)) return signal;
  }

  return null;
}

/** Register a custom signal pattern (for extensibility). */
export function registerSignalPattern(name: string, matcher: SignalMatcher): void {
  CONDITION_PATTERNS[name] = matcher;
}
