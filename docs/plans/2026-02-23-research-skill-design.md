# Deep Research Skill + Lineage System Design

**Date**: 2026-02-23
**Status**: Approved
**Branch**: `feat/research-skill`
**Depends on**: `feat/init-setup` (current branch)
**Brainstorm prompt**: `docs/plans/2026-02-22-research-skill-brainstorm-prompt.md`

---

## 1. Executive Summary

Two interrelated systems designed as a coherent whole:

1. **Lineage/Provenance System** (Phase 1-2) — A general-purpose `derived-from` relation type, cascade operations (delete + archive), access tracking for usage-based tier promotion, and a web content extraction pipeline.

2. **Deep Research Skill** (Phase 3-4) — An orchestrator-worker pipeline that takes a natural language topic, audits brain's existing knowledge, performs structured web research, produces per-question synthesis notes with full lineage, and triggers memory extraction. Available as both `brain research` CLI command and Claude Code skill.

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Lineage scope | Foundation first | General-purpose system, research is first consumer |
| Cascade model | Two modes: hard delete + archive | Full cascade for cleanup, archive for reversibility |
| Interface | CLI + Skill | Research pipeline in TypeScript, works without Claude |
| Architecture | Orchestrator-worker | Testable stages, skill and CLI share infrastructure |
| Note granularity | One per sub-question | Sources listed in frontmatter, keeps note count manageable |
| URL fetching | General purpose | `brain add --url`, `brain ingest --urls`, and research share extraction |
| Tier strategy | Usage-based promotion | `tier: fast` default, auto-promote after N access events |
| Container | Per-initiative | `research-<slug>` isolates each initiative's memories |

---

## 2. Lineage/Provenance System

### 2.1 New Relation Type

Add `derived-from` to the existing `RelationType` union:

```typescript
export type RelationType = 'related-to' | 'supersedes' | 'informs' | 'parent' | 'derived-from';
```

**Semantics**: `source_id derived-from target_id` means "source was produced from/by target." The target is the origin. Same direction convention as `supersedes` (child points to parent).

**Example lineage tree:**
```
initiative-doc
  ├── sub-question-1-note  (derived-from initiative)
  ├── sub-question-2-note  (derived-from initiative)
  └── synthesis-report     (derived-from initiative)
```

No DDL changes required — existing `relations` table stores this as a TEXT type value in the `type` column. Composite primary key `(source_id, target_id, type)` already supports multiple relation types between note pairs.

### 2.2 Archive System

New `.archive/` directory alongside the notes directory (e.g., `~/brain/.archive/`).

**Archived notes are:**
- Moved from original location to `.archive/<original-relative-path>`
- Removed from search index (chunks, FTS, vectors deleted)
- Kept in `notes` table with `status: 'archived'`
- Their `derived-from` relations preserved (children retain back-references)

**Child note marking:** Children of an archived note get `orphaned_from: <archived-note-id>` added to their frontmatter, preserving lineage without requiring the archived note to be indexed.

### 2.3 Cascade Operations

Two new operations on `BrainDB`:

#### `cascadeDelete(noteId: string): CascadeResult`

1. Recursive CTE finds all descendants via `derived-from` edges:
   ```sql
   WITH RECURSIVE descendants(id) AS (
     SELECT source_id FROM relations WHERE target_id = ? AND type = 'derived-from'
     UNION ALL
     SELECT r.source_id FROM relations r
     JOIN descendants d ON r.target_id = d.id
     WHERE r.type = 'derived-from'
   )
   SELECT id FROM descendants;
   ```
2. Returns preview: `{ noteCount: N, memoryCount: M, noteIds: string[] }`
3. CLI shows confirmation: "Will delete N notes, M memories. Proceed? [y/N]"
4. Deletes in dependency order (leaves first, root last)
5. Each note uses existing `deleteNote()` (handles memories, chunks, FTS, relations)

#### `cascadeArchive(noteId: string): ArchiveResult`

1. Same recursive CTE to find descendants
2. Archives the root note:
   - Move file to `.archive/<relative-path>`
   - Delete chunks, FTS entries, vectors from index
   - Set `status: 'archived'` on notes table row
3. Mark direct children with `orphaned_from: <archived-note-id>` in frontmatter
4. Does NOT recurse into children — they stay live and indexed
5. Returns: `{ archivedNote: string, orphanedChildren: string[] }`

### 2.4 Access Tracking

New `note_access` table for usage-based tier promotion:

```sql
CREATE TABLE IF NOT EXISTS note_access (
  note_id    TEXT NOT NULL,
  event      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_note_access_note ON note_access(note_id);
```

**Tracked events:**
| Event | Trigger |
|-------|---------|
| `search_hit` | Note appears in search results |
| `relation_target` | Note referenced as a relation target |
| `context_view` | Note viewed via `brain context` |

