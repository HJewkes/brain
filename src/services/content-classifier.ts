import type { ContentClass } from '../types.js';

export interface ClassifiedSection {
  content: string;
  contentClass: ContentClass;
  confidence: number;
  method: 'deterministic' | 'llm' | 'embedding';
  heading: string | null;
}

const TASK_TABLE_COLUMNS = ['status', 'priority', 'assignee', 'due', 'estimate', 'owner'];

const BUG_PATTERNS = [
  /steps?\s+to\s+reproduce/i,
  /expected\s+behavio/i,
  /actual\s+behavio/i,
  /severity/i,
  /bug\s*bash/i,
];

const ARCH_HEADINGS = /\b(architecture|system\s+design|data\s+flow|component|infrastructure)\b/i;
const ARCH_CONTENT = /\b(scalab|microservice|endpoint|pipeline|queue|layer|deploy)/i;

const REQ_HEADINGS = /\b(requirements?|prd|user\s+stor|acceptance\s+criteria)\b/i;
const REQ_CONTENT = /\b(must|shall|should)\b/i;

const MEETING_PATTERNS = [/attendees?:/i, /agenda:/i, /action\s+items?:/i, /discussed:/i];

function extractTableHeaders(text: string): string[] | null {
  const lines = text.split('\n');
  const headerLine = lines.find((l) => /^\|.+\|/.test(l));
  if (!headerLine) return null;
  const sepIdx = lines.indexOf(headerLine) + 1;
  if (sepIdx >= lines.length || !/^\|[\s-:|]+\|/.test(lines[sepIdx])) return null;
  return headerLine
    .split('|')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

function countTableRows(text: string): number {
  return text.split('\n').filter((l) => /^\|.+\|/.test(l)).length - 2;
}

export function classifySection(text: string, heading: string | null): ClassifiedSection {
  const base = { content: text, heading, method: 'deterministic' as const };

  // Task-list: table with task columns
  const headers = extractTableHeaders(text);
  if (headers) {
    const taskHits = headers.filter((h) => TASK_TABLE_COLUMNS.includes(h)).length;
    if (taskHits >= 2) {
      return { ...base, contentClass: 'task-list', confidence: 0.9 };
    }
  }

  // Task-list: checkbox lists
  const checkboxCount = (text.match(/^[-*]\s+\[[ x]\]/gm) || []).length;
  if (checkboxCount >= 2) {
    return { ...base, contentClass: 'task-list', confidence: 0.8 };
  }

  // Bug-report
  const bugHits = BUG_PATTERNS.filter((p) => p.test(text)).length;
  const headingBugHit = heading && /bug/i.test(heading) ? 1 : 0;
  if (bugHits + headingBugHit >= 2) {
    return { ...base, contentClass: 'bug-report', confidence: 0.85 };
  }

  // Architecture
  const archHeading = heading && ARCH_HEADINGS.test(heading);
  const archContent = ARCH_CONTENT.test(text) && (text.match(/```/g) || []).length >= 2;
  if (archHeading || archContent) {
    return { ...base, contentClass: 'architecture', confidence: archHeading ? 0.9 : 0.75 };
  }

  // Requirements
  const reqHeading = heading && REQ_HEADINGS.test(heading);
  const reqBullets = REQ_CONTENT.test(text) && /^[-*]\s+/m.test(text);
  if (reqHeading || (reqBullets && (text.match(REQ_CONTENT) || []).length >= 3)) {
    return { ...base, contentClass: 'requirements', confidence: reqHeading ? 0.9 : 0.7 };
  }

  // Meeting notes
  const meetHits = MEETING_PATTERNS.filter((p) => p.test(text)).length;
  if (meetHits >= 2) {
    return { ...base, contentClass: 'meeting-notes', confidence: 0.85 };
  }

  // Reference: large non-task table
  if (headers && headers.length >= 3 && countTableRows(text) >= 10) {
    return { ...base, contentClass: 'reference', confidence: 0.7 };
  }

  return { ...base, contentClass: 'general', confidence: 0.5 };
}
