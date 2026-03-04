# Task 09: Tier 3 — Agent Queue

## Architectural Context

Tier 3 is the fallback for content that neither Tier 1 (deterministic) nor Tier 2 (local LLM) could confidently classify. Instead of guessing, it writes a self-contained prompt file to `.brain/import-queue/` that includes the source file path, what the previous tiers already discovered, the available note types, and specific questions for a human or Claude Code agent to resolve.

The import command also gets a `--process-queue` flag that lists pending queue items for processing.

## File Ownership

**May modify:**
- `src/services/extraction-tiers/agent-queue.ts` (new file)
- `src/services/extraction-pipeline.ts` (add Tier 3 call)
- `__tests__/services/extraction-tiers/agent-queue.test.ts` (new file)

**Must not touch:**
- `src/commands/import.ts` (Task 7 — but `--process-queue` is handled here, see note)
- `src/services/ollama.ts`

**Read for context (do not modify):**
- `src/services/extraction-pipeline.ts` — pipeline orchestrator to wire into
- `src/modules/registry.ts` — `getImportableNoteTypes()` for the queue file content

## Steps

### Step 1: Create agent queue module

Create `src/services/extraction-tiers/agent-queue.ts`:

```typescript
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { slugify } from '../../utils.js';
import type { ExtractedItem } from '../../types.js';
import type { ModuleRegistry } from '../../modules/registry.js';

export interface QueueContext {
  sourcePath: string;
  format: string;
  lineCount: number;
  tier1Items: ExtractedItem[];
  tier2Items: ExtractedItem[];
  lowConfidenceRegions: Array<{ startLine: number; endLine: number; suggestedType: string; confidence: number }>;
  remainderContent: string;
}

export interface QueueResult {
  queuePath: string;
  reason: string;
}

export function writeQueueFile(
  brainDir: string,
  context: QueueContext,
  registry: ModuleRegistry
): QueueResult {
  const queueDir = join(brainDir, 'import-queue');
  mkdirSync(queueDir, { recursive: true });

  const slug = slugify(context.sourcePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'unknown');
  const queuePath = join(queueDir, `${slug}.md`);
  const now = new Date().toISOString().slice(0, 10);

  // Build the queue file content
  const lines: string[] = [];

  // Frontmatter
  lines.push('---');
  lines.push(`source: ${context.sourcePath}`);
  lines.push(`created: ${now}`);
  lines.push('status: pending');
  lines.push(`format: ${context.format}`);
  lines.push(`lines: ${context.lineCount}`);
  lines.push('---');
  lines.push('');

  // Header
  const filename = context.sourcePath.split('/').pop() ?? 'unknown';
  lines.push(`# Import Review: ${filename}`);
  lines.push('');

  // What we know
  lines.push('## What We Know');
  lines.push(`- Format: ${context.format}, ${context.lineCount} lines`);

  if (context.tier1Items.length > 0) {
    const types = [...new Set(context.tier1Items.map(i => i.noteType))];
    lines.push(`- Tier 1 extracted: ${context.tier1Items.length} items (${types.join(', ')})`);
  }

  if (context.tier2Items.length > 0) {
    const types = [...new Set(context.tier2Items.map(i => i.noteType))];
    lines.push(`- Tier 2 extracted: ${context.tier2Items.length} items (${types.join(', ')})`);
  }

  if (context.lowConfidenceRegions.length > 0) {
    for (const region of context.lowConfidenceRegions) {
      lines.push(`- Low confidence: lines ${region.startLine}-${region.endLine} (${region.suggestedType}, confidence: ${region.confidence.toFixed(2)})`);
    }
  }

  lines.push('');

  // Available note types
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

  // Questions
  lines.push('## Questions');
  if (context.lowConfidenceRegions.length > 0) {
    for (const region of context.lowConfidenceRegions) {
      lines.push(`- Lines ${region.startLine}-${region.endLine}: suggested "${region.suggestedType}" but confidence is ${region.confidence.toFixed(2)}. Is this correct?`);
    }
  }
  if (context.remainderContent.trim()) {
    const remainderLines = context.remainderContent.split('\n').length;
    lines.push(`- ${remainderLines} lines of unclassified content. What type(s) should these be?`);
  }
  lines.push('');

  // Instructions
  lines.push('## Instructions');
  lines.push('Review the source file and create the appropriate notes using the brain CLI.');
  lines.push('For tasks, use: `brain pm task add --project <PREFIX> --workstream <N> --name "..." --description "..."`');
  lines.push('For notes, use: `brain add --type <type> --title "..." <file>`');
  lines.push('');

  // Source
  lines.push('## Source File');
  lines.push(`Path: \`${context.sourcePath}\``);
  lines.push('');

  writeFileSync(queuePath, lines.join('\n'), 'utf-8');

  const reason = context.lowConfidenceRegions.length > 0
    ? `low confidence: ${context.lowConfidenceRegions.length} regions`
    : context.remainderContent.trim()
      ? `unclassified: ${context.remainderContent.split('\n').length} lines`
      : 'complex content';

  return { queuePath, reason };
}
```

### Step 2: Wire into extraction pipeline

In `src/services/extraction-pipeline.ts`, add Tier 3 handling: when Tier 2 returns low-confidence items or remainder, call `writeQueueFile()` and add to `queuedFiles` in the result. The pipeline needs `BrainConfig.notesDir` to know where `.brain/import-queue/` goes (use the notes directory parent or a configurable path).

### Step 3: Write tests

Create `__tests__/services/extraction-tiers/agent-queue.test.ts`:

Test:
- Queue file is written with correct frontmatter
- Low confidence regions are listed in "What We Know"
- Available note types are included from registry
- Questions section generated for unclassified content
- File slug is correctly generated
- Queue directory is created if it doesn't exist

### Step 4: Run tests

Run: `npm test -- __tests__/services/extraction-tiers/agent-queue.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/services/extraction-tiers/agent-queue.ts src/services/extraction-pipeline.ts __tests__/services/extraction-tiers/agent-queue.test.ts
git commit -m "feat: add Tier 3 agent queue for complex import documents"
```

## Success Criteria

- [ ] Tests pass: `npm test -- __tests__/services/extraction-tiers/agent-queue.test.ts`
- [ ] Types check: `npm run typecheck`
- [ ] Queue files written to `.brain/import-queue/` with valid frontmatter
- [ ] Queue file includes: what was already extracted, low-confidence regions, questions, available types
- [ ] Queue directory auto-created
- [ ] Source file path included for reference

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT include the full source content in the queue file — just the path. The agent can read it.
- Do NOT implement `--process-queue` in the import command — that's a follow-up task
