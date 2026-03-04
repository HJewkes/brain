import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { slugify } from '../../utils.js';
import type { ExtractedItem } from '../../types.js';
import type { ModuleRegistry } from '../../modules/registry.js';

export interface LowConfidenceRegion {
  startLine: number;
  endLine: number;
  suggestedType: string;
  confidence: number;
}

export interface QueueContext {
  sourcePath: string;
  format: string;
  lineCount: number;
  tier1Items: ExtractedItem[];
  tier2Items: ExtractedItem[];
  lowConfidenceRegions: LowConfidenceRegion[];
  remainderContent: string;
}

export interface QueueResult {
  queuePath: string;
  reason: string;
}

export function writeQueueFile(
  brainDir: string,
  context: QueueContext,
  registry: ModuleRegistry,
): QueueResult {
  const queueDir = join(brainDir, 'import-queue');
  mkdirSync(queueDir, { recursive: true });

  const basename = context.sourcePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'unknown';
  const slug = slugify(basename);
  const queuePath = join(queueDir, `${slug}.md`);
  const now = new Date().toISOString().slice(0, 10);

  const lines: string[] = [];

  lines.push('---');
  lines.push(`source: ${context.sourcePath}`);
  lines.push(`created: ${now}`);
  lines.push('status: pending');
  lines.push(`format: ${context.format}`);
  lines.push(`lines: ${context.lineCount}`);
  lines.push('---');
  lines.push('');

  const filename = context.sourcePath.split('/').pop() ?? 'unknown';
  lines.push(`# Import Review: ${filename}`);
  lines.push('');

  lines.push('## What We Know');
  lines.push(`- Format: ${context.format}, ${context.lineCount} lines`);

  if (context.tier1Items.length > 0) {
    const types = [...new Set(context.tier1Items.map((i) => i.noteType))];
    lines.push(`- Tier 1 extracted: ${context.tier1Items.length} items (${types.join(', ')})`);
  }

  if (context.tier2Items.length > 0) {
    const types = [...new Set(context.tier2Items.map((i) => i.noteType))];
    lines.push(`- Tier 2 extracted: ${context.tier2Items.length} items (${types.join(', ')})`);
  }

  for (const region of context.lowConfidenceRegions) {
    lines.push(
      `- Low confidence: lines ${region.startLine}-${region.endLine} (${region.suggestedType}, confidence: ${region.confidence.toFixed(2)})`,
    );
  }

  lines.push('');

  lines.push('## Available Note Types');
  const importable = registry.getImportableNoteTypes();
  for (const { noteType } of importable) {
    lines.push(`- **${noteType.name}**: ${noteType.description}`);
    if (noteType.schema?.properties) {
      const fields = Object.entries(noteType.schema.properties)
        .map(([k, v]) => `${k} (${v.description ?? v.type})`)
        .join(', ');
      lines.push(`  Fields: ${fields}`);
    }
  }
  lines.push('');

  lines.push('## Questions');
  for (const region of context.lowConfidenceRegions) {
    lines.push(
      `- Lines ${region.startLine}-${region.endLine}: suggested "${region.suggestedType}" but confidence is ${region.confidence.toFixed(2)}. Is this correct?`,
    );
  }
  if (context.remainderContent.trim()) {
    const remainderLines = context.remainderContent.split('\n').length;
    lines.push(`- ${remainderLines} lines of unclassified content. What type(s) should these be?`);
  }
  lines.push('');

  lines.push('## Instructions');
  lines.push('Review the source file and create the appropriate notes using the brain CLI.');
  lines.push(
    'For tasks, use: `brain pm task add --project <PREFIX> --workstream <N> --name "..." --description "..."`',
  );
  lines.push('For notes, use: `brain add --type <type> --title "..." <file>`');
  lines.push('');

  lines.push('## Source File');
  lines.push(`Path: \`${context.sourcePath}\``);
  lines.push('');

  writeFileSync(queuePath, lines.join('\n'), 'utf-8');

  const reason = buildReason(context);
  return { queuePath, reason };
}

function buildReason(context: QueueContext): string {
  if (context.lowConfidenceRegions.length > 0) {
    return `low confidence: ${context.lowConfidenceRegions.length} regions`;
  }
  if (context.remainderContent.trim()) {
    return `unclassified: ${context.remainderContent.split('\n').length} lines`;
  }
  return 'complex content';
}
