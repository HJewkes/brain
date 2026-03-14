import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { substituteVariables, findUnfilledPlaceholders } from '../../utils/template.js';
import type { TemplateVariables } from '../../utils/template.js';

export type { TemplateVariables };

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
  const result = substituteVariables(template, variables, 'single');

  const unfilled = findUnfilledPlaceholders(result, 'single');
  if (unfilled.length > 0) {
    throw new Error(`Unfilled placeholders: ${unfilled.join(', ')}`);
  }

  return result;
}

// Re-export for backwards compatibility
export { findUnfilledPlaceholders } from '../../utils/template.js';
