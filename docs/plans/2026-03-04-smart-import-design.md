# Smart Import: Self-Classifying Content Pipeline

**Date:** 2026-03-04
**Status:** Approved
**Scope:** Replace ingest/index with a unified import pipeline that auto-classifies content and routes to appropriate modules

## Problem

A user imported Notion exports and Linear CSVs into a fresh brain instance. The experience failed in multiple ways:

1. CSV files silently ignored — the scanner only accepts `.md`
2. No feedback about skipped or unsupported files
3. Tabular data (task lists, bug matrices) lost structure when chunked as prose
4. The user didn't know the PM module existed or how to use it
5. Mixed documents (architecture prose + embedded task tables) weren't decomposed

**Root cause:** The system requires users to understand its internal taxonomy before importing. Content should self-classify and route to modules automatically.

## Architecture

### Current Model (Being Replaced)

```
User picks a flow → flow decides how to process docs

brain ingest <files>     → inbox table (raw text, no conversion)
brain index --inbox      → markdown parse → embed → index
brain index              → scan notes dir (.md only) → embed → index
brain pm onboard         → detect components → ingest docs → auto-link
```

Two-phase pipeline (ingest then index) leaks implementation details into UX. Format conversion, classification, and module routing don't exist.

### New Model

```
brain import <files/dirs/urls>
  → Structural Detection (deterministic)
  → Format-Specific Cleanup (Notion/Linear adapters)
  → Section Classification (deterministic → LLM → embedding)
  → Document Splitting (mixed docs → multiple typed notes)
  → Module Content Handler Dispatch
  → Embedding + Indexing
  → Report
```

Single command does everything. Content self-classifies. Modules register handlers and claim content they understand. The user dumps files and gets a structured knowledge base.

### Command Changes

| Before | After |
|---|---|
| `brain ingest <files>` | **Removed.** Replaced by `brain import`. |
| `brain index` | **Kept.** Re-indexes existing notes after manual edits. No re-classification. |
| `brain index --inbox` | **Kept internally.** Processes RSS/feed items via inbox table. |
| — | **`brain import <files/dirs/urls>`** — new primary entry point. |

The **inbox table** stays as internal plumbing for RSS feeds and URL crawling. `brain import` for files bypasses the inbox — content goes straight through the pipeline.

## Pipeline Detail

### Stage 1: Structural Detection (Deterministic)

Runs on every file. Identifies data structure without interpreting semantics.

| Input | Detection | Output |
|---|---|---|
| `.csv` file | Parse headers + rows | `{ structure: 'table', headers, rowCount, format: 'csv' }` |
| `.md` with `\|` tables | Regex table detection | `{ structure: 'table', headers, rowCount, format: 'markdown-table' }` |
| `.md` with `- [ ]` lists | Checkbox pattern | `{ structure: 'checklist', itemCount }` |
| `.md` with headings + prose | Section splitting | `{ structure: 'document', sections: [...] }` |
| `.txt` | Raw text | `{ structure: 'plaintext' }` |
| `.png`, `.jpg`, etc. | Unsupported | `{ structure: 'unsupported', ext }` |

**Supported extensions:** `.md`, `.txt`, `.csv`
**Unsupported extensions:** logged for skip report, not processed.

### Stage 2: Format-Specific Cleanup

Applied before classification so the classifier sees clean content.

**Notion adapter** (`notion-adapter.ts`):
- Detects Notion exports by UUID-in-URL link patterns and "Properties" table markers
- Strips embedded Properties metadata tables
- Normalizes internal Notion links (UUID paths → slug-style links)
- Extracts Notion properties as frontmatter-compatible fields

**Linear adapter** (`linear-adapter.ts`):
- Detects Linear CSVs by column name patterns (ID, Title, Priority, Status, Assignee, Labels, Team, Cycle)
- Provides Linear-specific field mappings: Priority values (Urgent/High/Medium/Low/None), Status values (Backlog/Todo/In Progress/Done/Cancelled)

Adapters are consumed by the classification layer — they provide hints and field mappings, not direct conversion.

### Stage 3: Section Classification

Three layers, executed in priority order:

