/**
 * Replace, insert, or remove a field in YAML frontmatter.
 * Pass an empty string to remove the field entirely.
 */
export function replaceFrontmatterField(content: string, field: string, value: string): string {
  const endOfFrontmatter = content.indexOf('\n---', 4);
  if (endOfFrontmatter === -1) return content;

  const frontmatter = content.slice(0, endOfFrontmatter);
  const rest = content.slice(endOfFrontmatter);
  const fieldRegex = new RegExp(`^${field}:.*$`, 'm');

  if (fieldRegex.test(frontmatter)) {
    if (!value) {
      return frontmatter.replace(new RegExp(`\n${field}:.*$`, 'm'), '') + rest;
    }
    const quoted = quoteYamlValue(value);
    return frontmatter.replace(fieldRegex, `${field}: ${quoted}`) + rest;
  }

  if (!value) return content;
  const quoted = quoteYamlValue(value);
  return frontmatter + `\n${field}: ${quoted}` + rest;
}

function quoteYamlValue(value: string): string {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value;
  }
  if (value.includes(' ') || /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return `"${value}"`;
  }
  return value;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseIntervalDays(interval: string): number {
  const match = interval.match(/^(\d+)\s*(d|w|m)$/);
  if (!match) return 90;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 'd':
      return value;
    case 'w':
      return value * 7;
    case 'm':
      return value * 30;
    default:
      return 90;
  }
}
