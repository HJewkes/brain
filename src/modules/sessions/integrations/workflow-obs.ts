import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { projectDirHash } from '../utils.js';

export interface WorkflowObservation {
  date: string;
  category: string;
  description: string;
  source: string;
  project?: string;
  impact?: string;
}

export function ingestWorkflowObservations(
  projectDir: string,
  startTime: string,
  endTime: string
): WorkflowObservation[] {
  const dirHash = projectDirHash(projectDir);
  const obsDir = join(homedir(), '.claude', 'workflow-improvement', 'observations', dirHash);
  const pendingPath = join(obsDir, 'pending.jsonl');

  if (!existsSync(pendingPath)) return [];

  const lines = readFileSync(pendingPath, 'utf-8').split('\n').filter(Boolean);
  const results: WorkflowObservation[] = [];

  for (const line of lines) {
    try {
      const obs = JSON.parse(line) as WorkflowObservation;
      if (!obs.date || !obs.description) continue;
      if (obs.date >= startTime && obs.date <= endTime) {
        results.push(obs);
      }
    } catch {
      continue;
    }
  }

  return results;
}