**Layer 1 — Deterministic rules** (checked first):
- **task-list**: table with 2+ of Status/Priority/Assignee/Due/Estimate columns; or checkbox lists
- **bug-report**: contains "steps to reproduce", "expected behavior", "severity", "bug bash", or screenshot refs with issue context
- **architecture**: heading contains "architecture"/"system design"/"data flow"/"component"; or multiple code blocks + design terminology
- **requirements**: heading contains "requirements"/"PRD"/"user stories"/"acceptance criteria"; or "must"/"shall"/"should" in quantified bullet lists
- **meeting-notes**: contains "attendees:"/"agenda:"/"action items:"; or date-stamped headers with participant names
- **reference**: tables with 3+ columns and 10+ rows that don't match task-list patterns

**Layer 2 — LLM classification** (for tables and ambiguous sections):

Uses existing Ollama model (`qwen2.5:3b`). Schema-aware: the prompt includes registered note type schemas from the module registry.

For tables, the prompt asks:
1. Should this table be decomposed into individual notes or kept as a single note?
2. If decomposed: which registered note type does each row map to? Map each column to a frontmatter field.
3. If kept: what note type best fits? Suggest a title.

Response is structured JSON (same pattern as memory extraction prompts).

**Caching:** Classification results are cached by table signature (sorted headers + hash of first 3 rows). Same structure = same classification. Avoids re-classifying identical table formats across files.

**Layer 3 — Embedding classification** (for prose sections without deterministic matches):

Archetype embeddings — one per `ContentClass`, generated from short exemplar texts (2-3 sentences each). Lazy-computed once per session, stored in memory.

Compare section embedding to each archetype via cosine similarity. Highest score > 0.6 wins, otherwise `general`.

### Stage 4: Document Splitting

When a source document contains mixed content types:

1. **Source note** is always created with full original content. Type based on dominant content class.
2. **Derived notes** are created for each distinct section group that differs from the dominant class (confidence > 0.7).
3. All derived notes get a `derived-from` relation to the source note.

**Table decomposition** (when LLM says "decompose"):
- Each row becomes an individual note
- LLM's schema mapping (column → frontmatter field) applied to generate frontmatter
- No intermediate markdown table — go straight from CSV/table rows to structured notes

**Table preservation** (when LLM says "keep as unit"):
- Table converted to markdown table in note body
- Note type from LLM suggestion (reference, comparison, etc.)

### Stage 5: Module Content Handler Dispatch

Modules register content handlers via the module system:

```typescript
interface ContentHandler {
  contentClasses: ContentClass[];
  canHandle(classification: ClassifiedSection): boolean;
  materialize(
    db: BrainDB,
    embedder: Embedder,
    content: string,
    classification: ClassifiedSection,
    sourceNoteId: string,
    schemaMapping?: Record<string, string>
  ): Promise<string[]>;  // created noteIds
}

// On ModuleContext:
registerContentHandler(handler: ContentHandler): void;
```

**PM module** registers a handler for `task-list`:
- Receives classified table content + LLM schema mapping
- Creates individual PM task notes via existing PM data layer
- Returns created note IDs

**Dispatch logic:**
1. For each classified section, query the module registry: "who handles this content class?"
2. If a handler exists and `canHandle` returns true → delegate to handler's `materialize`
3. If no handler → create a standard core note with appropriate type/tier

**ContentClass → default NoteType mapping** (when no module handler claims it):

| ContentClass | NoteType | Tier |
|---|---|---|
| `task-list` | `note` | `fast` |
| `bug-report` | `note` | `fast` |
| `architecture` | `research` | `slow` |
| `requirements` | `research` | `slow` |
| `meeting-notes` | `meeting` | `fast` |
| `reference` | `note` | `slow` |
| `general` | `note` | `slow` |

### Stage 6: Embedding + Indexing

Standard pipeline: `parseMarkdown` → chunks → embed → FTS → relations → auto-links.

**Table-aware chunking**: Markdown tables are kept atomic in the chunker (not split mid-row). The `splitParagraphsProtectingFences` function is extended to protect table blocks alongside code fences.

**Image context preservation**: When a section contains `![alt](path)`, the alt text and surrounding prose are included in the chunk. Image-only sections get a synthetic text chunk `"[Image: {alt text}]"` so the image context is searchable.

### Stage 7: Report

Every `brain import` run prints a structured report:

```
Imported 15 file(s):
  8 markdown → 8 notes (3 research, 2 meeting, 3 general)
  2 CSV → 24 task notes (decomposed by PM)
  1 CSV → 1 reference note (kept as table)
  4 plaintext → 4 notes
Derived: 5 additional notes from mixed documents
Skipped 5 file(s):
  3 .png (unsupported — images referenced in context)
  1 .xlsx (unsupported)
  1 empty
```

## Doctor FS Diff + Provenance

