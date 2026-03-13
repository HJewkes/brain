import { createHash } from 'node:crypto';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function trimToTokens(text: string, budget: number): string {
  const charBudget = budget * 4;
  if (text.length <= charBudget) return text;
  return text.slice(0, charBudget) + '\n...[truncated]';
}

export function projectDirHash(projectDir: string): string {
  return projectDir.replace(/\//g, '-').replace(/^-/, '');
}

export function parseSinceDate(str: string): Date {
  // ISO date
  const iso = new Date(str);
  if (!isNaN(iso.getTime())) return iso;

  // Relative: 7d, 30d, 3mo, 1h, 30m
  const match = str.match(/^(\d+)(m|h|d|mo)$/);
  if (!match) return new Date(0);

  const amount = parseInt(match[1], 10);
  const unit = match[2];
  const now = new Date();

  switch (unit) {
    case 'm':
      return new Date(now.getTime() - amount * 60_000);
    case 'h':
      return new Date(now.getTime() - amount * 3_600_000);
    case 'd':
      return new Date(now.getTime() - amount * 86_400_000);
    case 'mo':
      now.setMonth(now.getMonth() - amount);
      return now;
    default:
      return new Date(0);
  }
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

export function sessionFileHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
