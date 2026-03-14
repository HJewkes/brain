import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Result } from '../../../errors.js';
import { ok, fail } from '../../../errors.js';
import { substituteVariables, extractTemplateVariables } from '../../../utils/template.js';

function findTemplatesDir(): string {
  // Source layout: engine/templates.ts -> ../templates/
  const sourceDir = join(import.meta.dirname, '..', 'templates');
  if (existsSync(sourceDir) && existsSync(join(sourceDir, 'implementation-compact.md'))) {
    return sourceDir;
  }

  // Bundled layout: dist/*.js -> templates/
  const bundledDir = join(import.meta.dirname, 'templates');
  if (existsSync(bundledDir) && existsSync(join(bundledDir, 'implementation-compact.md'))) {
    return bundledDir;
  }

  return sourceDir;
}

const TEMPLATES_DIR = findTemplatesDir();

export interface TemplateInfo {
  name: string;
  content: string;
  variables: string[];
}

/**
 * Resolve a template by name. Accepts "implementation-compact" or "implementation-compact.md".
 */
export function resolveTemplate(templateName: string): Result<TemplateInfo> {
  const normalized = templateName.endsWith('.md') ? templateName : `${templateName}.md`;
  const filePath = join(TEMPLATES_DIR, normalized);

  if (!existsSync(filePath)) {
    const available = listTemplateNames();
    return fail(
      'NOT_FOUND',
      `Template "${templateName}" not found. Available: ${available.join(', ')}`
    );
  }

  const content = readFileSync(filePath, 'utf-8');
  const variables = extractVariables(content);
  const name = basename(normalized, '.md');

  return ok({ name, content, variables });
}

/**
 * List all available template names (without .md extension).
 */
export function listTemplateNames(): string[] {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => basename(f, '.md'))
    .sort();
}

/**
 * List all templates with their metadata.
 */
export function listTemplates(): TemplateInfo[] {
  return listTemplateNames().map((name) => {
    const result = resolveTemplate(name);
    if (!result.ok) return { name, content: '', variables: [] };
    return result.data;
  });
}

/**
 * Extract {{VARIABLE_NAME}} placeholders from template content.
 * Returns unique variable names sorted alphabetically.
 */
export function extractVariables(content: string): string[] {
  return extractTemplateVariables(content, 'double');
}

/**
 * Render a template by substituting variables.
 * Variables not in the params are left as-is (unfilled placeholders).
 */
export function renderTemplate(
  templateName: string,
  params: Record<string, string>
): Result<string> {
  const resolved = resolveTemplate(templateName);
  if (!resolved.ok) return resolved;

  const rendered = substituteVariables(resolved.data.content, params, 'double');
  return ok(rendered);
}