**New health check** (`checkFilesystemSync`):
- Compares files on disk in `notesDir` vs `db.getAllFiles()`
- Reports: unindexed files (by extension), orphaned DB records
- `--fix` cleans up orphaned records

**Source provenance**:
- All imported notes track `sourceMeta` in frontmatter: `{ originalPath, format, importedAt, sourceApp? }`
- CSV imports add: `{ rowCount, columnNames, detectedFlavor }`
- Provenance is searchable via FTS

## Module System Changes

### New registration hook

```typescript
// src/modules/types.ts
interface ContentHandler {
  contentClasses: ContentClass[];
  canHandle(classification: ClassifiedSection): boolean;
  materialize(
    db: BrainDB, embedder: Embedder,
    content: string, classification: ClassifiedSection,
    sourceNoteId: string, schemaMapping?: Record<string, string>
  ): Promise<string[]>;
}

// Added to ModuleContext:
registerContentHandler(handler: ContentHandler): void;
```

### Wiring the registry into the import pipeline

Currently `indexing.ts` has zero knowledge of the module registry. The new `brain import` command will:

1. Call `loadModules({ modules: [pmModule] })` to get a populated registry
2. Extract content handlers via `registry.getContentHandlers()`
3. Pass handlers to the import pipeline functions

This is a new code path — it doesn't modify the existing `brain index` command's wiring.

## Type Changes

```typescript
// src/types.ts additions:

// CutType — add table_boundary
export type CutType = ... | 'table_boundary';

// InboxSource — add notion, linear
export type InboxSource = ... | 'notion' | 'linear';

// ParsedNote — add imageRefs
export interface ParsedNote {
  // ... existing fields
  imageRefs?: Array<{ alt: string; path: string }>;
}

// New ContentClass type
export type ContentClass =
  | 'task-list' | 'bug-report' | 'architecture'
  | 'requirements' | 'meeting-notes' | 'reference' | 'general';
```

## New Files

| File | Purpose |
|---|---|
| `src/commands/import.ts` | Unified import command |
| `src/services/format-adapters/index.ts` | Format detection + routing |
| `src/services/format-adapters/csv-adapter.ts` | CSV parsing |
| `src/services/format-adapters/notion-adapter.ts` | Notion export cleanup |
| `src/services/format-adapters/linear-adapter.ts` | Linear CSV field mapping |
| `src/services/content-classifier.ts` | Deterministic + LLM + embedding classification |
| `src/services/content-archetypes.ts` | Exemplar texts for embedding fallback |
| `src/services/document-splitter.ts` | Mixed doc → multiple typed notes |

## Modified Files

| File | Changes |
|---|---|
| `src/cli.ts` | Add import command, remove ingest command |
| `src/services/file-scanner.ts` | `INDEXABLE_EXTENSIONS` set, `listUnsupportedFiles` |
| `src/services/markdown-parser.ts` | Table-aware chunking, image ref extraction, export `splitIntoSections` |
| `src/services/indexing.ts` | Format dispatch in `indexSingleFile`, provenance in inbox processing |
| `src/services/health.ts` | `checkFilesystemSync`, updated `runAllChecks` |
| `src/commands/index-cmd.ts` | Unsupported file report, watch mode filter update |
| `src/commands/doctor.ts` | Pass notesDir, FS diff fix hints |
| `src/types.ts` | `table_boundary` CutType, `notion`/`linear` InboxSource, `imageRefs`, `ContentClass` |
| `src/modules/types.ts` | `ContentHandler` interface, `registerContentHandler` |
| `src/modules/registry.ts` | Store and expose content handlers |
| `src/modules/context.ts` | Delegate `registerContentHandler` |
| `src/modules/pm/index.ts` | Register PM content handler for task-list |

## Implementation Phases

```
Phase 1: Multi-format support + skip reporting          ← no deps
Phase 2: Table-aware chunking                           ← no deps
Phase 3: Content classification (deterministic + LLM + embedding)  ← no deps
Phase 4: Document splitting + derived notes             ← Phase 2, 3
Phase 5: Unified import command + remove ingest         ← Phase 1, 3, 4
Phase 6: Module content handlers (PM task routing)      ← Phase 4, 5
Phase 7: Doctor FS diff + provenance                    ← Phase 1
Phase 8: Image context preservation                     ← Phase 2
Phase 9: Notion/Linear export adapters                  ← Phase 1, 3
```

Phases 1, 2, 3 can be built in parallel. Each is independently testable.
