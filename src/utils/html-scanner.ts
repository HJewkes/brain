export interface ScanIssue {
  severity: 'critical' | 'warning' | 'info';
  pattern: string;
  line: number;
  message: string;
  suggestion: string;
}

export interface ScanResult {
  safe: boolean;
  issues: ScanIssue[];
}

interface ScriptBlock {
  content: string;
  startLine: number;
}

const SCRIPT_RE = /<script(?:\s[^>]*)?>([^]*?)<\/script>/gi;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function extractScripts(html: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  SCRIPT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SCRIPT_RE.exec(html)) !== null) {
    blocks.push({ content: m[1], startLine: lineOf(html, m.index) });
  }
  SCRIPT_RE.lastIndex = 0;
  return blocks;
}

function issue(
  block: ScriptBlock,
  idx: number,
  severity: ScanIssue['severity'],
  pattern: string,
  message: string,
  suggestion: string
): ScanIssue {
  return {
    severity,
    pattern,
    line: block.startLine + lineOf(block.content, idx),
    message,
    suggestion,
  };
}

type Check = (block: ScriptBlock) => ScanIssue | null;

const checks: Check[] = [
  (b) => {
    const idx = b.content.indexOf('requestAnimationFrame');
    if (idx === -1) return null;
    const safe =
      /cancelAnimationFrame/.test(b.content) ||
      /document\.hidden/.test(b.content) ||
      /(?:alpha|threshold)\s*[<>]=?\s*[\d.]/.test(b.content);
    return safe
      ? null
      : issue(
          b,
          idx,
          'warning',
          'unbounded-raf',
          'requestAnimationFrame loop with no stop condition detected',
          'Add cancelAnimationFrame(), check document.hidden, or guard with an alpha/threshold comparison'
        );
  },
  (b) => {
    const idx = b.content.indexOf('setInterval');
    if (idx === -1 || /clearInterval/.test(b.content)) return null;
    return issue(
      b,
      idx,
      'warning',
      'setinterval-no-clear',
      'setInterval called without clearInterval in the same script',
      'Store the interval ID and call clearInterval() to prevent memory leaks'
    );
  },
  (b) => {
    for (const [re, label] of [
      [/while\s*\(\s*true\s*\)/g, 'while(true)'],
      [/for\s*\(\s*;\s*;\s*\)/g, 'for(;;)'],
    ] as [RegExp, string][]) {
      re.lastIndex = 0;
      const m = re.exec(b.content);
      if (m)
        return issue(
          b,
          m.index,
          'critical',
          'infinite-loop',
          `${label} infinite loop detected in script`,
          'Replace with a bounded loop or use requestAnimationFrame with a stop condition'
        );
    }
    return null;
  },
  (b) => {
    const idx = b.content.indexOf('new Worker');
    if (idx === -1 || /\.terminate\(\)/.test(b.content)) return null;
    return issue(
      b,
      idx,
      'warning',
      'worker-no-terminate',
      'new Worker() created without worker.terminate() in the same script',
      'Call worker.terminate() when the worker is no longer needed'
    );
  },
  (b) => {
    const bytes = Buffer.byteLength(b.content, 'utf8');
    if (bytes <= 500 * 1024) return null;
    return issue(
      b,
      0,
      'info',
      'large-inline-script',
      `Inline script is ${Math.round(bytes / 1024)}KB (> 500KB)`,
      'Move large scripts to external files to improve load performance'
    );
  },
];

export function scanHtmlSafety(content: string): ScanResult {
  const issues: ScanIssue[] = [];
  for (const block of extractScripts(content)) {
    for (const check of checks) {
      const found = check(block);
      if (found) issues.push(found);
    }
  }
  return { safe: issues.every((i) => i.severity === 'info'), issues };
}
