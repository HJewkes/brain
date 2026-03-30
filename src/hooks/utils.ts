import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export function findBrainBinary(): string | null {
  const candidates = ['/opt/homebrew/bin/brain', '/usr/local/bin/brain'];
  try {
    const which = execFileSync('which', ['brain'], { encoding: 'utf-8', timeout: 1000 }).trim();
    if (which) candidates.unshift(which);
  } catch {
    // brain not in PATH
  }
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}
