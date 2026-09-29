const FRONTMATTER_OPEN = '---\n';
const FRONTMATTER_CLOSE = '\n---';

interface FrontmatterSplit {
  lines: string[];
  rest: string;
}

function splitFrontmatter(content: string): FrontmatterSplit | null {
  if (!content.startsWith(FRONTMATTER_OPEN)) return null;
  const end = content.indexOf(FRONTMATTER_CLOSE, FRONTMATTER_OPEN.length - 1);
  if (end === -1) return null;
  return {
    lines: content.slice(FRONTMATTER_OPEN.length, end).split('\n'),
    rest: content.slice(end),
  };
}

function isContinuationLine(line: string): boolean {
  return /^\s/.test(line) || /^-(\s|$)/.test(line);
}

/** Replace a top-level key and its indented continuation lines; undefined removes the key. */
export function setFrontmatterRaw(content: string, key: string, value: string | undefined): string {
  const split = splitFrontmatter(content);
  if (!split) return content;

  const { lines } = split;
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  const replacement = value === undefined ? [] : [`${key}: ${value}`];

  if (start === -1) {
    if (replacement.length === 0) return content;
    lines.push(...replacement);
  } else {
    let end = start + 1;
    while (end < lines.length && isContinuationLine(lines[end])) end++;
    lines.splice(start, end - start, ...replacement);
  }
  return FRONTMATTER_OPEN + lines.join('\n') + split.rest;
}

/** Write a string list as a flow list of JSON-quoted items; an empty list removes the key. */
export function setFrontmatterList(content: string, key: string, values: string[]): string {
  const flow = values.length === 0 ? undefined : `[${values.map(quoteYamlString).join(', ')}]`;
  return setFrontmatterRaw(content, key, flow);
}

/** A JSON string literal is a valid YAML double-quoted scalar, so quotes, colons and newlines survive. */
export function quoteYamlString(value: string): string {
  return JSON.stringify(value);
}
