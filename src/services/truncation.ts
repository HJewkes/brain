export interface TruncateOptions {
  maxBytes: number;
  headRatio?: number;
  separator?: string;
}

export interface TruncateResult {
  text: string;
  truncated: boolean;
  originalLines: number;
  omittedLines: number;
}

/**
 * Smart truncation: keeps first headRatio of lines and last (1-headRatio),
 * snapping to line boundaries. Inserts separator showing omission count.
 */
export function smartTruncate(input: string, options: TruncateOptions): TruncateResult {
  const { maxBytes, headRatio = 0.6 } = options;
  const lines = input.split('\n');
  const totalLines = lines.length;

  if (Buffer.byteLength(input, 'utf-8') <= maxBytes) {
    return { text: input, truncated: false, originalLines: totalLines, omittedLines: 0 };
  }

  let head = Math.max(1, Math.floor(totalLines * headRatio));
  let tail = Math.max(1, totalLines - head);

  while (head + tail >= 2) {
    const headPart = lines.slice(0, head).join('\n');
    const tailPart = lines.slice(totalLines - tail).join('\n');
    const omitted = totalLines - head - tail;
    const sep = options.separator ?? `\n--- ${omitted} lines omitted ---\n`;
    const combined = headPart + sep + tailPart;

    if (Buffer.byteLength(combined, 'utf-8') <= maxBytes) {
      return { text: combined, truncated: true, originalLines: totalLines, omittedLines: omitted };
    }

    if (head > tail) {
      head = Math.max(1, head - Math.ceil(head * 0.1));
    } else {
      tail = Math.max(1, tail - Math.ceil(tail * 0.1));
    }

    if (head === 1 && tail === 1) {
      const sep = options.separator ?? `\n--- ${totalLines - 2} lines omitted ---\n`;
      return {
        text: lines[0] + sep + lines[totalLines - 1],
        truncated: true,
        originalLines: totalLines,
        omittedLines: totalLines - 2,
      };
    }
  }

  return {
    text: lines[0],
    truncated: true,
    originalLines: totalLines,
    omittedLines: totalLines - 1,
  };
}
