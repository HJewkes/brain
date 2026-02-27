import { describe, it, expect } from 'vitest';
import { validateNoteFrontmatter } from '../../src/modules/validation.js';
import type { ModuleConfigSchema } from '../../src/modules/types.js';

const taskSchema: ModuleConfigSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['todo', 'in-progress', 'done'], description: 'Task status' },
    priority: { type: 'number', description: 'Priority level' },
    title: { type: 'string', description: 'Task title' },
    tags: { type: 'array', description: 'Tags list' },
    active: { type: 'boolean', description: 'Whether active' },
  },
  required: ['status', 'title'],
};

describe('validateNoteFrontmatter', () => {
  it('passes for valid frontmatter', () => {
    const result = validateNoteFrontmatter(
      { status: 'todo', title: 'Write tests', priority: 1 },
      taskSchema
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when a required field is missing', () => {
    const result = validateNoteFrontmatter({ title: 'No status' }, taskSchema);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('status');
    expect(result.errors[0].message).toContain('Required field');
  });

  it('reports multiple missing required fields', () => {
    const result = validateNoteFrontmatter({}, taskSchema);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain('status');
    expect(fields).toContain('title');
  });

  it('fails when type is wrong (string expected, got number)', () => {
    const result = validateNoteFrontmatter({ status: 42, title: 'Test' }, taskSchema);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.field === 'status');
    expect(err).toBeDefined();
    expect(err!.message).toContain('should be type "string"');
  });

  it('fails on enum violation', () => {
    const result = validateNoteFrontmatter({ status: 'invalid', title: 'Test' }, taskSchema);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.field === 'status');
    expect(err!.message).toContain('must be one of');
  });

  it('ignores unknown fields', () => {
    const result = validateNoteFrontmatter(
      { status: 'todo', title: 'Test', extra: 'stuff', another: 123 },
      taskSchema
    );
    expect(result.valid).toBe(true);
  });

  it('validates everything with an empty schema', () => {
    const emptySchema: ModuleConfigSchema = { type: 'object', properties: {} };
    const result = validateNoteFrontmatter({ anything: 'goes' }, emptySchema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('skips type checking for null/undefined values', () => {
    const result = validateNoteFrontmatter(
      { status: 'todo', title: 'Test', priority: null },
      taskSchema
    );
    expect(result.valid).toBe(true);
  });

  it('validates array type correctly', () => {
    const valid = validateNoteFrontmatter(
      { status: 'todo', title: 'Test', tags: ['a', 'b'] },
      taskSchema
    );
    expect(valid.valid).toBe(true);

    const invalid = validateNoteFrontmatter(
      { status: 'todo', title: 'Test', tags: 'not-array' },
      taskSchema
    );
    expect(invalid.valid).toBe(false);
    expect(invalid.errors[0].field).toBe('tags');
  });

  it('validates boolean type correctly', () => {
    const valid = validateNoteFrontmatter(
      { status: 'todo', title: 'Test', active: true },
      taskSchema
    );
    expect(valid.valid).toBe(true);

    const invalid = validateNoteFrontmatter(
      { status: 'todo', title: 'Test', active: 'yes' },
      taskSchema
    );
    expect(invalid.valid).toBe(false);
    expect(invalid.errors[0].field).toBe('active');
  });

  it('validates object type correctly', () => {
    const schema: ModuleConfigSchema = {
      type: 'object',
      properties: { meta: { type: 'object', description: 'Metadata' } },
    };
    expect(validateNoteFrontmatter({ meta: { a: 1 } }, schema).valid).toBe(true);
    expect(validateNoteFrontmatter({ meta: [1, 2] }, schema).valid).toBe(false);
    expect(validateNoteFrontmatter({ meta: 'string' }, schema).valid).toBe(false);
  });

  it('passes unknown schema types for forward compatibility', () => {
    const schema: ModuleConfigSchema = {
      type: 'object',
      properties: { data: { type: 'customType' as string, description: 'Future type' } },
    };
    const result = validateNoteFrontmatter({ data: 'anything' }, schema);
    expect(result.valid).toBe(true);
  });

  it('reports combined required, type, and enum errors', () => {
    const result = validateNoteFrontmatter({ status: 123, priority: 'not-a-number' }, taskSchema);
    expect(result.valid).toBe(false);
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain('title');
    expect(fields).toContain('status');
    expect(fields).toContain('priority');
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