**Promotion logic:**
- When a `tier: fast` note accumulates N access events (configurable, default 10), it is auto-promoted to `tier: slow`
- Promotion updates the note's frontmatter and removes `review-interval`
- `brain stale` also surfaces under-accessed research notes for manual review

### 2.5 Source Frontmatter Write Path

Fix `inboxItemToMarkdown` to preserve source structure. When an inbox item has `sourceUrl`:

**Before (current):**
```markdown
Source: https://example.com/article
```

**After (fixed):**
```yaml
sources:
  - url: "https://example.com/article"
    accessed: "2026-02-23"
    type: "web"
```

Also add `--sources` flag to `brain add` for manual source attribution.

---

## 3. Web Content Extraction (General Purpose)

### 3.1 Extraction Pipeline

New service: `src/services/web-extract.ts`

**Dependencies:** `@mozilla/readability` + `turndown` + `jsdom`

**Pipeline:**
1. Fetch URL with appropriate headers (User-Agent, timeout: 10s, max: 5MB)
2. Parse HTML with JSDOM
3. Extract readable content via Readability (strips nav, ads, boilerplate)
4. Convert to markdown via Turndown
5. Extract metadata: title, author, published date, description, site name
6. Normalize URL (strip `utm_*`, `ref`, `fbclid`, normalize trailing slashes, lowercase hostname)
7. Content hash (SHA256 of extracted markdown) for dedup
8. Return `{ markdown, metadata, normalizedUrl, contentHash }`

### 3.2 CLI Integration

```bash
# Single URL
brain add --url https://example.com/article

# Bulk URLs (one per line)
brain ingest --urls urls.txt

# Inbox items with sourceUrl get fetched during indexing
brain index --inbox
```

**Note output from `brain add --url`:**
```yaml
---
id: example-article-title
title: "Article Title"
type: research
tier: fast
status: draft
created: 2026-02-23
modified: 2026-02-23
sources:
  - url: "https://example.com/article"
    accessed: "2026-02-23"
    type: "web"
---

[Extracted markdown content]
```

### 3.3 Rate Limiting & Safety

| Setting | Default | Configurable |
|---------|---------|-------------|
| Delay between fetches | 1s | `web.fetchDelay` |
| Request timeout | 10s | `web.timeout` |
| Max content size | 5MB | `web.maxSize` |
| Max redirects | 3 | `web.maxRedirects` |
| User-Agent | `brain/1.0` | `web.userAgent` |

### 3.4 New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `@mozilla/readability` | HTML → readable article extraction | ~50KB |
| `turndown` | HTML → Markdown conversion | ~30KB |
| `jsdom` | HTML parsing (required by Readability) | ~2MB |

---

## 4. Research Pipeline (Orchestrator-Worker)

### 4.1 Pipeline Overview

```
brain research "topic"
  │
  ├── 1. AUDIT      — Search brain for prior knowledge
  ├── 2. PLAN       — Decompose into sub-questions (LLM)
  ├── 3. GATHER     — Fetch web content per sub-question
  ├── 4. SYNTHESIZE  — Produce notes + initiative doc (LLM)
  └── 5. INGEST     — Wire lineage, index, extract memories
```

Each stage is independently runnable, testable, and has well-defined input/output interfaces.

### 4.2 Stage 1: Audit

**Input:** `{ topic: string }`
**Output:** `{ priorNotes: SearchResult[], priorMemories: MemoryEntry[], summary: string }`

- Run hybrid search (BM25 + vector) for the topic
- Run memory search across all containers
- Produce structured "prior knowledge" summary
- Summary feeds into Stage 2 as context for question decomposition

### 4.3 Stage 2: Plan

**Input:** `{ topic: string, priorKnowledge: AuditResult }`
**Output:** `{ subQuestions: SubQuestion[], slug: string }`

```typescript
interface SubQuestion {
  question: string;
  searchQuery: string;
  priority: number;  // 1 = highest
  priorCoverage: 'none' | 'partial' | 'full';  // how well brain already covers this
}
```

- LLM decomposes topic into 3-7 sub-questions (respects budget)
- Considers prior knowledge: skips questions brain already answers well
- Generates web search queries optimized for each sub-question
- Interactive mode: user can review/edit sub-questions before proceeding

### 4.4 Stage 3: Gather

**Input:** `{ subQuestions: SubQuestion[], budget: GatherBudget }`
**Output:** `{ results: GatherResult[] }`

```typescript
interface GatherBudget {
  maxUrlsTotal: number;     // default 20
  maxUrlsPerQuestion: number; // default 5
  fetchDelay: number;        // default 1000ms
}

interface GatherResult {
  question: SubQuestion;
  sources: WebExtractResult[];
}
```

