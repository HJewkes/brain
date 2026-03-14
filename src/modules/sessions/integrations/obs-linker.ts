import type { WorkflowObservation } from './workflow-obs.js';
import type { SessionMetadata } from '../types.js';
import { projectDirHash } from '../utils.js';

export function matchObservationsToSession(
  observations: WorkflowObservation[],
  session: SessionMetadata
): WorkflowObservation[] {
  const sessionHash = projectDirHash(session.project_dir);

  return observations.filter((obs) => {
    // Time range match
    if (obs.date < session.started_at) return false;
    if (session.completed_at && obs.date > session.completed_at) return false;

    // Project dir match (if observation has project field)
    if (obs.project) {
      const obsHash = projectDirHash(obs.project);
      if (obsHash !== sessionHash) return false;
    }

    return true;
  });
}

export function formatObservationsMarkdown(observations: WorkflowObservation[]): string {
  if (observations.length === 0) return '';

  const lines: string[] = ['# Workflow Observations', ''];
  for (const obs of observations) {
    lines.push(`## ${obs.category}`);
    lines.push(`- **Date**: ${obs.date}`);
    lines.push(`- **Description**: ${obs.description}`);
    if (obs.source) lines.push(`- **Source**: ${obs.source}`);
    if (obs.impact) lines.push(`- **Impact**: ${obs.impact}`);
    lines.push('');
  }

  return lines.join('\n');
}
