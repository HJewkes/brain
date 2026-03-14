import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TemplateVariables {
  [key: string]: string | undefined;
}

/**
 * Read a template file from templates/agents/<name>.md and fill {PLACEHOLDER} variables.
 * Returns the rendered string or throws if the template is missing or has unfilled placeholders.
 */
export function renderTemplateFile(
  projectDir: string,
  templateName: string,
  variables: TemplateVariables
): string {
  const templatePath = join(projectDir, 'templates', 'agents', `${templateName}.md`);
  if (!existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  const raw = readFileSync(templatePath, 'utf-8');
  return renderTemplate(raw, variables);
}

/**
 * Fill {PLACEHOLDER} variables in a template string.
 * Validates that no unfilled {ALLCAPS} placeholders remain.
 */
export function renderTemplate(template: string, variables: TemplateVariables): string {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    if (value === undefined) continue;
    const placeholder = `{${key}}`;
    result = result.replaceAll(placeholder, value);
  }

  const unfilled = findUnfilledPlaceholders(result);
  if (unfilled.length > 0) {
    throw new Error(`Unfilled placeholders: ${unfilled.join(', ')}`);
  }

  return result;
}

/**
 * Find {ALLCAPS_UNDERSCORE} placeholders that were not filled.
 */
export function findUnfilledPlaceholders(text: string): string[] {
  const pattern = /\{([A-Z][A-Z0-9_]*)\}/g;
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    found.add(match[0]);
  }
  return [...found].sort();
}