- For each sub-question: web search → fetch top-N URLs → extract content
- Deduplicate across sub-questions (same URL found for different questions)
- Budget tracking: stop when total sources exceed `maxUrlsTotal`
- Uses web extraction pipeline from Section 3

### 4.5 Stage 4: Synthesize

**Input:** `{ topic: string, gatherResults: GatherResult[], priorKnowledge: AuditResult }`
**Output:** `{ notes: NoteContent[], initiativeDoc: NoteContent }`

For each sub-question, LLM produces a synthesis note:
```yaml
---
id: research-<slug>-<question-slug>
title: "<Question as Title>"
type: research
tier: fast
category: research-<slug>
container: research-<slug>
status: draft
created: 2026-02-23
modified: 2026-02-23
review-interval: 90d
sources:
  - url: "https://..."
    accessed: "2026-02-23"
    type: "web"
related:
  - research-initiative-<slug>
---

[Synthesized findings for this sub-question]
```

Initiative doc aggregates all sub-question notes:
```yaml
---
id: research-initiative-<slug>
title: "Research Initiative: <topic>"
type: research
tier: fast
category: research-<slug>
container: research-<slug>
status: draft
created: 2026-02-23
modified: 2026-02-23
research-status: completed
research-budget: 20
research-questions-planned: 5
research-questions-completed: 5
research-sources-fetched: 18
related:
  - research-<slug>-question-1
  - research-<slug>-question-2
---

# Research Initiative: <topic>

## Summary
[High-level findings across all sub-questions]

## Sub-Questions Investigated
1. [Question 1] → `research-<slug>-question-1`
2. [Question 2] → `research-<slug>-question-2`

## Sources
[Aggregated list of all URLs with access dates]
```

### 4.6 Stage 5: Ingest

**Input:** `{ notes: NoteContent[], initiativeDoc: NoteContent, slug: string }`
**Output:** `{ summary: IngestSummary }`

1. Write all notes to `notesDir/research/`
2. Create `derived-from` relations: sub-question notes → initiative doc
3. Run indexing pipeline (file scan, chunk, embed)
4. Trigger memory extraction with container `research-<slug>`
5. Return summary: `{ notesCreated, memoriesExtracted, sourcesFetched, totalTokens }`

### 4.7 CLI Interface

```bash
# Full pipeline
brain research "sample ratio mismatch in A/B testing"

# With options
brain research "topic" --budget 30 --questions 7 --no-extract --dry-run

# Individual stages (for debugging/resuming)
brain research audit "topic"
brain research plan "topic" --prior-file audit.json
brain research gather --plan-file plan.json
brain research synthesize --gather-file gather.json
brain research ingest --synth-file synth.json

# Resume a previous initiative
brain research resume --initiative research-initiative-<slug>

# List initiatives
brain research list
```

**Key flags:**
| Flag | Default | Description |
|------|---------|-------------|
| `--budget N` | 20 | Max URLs to fetch |
| `--questions N` | 5 | Max sub-questions |
| `--no-extract` | false | Skip memory extraction |
| `--dry-run` | false | Show plan without executing |
| `--model <name>` | config default | Ollama model for planning/synthesis |
| `--interactive` | false | Review sub-questions before gathering |

### 4.8 Search Provider Adapter

Pluggable search backend via adapter pattern (mirrors embedder adapters):

```typescript
interface SearchProvider {
  search(query: string, maxResults: number): Promise<WebSearchResult[]>;
}

interface WebSearchResult {
  url: string;
  title: string;
  snippet: string;
}
```

**Implementations:**
| Provider | Auth | Notes |
|----------|------|-------|
| Brave Search | API key (free tier: 2000/month) | Recommended default |
| SearXNG | Self-hosted, no key | Privacy-focused alternative |
| Skill passthrough | N/A | Claude Code skill provides results via WebSearch tool |

Configuration: `brain config set search.provider brave` + `brain config set search.apiKey <key>`

### 4.9 Initiative State & Resumption

State stored in initiative doc's frontmatter:

```yaml
research-status: completed  # planned | gathering | synthesizing | completed
research-budget: 20
research-questions-planned: 5
research-questions-completed: 5
research-sources-fetched: 18
```

`brain research resume --initiative <id>`:
1. Reads initiative doc
2. Determines incomplete stages from `research-status`
3. Loads intermediate state from existing sub-question notes
4. Continues pipeline from the incomplete stage

---

## 5. Claude Code Skill Integration

### 5.1 Skill Architecture

The Claude Code skill (`~/.claude/skills/brain-research/SKILL.md`) wraps the CLI pipeline:

- Uses Claude's reasoning for sub-question decomposition (higher quality than Ollama)
- Uses `WebSearch` tool as the search provider (no API key needed)
- Calls `brain research` stages via Bash tool
- Can inject Claude-quality synthesis instead of Ollama
- Acts as a higher-quality "driver" for the same underlying pipeline

