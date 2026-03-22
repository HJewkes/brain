export interface TemplateVariables {
  [key: string]: string | undefined;
}

export type BraceStyle = 'single' | 'double';

/** Stateless renderer that fills a template string with variables. */
export interface PromptRenderer {
  render(variables: TemplateVariables): string;
}

/**
 * Create a PromptRenderer bound to a fixed template string.
 * Unfilled {ALLCAPS} placeholders cause an error by default.
 */
export function createPromptRenderer(
  template: string,
  braceStyle: BraceStyle = 'single'
): PromptRenderer {
  return {
    render(variables: TemplateVariables): string {
      const result = substituteVariables(template, variables, braceStyle);
      const unfilled = findUnfilledPlaceholders(result, braceStyle);
      if (unfilled.length > 0) {
        throw new Error(`Unfilled placeholders: ${unfilled.join(', ')}`);
      }
      return result;
    },
  };
}

/**
 * Substitute variables in a template string.
 * - single: {KEY} placeholders (used by agent templates)
 * - double: {{KEY}} placeholders (used by workflow templates)
 */
export function substituteVariables(
  template: string,
  variables: TemplateVariables,
  braceStyle: BraceStyle = 'single'
): string {
  let result = template;
  const [open, close] = braceStyle === 'double' ? ['{{', '}}'] : ['{', '}'];

  for (const [key, value] of Object.entries(variables)) {
    if (value === undefined) continue;
    result = result.replaceAll(`${open}${key}${close}`, value);
  }

  return result;
}

/**
 * Find unfilled {ALLCAPS_UNDERSCORE} placeholders in a template string.
 */
export function findUnfilledPlaceholders(
  text: string,
  braceStyle: BraceStyle = 'single'
): string[] {
  const pattern = braceStyle === 'double' ? /\{\{([A-Z][A-Z0-9_]*)\}\}/g : /\{([A-Z][A-Z0-9_]*)\}/g;

  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    found.add(match[0]);
  }
  return [...found].sort();
}

/**
 * Extract variable names from a template string.
 */
export function extractTemplateVariables(
  content: string,
  braceStyle: BraceStyle = 'single'
): string[] {
  const pattern = braceStyle === 'double' ? /\{\{(\w+)\}\}/g : /\{([A-Z][A-Z0-9_]*)\}/g;
  const vars = new Set<string>();
  for (const m of content.matchAll(pattern)) {
    vars.add(m[1]);
  }
  return [...vars].sort();
}
