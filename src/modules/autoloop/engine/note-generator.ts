import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import { indexSingleFile } from '../../../services/indexing.js';
import type { AutoloopInsight, AutoloopCounters } from '../types.js';
import type { InsightSet } from './insight-extractor.js';

export interface GeneratedNote {
  filePath: string;
  noteId: string;
  insightTitle: string;
}

/**
 * Convert extracted insights into brain notes.
 * Maps insight categories to appropriate note types:
 * - pattern/decision/learning -> research notes (autoloop-insight type)
 * - friction -> research notes tagged for workflow observation
 * - improvement -> research notes tagged as actionable
 */
export async function generateInsightNotes(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  insightSets: InsightSet[],
  counters: AutoloopCounters
): Promise<GeneratedNote[]> {
  const generated: GeneratedNote[] = [];
  const notesDir = join(config.notesDir, 'modules', 'autoloop');
  mkdirSync(notesDir, { recursive: true });

  for (const set of insightSets) {
    for (const insight of set.insights) {
      if (insight.confidence < 0.6) continue;

      const slug = slugify(insight.title);
      const fileName = `${slug}.md`;
      const filePath = join(notesDir, fileName);

      const markdown = buildInsightMarkdown(insight, set);
      writeFileSync(filePath, markdown, 'utf-8');

      const content = readFileSync(filePath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');
      const noteId = await indexSingleFile(db, embedder, filePath, content, hash, Date.now());

      generated.push({
        filePath,
        noteId,
        insightTitle: insight.title,
      });
      counters.notesCreated++;

      // Link insight to source sessions
      for (const sessionDisplayId of insight.sourceSessionDisplayIds) {
        linkInsightToSession(db, noteId, sessionDisplayId);
      }
    }
  }

  return generated;
}

function buildInsightMarkdown(insight: AutoloopInsight, set: InsightSet): string {
  const now = new Date().toISOString().slice(0, 10);
  const sessionRefs = insight.sourceSessionDisplayIds.join(', ');

  const lines = [
    '---',
    `title: "${escapeYaml(insight.title)}"`,
    'type: autoloop-insight',
    'tier: slow',
    'module: autoloop',
    'visibility: private',
    `category: ${insight.category}`,
    `confidence: ${insight.confidence}`,
    `source_sessions: [${sessionRefs}]`,
    `source_session_count: ${insight.sourceSessionIds.length}`,
    `created: ${now}`,
    '---',
    '',
    `# ${insight.title}`,
    '',
    insight.content,
    '',
    `**Category:** ${insight.category}`,
    `**Confidence:** ${(insight.confidence * 100).toFixed(0)}%`,
    `**Source sessions:** ${sessionRefs}`,
  ];

  return lines.join('\n') + '\n';
}

function linkInsightToSession(
  db: BrainDB,
  insightNoteId: string,
  sessionDisplayId: string
): void {
  try {
    const sessionNotes = db.getModuleNoteIds({
      module: 'sessions',
      type: 'session',
    });

    for (const noteId of sessionNotes) {
      const note = db.getNoteById(noteId);
      if (!note?.metadata) continue;

      const meta = JSON.parse(note.metadata) as Record<string, unknown>;
      if (meta.display_id === sessionDisplayId) {
        db.upsertRelations(insightNoteId, [
          { sourceId: insightNoteId, targetId: noteId, type: 'insight-from' },
        ]);
        break;
      }
    }
  } catch {
    // Best-effort linking
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function escapeYaml(text: string): string {
  return text.replace(/"/g, '\\"');
}
