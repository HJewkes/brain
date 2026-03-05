# Smart Import Pipeline v2

**Date:** 2026-03-04
**Status:** Draft
**Goal:** Make `brain import ~/my-notes` handle a non-technical user's directory of mixed content — meeting notes, project docs, to-do spreadsheets — and route task-like content into properly structured PM tasks, with minimal user intervention.

## Problem

The current import pipeline has several gaps that prevent end-to-end onboarding:

1. **PmContentHandler creates orphan notes, not PM tasks.** It writes notes with `module: pm` frontmatter but doesn't call `createTask()` — no display IDs, no workstream assignment, invisible to `pm task list`.
2. **Classification is hardcoded in core brain.** The `ContentClass` enum and all detection logic live in `src/types.ts` and `src/services/content-classifier.ts`. Modules can only claim classes, not define them.
3. **Pure task files don't split.** A CSV that's entirely tasks has only one content class, doesn't meet the "2+ distinct classes" threshold, and returns zero derived notes. The content handler never fires.
4. **Checkbox task lists fail silently.** Classified as `task-list` but `parseTable()` only handles pipe tables.
5. **No project auto-creation.** PmContentHandler requires a pre-existing active PM project.
6. **The prompt is too complex.** Users shouldn't need to know about `npx tsx src/cli.ts`, JSON schemas, or multi-step workflows.

## Design Principles

- **Note types are the vocabulary.** Classification maps content to registered note types, not an intermediate content class enum.
- **LLM plans, deterministic code executes.** The LLM identifies what's in a document and how to map it. Bulk data processing (iterating rows, writing files) is deterministic.
- **Graceful degradation.** Three tiers: deterministic → local LLM → agent queue. Each tier handles what it can and passes the rest up.
- **Modules own their types.** Core brain provides the extraction framework. Modules register note types with enough metadata for the classifier to work.

## Architecture

### 1. Note Type Registration as Classification Vocabulary

The `ContentClass` type and `content-classifier.ts` deterministic rules are replaced by module-registered note types. Each `ModuleNoteType` gains an optional `importHints` field:

```ts
interface ModuleNoteType {
  name: string;
  description: string;
  tier: 'slow' | 'fast';
  schema?: ModuleConfigSchema;
  // NEW
  importHints?: {
    tableColumnAliases?: Record<string, string[]>;
    archetypeText?: string;
  };
}
```

- `tableColumnAliases` maps schema fields to common column name variants. Example: the PM task type maps `priority` → `['priority', 'urgency', 'p', 'pri']`. This powers Tier 1 deterministic CSV matching.
- `archetypeText` replaces the hardcoded `ARCHETYPE_TEXTS` in `content-archetypes.ts`. Used for embedding-based similarity in Tier 1.

### 2. Content Handler Interface Changes

Handlers claim note types (not content classes) and receive batches of extracted items:

```ts
interface ContentHandler {
  noteTypes: string[];
  canHandle(noteType: string, content: string): boolean;
  materialize(
    db: BrainDB,
    embedder: Embedder,
    items: ExtractedItem[],
    sourceNoteId: string
  ): Promise<string[]>;
}

interface ExtractedItem {
  noteType: string;
  title: string;
  content: string;
  fields: Record<string, string>;
  sourceRegion?: { startLine: number; endLine: number };
}
```

### 3. Three-Tier Extraction Pipeline

Each file runs through tiers in order. Items resolved at lower tiers skip higher ones.

#### Tier 1: Deterministic (no LLM required)

Handles obvious cases:

| Pattern | Detection | Action |
|---------|-----------|--------|
| CSV/table with matching columns | Extract headers, match against `tableColumnAliases` from all registered types. 2+ hits → match. | Iterate all rows, map columns to schema fields, emit `ExtractedItem[]` |
| Markdown with existing frontmatter | `type` field matches a registered note type | Ingest directly, no classification |
| Single-section clean doc | Embedding similarity ≥ 0.85 against a registered `archetypeText` | Classify as that type |

Produces: `ExtractedItem[]` for resolved items, plus `remainder` content that wasn't claimed.

#### Tier 2: Local LLM (Ollama, qwen2.5:3b)

