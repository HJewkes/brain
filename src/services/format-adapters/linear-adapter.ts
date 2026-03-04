const LINEAR_REQUIRED = new Set(['title', 'status']);
const LINEAR_COLUMNS = new Set([
  'title',
  'status',
  'priority',
  'assignee',
  'project',
  'labels',
  'estimate',
]);

export function isLinearCsv(headers: string[]): boolean {
  const lower = headers.map((h) => h.toLowerCase());
  const matches = lower.filter((h) => LINEAR_COLUMNS.has(h));
  return matches.length >= 3 && [...LINEAR_REQUIRED].every((r) => lower.includes(r));
}

export interface LinearTaskRecord {
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: string;
  assignee: string;
}

export function mapLinearPriority(value: string): 'critical' | 'high' | 'medium' | 'low' {
  const lower = value.toLowerCase();
  if (lower === 'urgent') return 'critical';
  if (lower === 'high') return 'high';
  if (lower === 'low') return 'low';
  if (lower === 'medium') return 'medium';
  return 'medium';
}

export function mapLinearStatus(value: string): string {
  const lower = value.toLowerCase();
  if (lower === 'todo' || lower === 'backlog' || lower === 'triage') return 'pending';
  if (lower === 'in progress') return 'in-progress';
  if (lower === 'done' || lower === 'completed') return 'done';
  if (lower === 'cancelled' || lower === 'canceled') return 'cancelled';
  return lower;
}

export function linearCsvToTaskNotes(parsed: {
  headers: string[];
  rows: string[][];
}): LinearTaskRecord[] {
  const headerMap = new Map<string, number>();
  for (let i = 0; i < parsed.headers.length; i++) {
    headerMap.set(parsed.headers[i].toLowerCase(), i);
  }

  const get = (row: string[], field: string): string => {
    const idx = headerMap.get(field);
    return idx !== undefined ? (row[idx] ?? '') : '';
  };

  return parsed.rows.map((row) => ({
    title: get(row, 'title'),
    description: get(row, 'description'),
    priority: mapLinearPriority(get(row, 'priority')),
    status: mapLinearStatus(get(row, 'status')),
    assignee: get(row, 'assignee'),
  }));
}