### 5.2 Skill Flow

```
User: "Research sample ratio mismatch"
  │
  ├── Skill calls: brain research audit "sample ratio mismatch"
  ├── Claude decomposes into sub-questions (better than Ollama)
  ├── Claude uses WebSearch for each sub-question
  ├── Skill calls: brain research synthesize --stdin < gathered-data
  └── Skill calls: brain research ingest --synth-file output.json
```

---

## 6. Integration & Cross-Cutting Concerns

### 6.1 Container Strategy

One container per research initiative: `research-<slug>`

- All memories from research notes scoped to initiative container
- `brain search --container research-<slug>` returns only that initiative
- `brain search --memories` without container searches all containers (existing behavior)

### 6.2 Staleness & Expiry

Research notes default:
```yaml
review-interval: 90d
expires: null  # optional, user can set manually
```

- `brain stale` surfaces research notes past review interval
- If `expires` set, `brain index` marks expired notes
- Usage-based promotion overrides: heavily-used notes get promoted to `tier: slow`, losing review pressure

### 6.3 Usage-Based Promotion Flow

```
Research note created (tier: fast, review-interval: 90d)
    │
    ├── Accessed 10+ times → auto-promoted to tier: slow
    │   (removes review-interval, becomes permanent knowledge)
    │
    ├── Review interval passes, <10 accesses → surfaced by brain stale
    │   (user decides: promote, keep, or archive)
    │
    └── Expires (if set) → surfaced by brain index as expired
```

### 6.4 Conflict Detection (Deferred)

Not in scope for initial implementation. Existing safeguards:
- Memory extraction's reconciliation (ADD/UPDATE/DELETE/NONE) handles basic conflicts
- Container isolation prevents research memories from silently overriding personal knowledge
- Future: `contradicts` memory relation type for explicit conflict surfacing

---

## 7. Implementation Phases

### Phase 1: Lineage Foundation
- Add `derived-from` to `RelationType`
- Implement `cascadeDelete` and `cascadeArchive` on BrainDB
- Add `note_access` table and tracking
- Implement archive directory support
- Fix inbox source preservation (`inboxItemToMarkdown`)
- Add `brain lineage` CLI command (view lineage tree, cascade ops)

### Phase 2: Web Extraction
- Add `@mozilla/readability` + `turndown` + `jsdom` dependencies
- Implement `web-extract.ts` service
- Wire into `brain add --url` and `brain ingest --urls`
- URL normalization and content-hash dedup

### Phase 3: Research Pipeline
- Implement research orchestrator service (`research.ts`)
- Implement 5 pipeline stages with defined interfaces
- Add `brain research` CLI command with subcommands
- Add search provider adapter (Brave Search default)
- Add research-specific LLM prompts

### Phase 4: Claude Code Skill
- Create `~/.claude/skills/brain-research/SKILL.md`
- Skill orchestrates pipeline via brain CLI
- Leverages Claude's WebSearch and reasoning for higher quality

### Phase 5: Polish
- Usage-based promotion automation
- Research resume/extend workflow
- Budget tuning and configurable defaults
- Documentation and examples

---

## 8. File Changes Summary

### New Files
| File | Purpose |
|------|---------|
| `src/services/web-extract.ts` | URL fetching + HTML → markdown extraction |
| `src/services/research.ts` | Research pipeline orchestrator |
| `src/services/search-provider.ts` | Search provider adapter (Brave, SearXNG) |
| `src/commands/research.ts` | `brain research` CLI command |
| `src/commands/lineage.ts` | `brain lineage` CLI command |
| `~/.claude/skills/brain-research/SKILL.md` | Claude Code research skill |

### Modified Files
| File | Changes |
|------|---------|
| `src/types.ts` | Add `derived-from` to `RelationType`, add `WebExtractResult`, `SearchProvider`, research interfaces |
| `src/services/brain-db.ts` | Add `cascadeDelete`, `cascadeArchive`, `note_access` table (schema V6), archive support |
| `src/services/repos/note-repo.ts` | Add access tracking methods, lineage query helpers |
| `src/services/indexing.ts` | Fix `inboxItemToMarkdown` source preservation |
| `src/commands/add.ts` | Add `--url` and `--sources` flags |
| `src/commands/ingest.ts` | Add `--urls` flag for bulk URL import |
| `src/cli.ts` | Register new commands |
| `package.json` | Add `@mozilla/readability`, `turndown`, `jsdom`, search provider deps |

### New Dependencies
| Package | Purpose |
|---------|---------|
| `@mozilla/readability` | HTML article extraction |
| `turndown` | HTML → Markdown |
| `jsdom` | HTML DOM parsing |
| Search provider SDK | Brave Search or similar (TBD) |