For documents Tier 1 couldn't fully resolve. Sends a structured prompt:

```
You are classifying content for a knowledge base. Available note types:

[For each registered type with importHints or description:]
- {name}: {description}
  Fields: {schema property names + descriptions}

Document "{filename}":
---
{For tables: headers + 3-5 sample rows, row count}
{For prose: full content if <4K tokens, else first 2K + last 1K + "[...N lines truncated...]"}
---

Identify all distinct content regions. For each, output JSON:
[
  {
    "type": "note-type-name",
    "title": "Suggested title",
    "startLine": N,
    "endLine": N,
    "fields": { "schemaField": "value", ... },
    "confidence": 0.0-1.0,
    "columnMapping": { "csvColumn": "schemaField" }  // tables only
  }
]

For ambiguous regions, set confidence < 0.6.
```

Items with confidence ≥ 0.6 become `ExtractedItem[]`. Items below 0.6 go to Tier 3.

#### Tier 3: Agent Queue

Complex, long, or ambiguous content gets a prompt file written to `.brain/import-queue/<slug>.md`:

```markdown
---
source: /path/to/original/file.md
created: 2026-03-04
status: pending
format: markdown
lines: 847
---

# Import Review: quarterly-planning.md

## What We Know
- Format: markdown, 847 lines
- Tier 1 extracted: 1 task table (rows 220-280, 15 tasks)
- Tier 2 found: 2 meeting note sections (confidence: 0.55, below threshold)
- Unclassified: lines 1-219, lines 281-847

## Available Note Types
[registered types with descriptions and schemas]

## Questions
- Lines 1-219: project overview — should this be a `note` or a `project`?
- Lines 281-500: requirements language mixed with task items — split into `research` + individual `task` items?
- Lines 500-847: 3 date-headed sections resembling meetings — create as separate `meeting` notes?

## Instructions
Review the source file and create the appropriate notes using the brain CLI.
For tasks, use: brain pm task create ...
For notes, use: brain add ...

## Source File
Path: /path/to/original/file.md
```

### 4. PM Module Content Handler Upgrade

`PmContentHandler` changes:

- Claims `noteTypes: ['task']` (was `contentClasses: ['task-list']`)
- Receives `ExtractedItem[]` with pre-mapped fields from the extraction pipeline
- **Auto-creates project:** If no active PM project exists, creates one. Name from the import source directory name, prefix from first 4 uppercase chars.
- **Auto-creates workstream:** Creates a default "Imported" workstream for the new project.
- **Creates real PM tasks:** Calls `createTask()` for each item, producing display IDs (`PROJ-01.01`, etc.), proper status, priority, mode, category fields.
- Maps incoming fields: `status` → PM task status (with sensible defaults), `priority` → PM priority, `description` → task body, `due` / `due_date` → due date, `assignee` → stored in body.

Registration in PM module:

```ts
ctx.registerNoteType({
  name: 'task',
  description: 'Actionable work item with status, priority, and ownership',
  tier: 'slow',
  schema: { /* existing schema */ },
  importHints: {
    tableColumnAliases: {
      name: ['title', 'name', 'task', 'item', 'summary'],
      status: ['status', 'state', 'stage'],
      priority: ['priority', 'urgency', 'p', 'pri', 'importance'],
      description: ['description', 'details', 'notes', 'body', 'content'],
      due_date: ['due', 'due_date', 'deadline', 'target_date'],
      category: ['category', 'type', 'kind', 'area'],
    },
    archetypeText: 'A list of actionable work items with status, priority, or ownership. Includes to-do lists, sprint backlogs, checkbox checklists, task tables, and action items from meetings.',
  },
});
```

### 5. Knowledge Module

New built-in module at `src/modules/knowledge/` that registers core brain note types with import metadata:

| Type | Description | Table Column Aliases |
|------|-------------|---------------------|
| `note` | General knowledge note | — |
| `research` | In-depth research or analysis | `topic`, `source`, `findings` |
| `meeting` | Meeting notes with attendees and action items | `date`, `attendees`, `agenda` |
| `guide` | How-to guide or tutorial | `topic`, `audience`, `prerequisites` |
| `pattern` | Recurring pattern or best practice | `context`, `problem`, `solution` |

