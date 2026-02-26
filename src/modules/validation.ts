import type { ModuleConfigSchema } from './types.js';

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate a frontmatter object against a module's config schema.
 * Minimal hand-rolled validator supporting:
 * - required field checks
 * - type checks (string, number, boolean, array)
 * - enum checks
 */
export function validateNoteFrontmatter(
  frontmatter: Record<string, unknown>,
  schema: ModuleConfigSchema
): ValidationResult {
  const errors: ValidationError[] = [];

  if (schema.required) {
    for (const field of schema.required) {
      if (frontmatter[field] === undefined || frontmatter[field] === null) {
        errors.push({ field, message: `Required field "${field}" is missing` });
      }
    }
  }

  for (const [field, propSchema] of Object.entries(schema.properties)) {
    const value = frontmatter[field];
    if (value === undefined || value === null) continue;

    if (!checkType(value, propSchema.type)) {
      errors.push({
        field,
        message: `Field "${field}" should be type "${propSchema.type}" but got "${typeof value}"`,
      });
      continue;
    }

    if (propSchema.enum && !propSchema.enum.includes(value as string)) {
      errors.push({
        field,
        message: `Field "${field}" must be one of: ${propSchema.enum.join(', ')}`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

function checkType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && !Array.isArray(value) && value !== null;
    default:
      return true;
  }
}
