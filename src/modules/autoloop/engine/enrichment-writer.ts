import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { BrainDB } from '../../../services/brain-db.js';
import type { Embedder } from '../../../types.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { getPmNotes } from '../../pm/data/queries.js';
import type { EnrichmentSuggestion } from './task-enricher.js';

/**
 * Writes enrichment suggestions back to a task's markdown body
 * by appending an "Enrichment Context" section.
 */
export async function writeEnrichmentToTask(
  db: BrainDB,
  embedder: Embedder,
  suggestion: EnrichmentSuggestion
): Promise<void> {
  const notes = getPmNotes(db, 'task', { display_id: suggestion.taskId });
  if (notes.length === 0) return;

  const note = notes[0];
  if (!existsSync(note.filePath)) return;

  let content = readFileSync(note.filePath, 'utf-8');

  // Don't re-enrich if already enriched
  if (content.includes('## Enrichment Context')) return;

  const section = buildEnrichmentSection(suggestion);
  if (!section) return;

  content = appendSection(content, section);
  writeFileSync(note.filePath, content, 'utf-8');

  const hash = createHash('sha256').update(content).digest('hex');
  await indexSingleFile(db, embedder, note.filePath, content, hash, Date.now());
}

function buildEnrichmentSection(suggestion: EnrichmentSuggestion): string | null {
  const lines: string[] = [];

  if (suggestion.relatedResearch.length > 0) {
    lines.push('### Related Research');
    for (const r of suggestion.relatedResearch) {
      lines.push(`- **${r.title}** (relevance: ${r.relevance.toFixed(2)})`);
      if (r.excerpt) {
        lines.push(`  > ${r.excerpt.slice(0, 200)}`);
      }
    }
    lines.push('');
  }

  if (suggestion.relatedMemories.length > 0) {
    lines.push('### Related Memories');
    for (const m of suggestion.relatedMemories) {
      lines.push(`- ${m}`);
    }
    lines.push('');
  }

  if (lines.length === 0) return null;

  return ['', '## Enrichment Context', '', ...lines].join('\n');
}

function appendSection(content: string, section: string): string {
  return content.trimEnd() + '\n' + section + '\n';
}