Each type gets an `archetypeText` (migrated from `content-archetypes.ts`) for embedding-based classification.

The knowledge module's content handler writes standard markdown files to the appropriate directories (`notes/`, `research/`, `logs/`, etc.) and indexes them — the same logic currently in the `import.ts` fallback path, but owned by the module.

### 6. Import Command Interface

```
brain import [paths...]              # full 3-tier pipeline
brain import --process-queue         # process pending agent queue items
brain import --dry-run               # show what would happen
brain import --tier 1                # deterministic only, queue the rest
brain import --json                  # JSON output (existing, enhanced)
```

Output:

```
Imported 47 files:
  Tier 1 (deterministic): 32 files → 62 notes (18 note, 8 task, 4 meeting, ...)
  Tier 2 (LLM):           12 files → 24 notes (9 task, 3 note, ...)
  Tier 3 (queued):          3 files → .brain/import-queue/
    quarterly-planning.md  (complex: mixed content types)
    design-system-v2.md    (long: 12K words)
    retro-notes-all.md     (ambiguous: concatenated meetings)
```

### 7. User Prompt

With all changes in place:

```
Update brain: npm update -g brain
Import your notes: brain import ~/my-notes
```

If there are queued items: `brain import --process-queue` (or have Claude Code process them).

## Files Changed

### New Files
- `src/modules/knowledge/index.ts` — knowledge module registration
- `src/modules/knowledge/content-handler.ts` — note materialization
- `src/services/extraction-pipeline.ts` — three-tier extraction orchestrator
- `src/services/extraction-tiers/deterministic.ts` — Tier 1 logic
- `src/services/extraction-tiers/llm-classifier.ts` — Tier 2 LLM prompt/parse
- `src/services/extraction-tiers/agent-queue.ts` — Tier 3 queue writer

### Modified Files
- `src/types.ts` — remove `ContentClass` type, add `ExtractedItem`
- `src/modules/types.ts` — add `importHints` to `ModuleNoteType`, update `ContentHandler` interface
- `src/modules/registry.ts` — add methods for querying import hints, archetype texts
- `src/modules/pm/index.ts` — add `importHints` to task/project/workstream registrations
- `src/modules/pm/content-handler.ts` — rewrite to create real PM tasks, auto-create project
- `src/commands/import.ts` — replace inline split/classify with extraction pipeline
- `src/services/content-classifier.ts` — refactor to use registered types (or remove)
- `src/services/content-archetypes.ts` — remove (migrated to module registrations)
- `src/services/document-splitter.ts` — simplify or remove (LLM handles splitting)

### Test Files
- `__tests__/services/extraction-pipeline.test.ts`
- `__tests__/services/extraction-tiers/deterministic.test.ts`
- `__tests__/services/extraction-tiers/llm-classifier.test.ts`
- `__tests__/services/extraction-tiers/agent-queue.test.ts`
- `__tests__/modules/knowledge/content-handler.test.ts`
- `__tests__/modules/pm/content-handler.test.ts` — update for new interface

## Migration Notes

- The `ContentClass` type is removed. Any code referencing it needs updating.
- `content-archetypes.ts` archetype texts move to module `importHints.archetypeText` fields.
- Existing `PmContentHandler` tests need full rewrite (new interface, real task creation).
- The `classifySection()` and `splitDocument()` functions may be retained internally within the extraction pipeline for Tier 1 heading-based section detection, but are no longer the primary classification mechanism.

## Implementation Order

1. **Knowledge module** — register core types with import hints, basic content handler
2. **PM module importHints** — add `tableColumnAliases` and `archetypeText` to existing registrations
3. **ExtractedItem type + ContentHandler interface change** — update the contract
4. **Tier 1: Deterministic extraction** — CSV column matching, frontmatter passthrough, embedding similarity
5. **PM content handler rewrite** — auto-create project/workstream, call `createTask()`
6. **Import command refactor** — wire up extraction pipeline, update output
7. **Tier 2: LLM classifier** — prompt construction, response parsing, confidence gating
8. **Tier 3: Agent queue** — queue file writer, `--process-queue` command
9. **Cleanup** — remove `ContentClass`, `content-archetypes.ts`, update tests
