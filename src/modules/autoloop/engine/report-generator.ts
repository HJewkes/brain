import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import { indexSingleFile } from '../../../services/indexing.js';
import type { AutoloopReport } from '../types.js';

export interface GeneratedReport {
  filePath: string;
  noteId: string;
}

export async function generateReportNote(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  report: AutoloopReport
): Promise<GeneratedReport> {
  const notesDir = join(config.notesDir, 'modules', 'autoloop');
  mkdirSync(notesDir, { recursive: true });

  const dateSlug = report.startedAt.slice(0, 10);
  const timeSlug = report.startedAt.slice(11, 19).replace(/:/g, '');
  const slug = `report-${report.loopType}-${dateSlug}-${timeSlug}`;
  const filePath = join(notesDir, `${slug}.md`);

  const markdown = buildReportMarkdown(report);
  writeFileSync(filePath, markdown, 'utf-8');

  const content = readFileSync(filePath, 'utf-8');
  const hash = createHash('sha256').update(content).digest('hex');
  const noteId = await indexSingleFile(db, embedder, filePath, content, hash, Date.now());

  return { filePath, noteId };
}

function buildReportMarkdown(report: AutoloopReport): string {
  const details = report.details;
  const title = `Autoloop ${formatLoopType(report.loopType)} — ${report.startedAt.slice(0, 10)}`;

  const lines = [
    '---',
    `title: "${escapeYaml(title)}"`,
    'type: autoloop-report',
    'tier: slow',
    'module: autoloop',
    'visibility: private',
    `loop_type: ${report.loopType}`,
    `status: ${report.status}`,
    `started_at: ${report.startedAt}`,
    `completed_at: ${report.completedAt}`,
    `duration_ms: ${report.durationMs}`,
    `sessions_reviewed: ${report.sessionsReviewed}`,
    `insights_extracted: ${report.insightsExtracted}`,
    `tasks_updated: ${report.tasksUpdated}`,
    `notes_created: ${report.notesCreated}`,
  ];

  if (report.terminationReason) {
    lines.push(`termination_reason: "${escapeYaml(report.terminationReason)}"`);
  }

  lines.push('---', '', `# ${title}`, '');

  lines.push('## Summary', '');
  lines.push(`- **Status:** ${report.status}`);
  lines.push(`- **Duration:** ${formatDuration(report.durationMs)}`);
  lines.push(`- **Sessions reviewed:** ${report.sessionsReviewed}`);
  lines.push(`- **Insights extracted:** ${report.insightsExtracted}`);
  lines.push(`- **Tasks updated:** ${report.tasksUpdated}`);
  lines.push(`- **Notes created:** ${report.notesCreated}`);

  if (report.terminationReason) {
    lines.push(`- **Terminated:** ${report.terminationReason}`);
  }
  lines.push('');

  if (details) {
    if (details.sessionDisplayIds.length > 0) {
      lines.push('## Sessions Reviewed', '');
      for (const id of details.sessionDisplayIds) {
        lines.push(`- ${id}`);
      }
      lines.push('');
    }

    const categories = Object.entries(details.insightsByCategory);
    if (categories.length > 0) {
      lines.push('## Insights by Category', '');
      for (const [cat, count] of categories) {
        lines.push(`- **${cat}:** ${count}`);
      }
      lines.push('');
    }

    if (details.frictionPatterns.length > 0) {
      lines.push('## Friction Patterns', '');
      for (const pattern of details.frictionPatterns) {
        lines.push(`- ${pattern}`);
      }
      lines.push('');
    }

    if (details.duplicatesFound > 0) {
      lines.push('## Duplicates Found', '');
      lines.push(`${details.duplicatesFound} duplicate pair(s) detected.`, '');
      for (const pair of details.duplicatePairs) {
        lines.push(`- ${pair.taskA} ↔ ${pair.taskB} (similarity: ${pair.similarity})`);
      }
      lines.push('');
    }

    if (details.enrichmentsSuggested > 0) {
      lines.push('## Enrichments', '');
      lines.push(`${details.enrichmentsSuggested} task(s) enriched.`, '');
      if (details.enrichedTaskIds.length > 0) {
        for (const id of details.enrichedTaskIds) {
          lines.push(`- ${id}`);
        }
        lines.push('');
      }
    }
  }

  if (report.errors.length > 0) {
    lines.push('## Errors', '');
    for (const err of report.errors) {
      lines.push(`- ${err}`);
    }
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

function formatLoopType(loopType: string): string {
  return loopType === 'session-review' ? 'Session Review' : 'Task Consolidation';
}

function formatDuration(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

function escapeYaml(text: string): string {
  return text.replace(/"/g, '\\"');
}
