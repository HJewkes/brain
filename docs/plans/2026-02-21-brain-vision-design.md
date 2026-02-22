# Brain Vision: From Search Index to Memory Engine

**Date**: 2026-02-21
**Status**: Initial implementation complete (Phases 1–5)
**Branch**: `feat/phase-1-better-chunking-search`
**Updated**: 2026-02-22

## 1. Executive Summary

Brain is evolving from a "search over markdown notes" CLI into a full **memory engine** that serves both human knowledge management and AI agent memory. The core additions are:

1. **Memory extraction layer** — LLM extracts discrete facts from notes, stores them as versioned entities
2. **Temporal versioning** — memories chain and supersede each other, with automatic forgetting
3. **Inbox and ingestion pipeline** — frictionless capture from RSS feeds, web crawlers, Google Alerts, and quick notes
4. **Content-type-aware chunking** — AST-based code chunking, heading-aware markdown splitting, semantic prose splitting
5. **Improved search** — cross-encoder reranking, Matryoshka embeddings, scoped search, container tags

This document captures the full landscape research, design decisions, and phased implementation plan.

---

## 2. Landscape Research

### 2.1 Open Source Projects

#### Supermemory (supermemoryai/supermemory)

- **Stars**: 16.5k | **Language**: TypeScript | **License**: MIT (frontend only)
- **What it does**: Memory API with a two-layer storage model (documents + chunks + extracted memory entries). Deployed on Cloudflare Workers.
- **Backend is closed source** — distributed as compiled bundle for enterprise self-hosting. Public repo is the web app, MCP server, browser extension, and shared validation schemas.

**Architecture**:
- PostgreSQL + pgvector for all storage
- Three embedding slots per chunk: legacy, current, and Matryoshka/MRL
- Cloudflare KV for edge caching, R2 for static assets
- Cloudflare AI for embedding generation

**Data model** (from `packages/validation/schemas.ts`):

| Table | Purpose |
|---|---|
| `documents` | Raw ingested content with `summaryEmbedding`, `contentHash`, `status`, processing metadata |
| `chunks` | Semantic pieces with `embedding`, `embeddingNew`, `matryokshaEmbedding`, `position` |
| `memory_entries` | Extracted facts with `isLatest`, `parentMemoryId`, `rootMemoryId`, `memoryRelations`, `isForgotten`, `forgetAfter`, `memoryEmbedding` |
| `spaces` | Named containers (projects) that scope memories |
| `documents_to_spaces` | Many-to-many join |
| `memory_document_sources` | Links memories to source documents with relevance scores |

**Ingestion pipeline**: `queued -> extracting -> chunking -> embedding -> indexing -> done`
1. Content detection and extraction (URLs, PDFs, YouTube, images, audio, code, markdown)
2. Optional LLM filtering with custom `filterPrompt`
3. Content-type-aware chunking (AST for code via `code-chunk`, headers for docs, incremental for conversations)
4. Embedding via Cloudflare AI
5. Memory extraction — LLM extracts facts, compares against existing, builds `updates | extends | derives` relationships
6. Document-level summary embedding

**Search**: Two modes — `"memories"` (facts only) or `"hybrid"` (facts + chunks merged). Pipeline: optional query rewriting -> pgvector ANN -> metadata filtering -> contextual windowing (adjacent chunks) -> optional cross-encoder reranking.

**Profile API**: Returns `profile.static` (stable facts) + `profile.dynamic` (recent context) — designed for always-on LLM system prompt injection.

**Key ideas to borrow**:
- Two-layer documents-vs-memories abstraction
- `containerTag` namespace isolation
- Matryoshka embedding slots for flexible dimensionality
- Memory versioning via `parentMemoryId`/`isLatest` chain
- Automatic forgetting (`forgetAfter`/`isForgotten`)
- Processing status enum for pipeline observability

---

#### mem0 (mem0ai/mem0)

- **Stars**: 47.7k | **Language**: Python | **License**: Apache 2.0
- **What it does**: Memory extraction and versioning layer for AI agents. Takes conversation messages, uses LLM to extract facts, then decides ADD/UPDATE/DELETE/NONE against existing memories.

**Architecture — three-layer storage**:
- **Vector store**: 25+ backends (Qdrant, Pinecone, Chroma, pgvector, Faiss, etc.) via factory pattern
- **History log**: SQLite (`SQLiteManager`) — pure event-sourcing with `old_memory`, `new_memory`, `event`, `created_at`, `actor_id`, `role`
- **Graph store** (optional): Neo4j for entity/relationship extraction

**Memory extraction pipeline (the core of the project)**:
1. Parse messages into text
2. LLM call with `FACT_RETRIEVAL_PROMPT` — extracts `{"facts": [...]}` list of atomic facts
3. Fetch top-k existing memories from vector store (semantic similarity)
4. LLM call with `DEFAULT_UPDATE_MEMORY_PROMPT` — passes old memories + new facts, asks for ADD/UPDATE/DELETE/NONE decisions on each
5. Execute operations; log every change to SQLite history

**`PROCEDURAL` memory type**: Records agent execution traces verbatim (not fact-extraction).

**Graph memory** (optional Neo4j): Entity extraction via LLM tool calls (`EXTRACT_ENTITIES_TOOL`, `RELATIONS_TOOL`), builds typed entity graph, deduplicates via graph search + BM25 on triples.

**Key ideas to borrow**:
- Two-stage extract-then-reconcile prompt pattern (extract facts first, then decide ADD/UPDATE/DELETE/NONE)
- SQLite event-sourcing history log schema (`memory_id`, `old_memory`, `new_memory`, `event`, `created_at`)
- `actor_id`/`role` fields for tracking which participant changed what
- Scoping memories to `user_id` / `agent_id` / `run_id`

---

#### Khoj (khoj-ai/khoj)

- **Stars**: 32.5k | **Language**: Python (Django) | **License**: AGPL-3.0
- **What it does**: Full personal AI assistant that indexes documents (markdown, Org-mode, PDF, DOCX, Notion, GitHub) and enables semantic search and chat.

**Architecture**:
- Django ORM (PostgreSQL production, SQLite dev) + pgvector
- `sentence-transformers` bi-encoder models
- `UserMemory` model for long-term memory (separate from indexed entries)

**Markdown chunking strategy** (the standout feature):
- Recursive heading-aware splitting via `MarkdownToEntries.extract_markdown_entries`
- **Prepends full heading ancestry to every chunk** — e.g., `## Level 2\n### Level 3\ncontent` — making each chunk semantically self-contained with its location context
- Caps at 256 tokens; sections smaller than this stay as a unit
- Tracks `start_line` for `file://path#line=N` deep-linking URIs

**Key ideas to borrow**:
- Heading-ancestry prepending for markdown chunks (directly portable, pure text transformation)
- `hashed_value` deduplication (hash file content, skip unchanged on re-index)
- `file://path#line=N` URI scheme for source attribution

---

#### Graphiti (getzep/graphiti)

- **Stars**: 23k | **Language**: Python | **License**: Apache 2.0
- **What it does**: Incremental temporal knowledge graph builder. Processes "episodes" and extracts typed entity nodes and relationship edges with bi-temporal timestamps.

**Architecture**:
- Neo4j primary (also Kuzu embedded, Neptune for AWS)
- Four node types: `EpisodicNode`, `EntityNode`, `CommunityNode`, `SagaNode`
- Five edge types: `EntityEdge`, `EpisodicEdge`, `HasEpisodeEdge`, `NextEpisodeEdge`, plus community edges

**Bi-temporal edge model** (the core innovation):
```
expired_at  — when the edge was superseded in the graph
valid_at    — when the fact became true in the world
invalid_at  — when the fact stopped being true in the world
```
This distinguishes "when did we learn this" from "when was this true."

**Memory extraction pipeline** (`add_episode()`):
1. Retrieve previous episodes for context
2. `extract_nodes()` — LLM extracts entities with custom type schemas
3. `resolve_extracted_nodes()` — hybrid search + LLM deduplication
4. `extract_edges()` — LLM extracts natural-language facts as edges
5. `resolve_extracted_edges()` — search for similar existing edges, LLM decides: keep/merge/invalidate
6. `build_communities()` — cluster entities into community nodes with LLM summaries
7. Persist to Neo4j

**Search** (extremely sophisticated): Eight composable recipes — RRF, MMR, cross-encoder, node-distance, episode-mentions, BFS — all configurable via `SearchConfig`.

**Key ideas to borrow**:
- `valid_at`/`invalid_at` temporal edge schema (applicable without Neo4j)
- Edge deduplication: fast-path exact match -> embedding similarity -> LLM for ambiguous cases
- `SearchConfig` composable recipe system
- Community nodes as higher-level summarization layer
- `group_id` namespace partitioning
- BFS as a search method for graph traversal from anchor nodes

---

#### Cognee (topoteretes/cognee)

- **Stars**: 12.5k | **Language**: Python | **License**: Apache 2.0
- **What it does**: Ingestion and knowledge graph pipeline ("cognify") that chunks, extracts ontological entities/relationships, and provides multiple retrieval modes.

**Architecture**:
- Graph: Neo4j, Kuzu (embedded), Neptune
- Vector: pluggable via `get_vector_engine()`
- Relational: SQLAlchemy with Alembic migrations

**Chunking strategy** (most detailed of any project):
- Pipeline: `chunk_by_sentence` -> `chunk_by_paragraph` -> `TextChunker`
- Chunks carry `cut_type` metadata (`paragraph_end`, `sentence_cut`, `word`)
- **Deterministic UUID5 via `uuid5(NAMESPACE_OID, chunk_text)`** — identical text always gets the same ID, free deduplication
- `DocumentChunk.contains` for sub-chunk references

**Retrieval modes** (most diverse of any project):
- `GraphCompletionRetriever`, `TemporalRetriever`, `LexicalRetriever`, `TripletRetriever`, `ChunksRetriever`, `SummariesRetriever`, `CypherSearchRetriever`, `JaccardRetriever`, `GraphCompletionCoTRetriever`

**Key ideas to borrow**:
- UUID5 deterministic chunk IDs (free deduplication)
- `cut_type` metadata on chunks
- `chunks_per_batch` for LLM extraction calls
- `update_node_access_timestamps` for recency signals
- `TemporalRetriever` extracts time intervals from queries

---

#### LlamaIndex (run-llama/llama_index)

- **Stars**: 47.1k | **Language**: Python | **License**: MIT
- **What it does**: Comprehensive LLM application framework with the most mature storage and memory abstractions in the ecosystem.

**`StorageContext`** — the canonical abstraction:
```python
@dataclass
class StorageContext:
    docstore: BaseDocumentStore
    index_store: BaseIndexStore
    vector_stores: Dict[str, BasePydanticVectorStore]
    graph_store: GraphStore
    property_graph_store: Optional[PropertyGraphStore]
```

**Memory system**:
- `BaseMemoryBlock` generic base — `aget(messages)` and `aput(messages)` interface
- `FactExtractionMemoryBlock` — LLM-powered fact extraction with condense prompt
- `VectorMemoryBlock` — vector-backed retrieval of past conversations
- `StaticMemoryBlock` — static injected context
- `Memory` orchestrates blocks with short-term buffer (30k tokens, 10% flush to long-term)

**Chunking**:
- `SentenceSplitter` (sentence-aware, with overlap)
- `TokenTextSplitter`
- **`SemanticSplitter`** — embedding cosine similarity between consecutive sentences, splits at similarity valleys (most principled approach)
- `MarkdownNodeParser` (heading-aware)
- **`HierarchicalNodeParser`** — parent/child chunks at multiple granularities (512->128->64 tokens) for "small-to-big retrieval"

**Key ideas to borrow**:
- `SemanticSplitter` concept (split at embedding similarity valleys)
- `HierarchicalNodeParser` (multi-granularity storage, retrieve small, return large)
- `BaseMemoryBlock` protocol for composable memory layers
- `batch_by_user_message` for conversation memory
- Short-term buffer with overflow flush to long-term

---

### 2.2 Closed Source / Commercial Products

#### Rewind AI / Limitless

- **What it does**: Records everything on screen/mic (Rewind = desktop), or all spoken conversations via wearable pendant (Limitless), makes it all queryable via AI.

**Ideas worth noting**:
- Passive capture as input model — instead of requiring explicit filing, record continuously and index post-hoc
- Granular OCR + FTS5 over screenshots (captures at 0.5fps, runs Apple Vision OCR, stores text in SQLite FTS5)
- App context via accessibility APIs (frontmost window title + URL alongside each frame)
- Local-first as trust signal, not just architecture — Rewind's entire market position was "data never leaves your machine"
- Proactive meeting prep via calendar integration — Limitless briefs you before meetings using past notes/conversations

---

#### Mem.ai

- **What it does**: Folderless AI note-taking where the system auto-organizes everything. Core premise: never decide where something goes.

**Ideas worth noting**:
- **Eliminate the filing decision** — every capture goes into a flat stream, AI groups into Collections retroactively. For Brain: reduce `brain add` friction, let the indexer infer structure
- **"Heads Up"** — while writing, Mem surfaces related past notes and collections automatically (pull-on-write, not push-on-query)
- **"Deep Search"** understands intent, not keywords — "that conversation about Q3 budget concerns" works as a query
- **Mem Graph** — explicit entity/relationship extraction on top of notes
- **"Clean Up"** — one-shot note reformatting via LLM (raw dump -> structured note)
- **Inbox concept** — zero-friction capture point, classification happens later

---

#### Reflect

- **What it does**: Fast networked note-taking with E2E encryption, calendar sync, and graph-aware AI chat.

**Ideas worth noting**:
- **Graph-aware RAG** — AI uses backlink context and connections between notes, not just individual note content
- **Scoped chat** — filter by tag/date/backlink before chatting to set context window intentionally
- **Backlinks as first-class navigation** — quick two-way linking during writing
- **Calendar as memory scaffold** — meetings auto-become notes with time context
- **E2E encryption as table stakes** for any cloud-sync product

---

#### Obsidian (AI/Embedding Plugin Ecosystem)

- **What it does**: Local Markdown vault with graph view and plugin API. The AI layer is community-built.

**Ideas worth noting**:
- **"Smart Connections" panel** — always-on semantic sidebar that updates as you navigate (no query needed)
- **Block-level embeddings** — individual paragraphs/blocks embedded separately (`.smart-env/smart_blocks.ajson`), finer-grained retrieval
- **Local embedding as zero-setup default** — `bge-micro-v2` ships as default, works offline with no API key
- **Incremental index via file events** — re-embeds only changed files, no batch re-index
- **Pluggable embedding backend with local as default** — backend toggle is a single config key

---

#### Notion AI

- **What it does**: AI features layered on Notion's structured-block workspace with permission-aware retrieval.

**Ideas worth noting**:
- **Permission-aware retrieval** as core infrastructure — the AI can't surface content the user can't see
- **CDC pipeline**: Postgres -> Kafka -> S3 (Hudi) -> vector DB + Elasticsearch as separate read models
- **Structured blocks as retrieval unit** — every paragraph/heading/table is addressable, enables precise citation
- **Inline AI** — operates within the document, not in a separate panel

---

#### Apple Intelligence

- **What it does**: On-device AI with semantic index across all content types, Private Cloud Compute for overflow.

**Ideas worth noting**:
- **Semantic index as OS-level primitive** — one global index across files, photos, emails, messages
- **RAG -> App Intents routing** — retrieval followed by routing to an action, not just a text response
- **Two-tier compute with clear privacy boundaries** — small local model handles most queries, larger remote model opt-in with zero data retention
- **Background incremental indexing at low priority** — index runs as daemon, ready when needed
- **"AI that knows your life without your life leaving your device"** — local-first IS the product differentiator

---

### 2.3 Libraries and Dependencies

#### Chunking

| Library | Language | Stars | License | Node.js | Best Use |
|---------|----------|-------|---------|---------|----------|
| `code-chunk` (supermemoryai) | TypeScript | 144 | MIT | Native | AST-aware code chunking via tree-sitter WASM |
| `@langchain/textsplitters` | TypeScript | 17k (monorepo) | MIT | Native | Markdown/HTML/text splitting |
| `semantic-chunking` (jparkerweb) | JavaScript | 134 | MIT | Native | Semantic prose chunking via embedding similarity |
| `chonkiejs` (chonkie-inc) | TypeScript | 309 | MIT | Native | Lightweight recursive/token chunking |
| `chunkr` (lumina-ai-inc) | Rust (service) | 2.9k | AGPL-3.0 | HTTP client only | PDF/PPTX parsing at scale |
| `unstructured` (Unstructured-IO) | Python (service) | 14k | Apache 2.0 | HTTP client only | Complex document ETL |
| `docling` (IBM Research) | Python | 42k | MIT | None | PDF structural chunking (reference only) |

**`code-chunk` details**: Uses `web-tree-sitter` (WASM) for AST parsing. Splits at function/class/method boundaries. Produces `contextualizedText` with scope chain, imports, and entity signatures prepended. Supports TypeScript, JavaScript, Python, Rust, Go, Java. Has an `effect` (Effect.js) dependency.

**`@langchain/textsplitters` details**: `MarkdownTextSplitter` (heading-aware separators), `RecursiveCharacterTextSplitter` (tries `\n\n`, `\n`, ` ` in order), `HTMLHeaderTextSplitter`, `TokenTextSplitter`. Peer dep on `@langchain/core`.

**`semantic-chunking` details**: Sentences -> embed each -> cosine similarity between adjacent -> split at valleys -> rebalance by token count. Uses `@huggingface/transformers` internally.

#### Embeddings

| Library | Stars | License | Node.js | Notes |
|---------|-------|---------|---------|-------|
| `@huggingface/transformers` | 15.4k | Apache 2.0 | Native | Full pipeline API, embeddings + reranking |
| `fastembed` (Qdrant) | 172 | MIT | Native | Leaner, quantized ONNX, `onnxruntime-node` |

**Recommended embedding models** (ONNX, run locally via transformers.js):

| Model | Dimensions | Matryoshka | Notes |
|-------|-----------|------------|-------|
| `nomic-ai/nomic-embed-text-v1.5` | 768 | Yes (requires layer norm before truncation) | Widely used, good general-purpose |
| `mixedbread-ai/mxbai-embed-large-v1` | 1024 | Yes | Top MTEB score |
| `Xenova/all-MiniLM-L6-v2` | 384 | No | Fast, small, good baseline |
| `Xenova/bge-small-en-v1.5` | 384 | No | Top-tier small model |
| `google/EmbeddingGemma` | 768 | Yes (128-768) | New (2025), also available via Ollama |

#### Cross-Encoder Reranking

All usable with `@huggingface/transformers` `text-classification` pipeline:

| Model | Size | Notes |
|-------|------|-------|
| `Xenova/ms-marco-MiniLM-L-6-v2` | ~90MB | Very fast, decent quality |
| `Xenova/ms-marco-MiniLM-L-12-v2` | ~130MB | Slower, better quality |
| `Xenova/bge-reranker-base` | ~280MB | Strong for English |
| `mixedbread-ai/mxbai-rerank-xsmall-v1` | ~90MB | Tiny, fast |
| `mixedbread-ai/mxbai-rerank-base-v1` | ~280MB | Good English quality |
| `mogolloni/bge-reranker-v2-m3-onnx` | ~570MB | Multilingual, best quality |

Usage pattern:
```typescript
import { pipeline } from '@huggingface/transformers'
const reranker = await pipeline('text-classification', 'Xenova/ms-marco-MiniLM-L-6-v2')
const scores = await reranker([
  ['query', 'relevant passage'],
  ['query', 'irrelevant passage'],
])
```

Note: Ollama does not support reranking models. Cross-encoder reranking must use transformers.js ONNX.

#### Matryoshka Embeddings

**How they work**: Trained with `MatryoshkaLoss` that applies contrastive loss at multiple dimensionalities (768, 512, 256, 128, 64) simultaneously. Forces important information to accumulate at the beginning of the vector.

**Practical benefit**: At 64 dims (8.3% of 768-dim model), retain ~98.4% of performance. Enables two-stage retrieval: fast ANN with small vectors, then re-score top-K with full vectors or cross-encoder.

**Implementation note for `nomic-embed-text-v1.5`**: Must apply layer normalization before truncating, not just slicing:
```typescript
const full = model.encode(text)     // 768-dim
const normed = layerNorm(full)      // normalize first
const truncated = normed.slice(0, 128) // then truncate
// L2-normalize the truncated vector for cosine similarity
```

---

## 3. Design: Brain v1.0

### 3.1 Core Principles

1. **Local-first** — everything runs on your machine by default. Remote LLM/embeddings are opt-in and treated as crossing a privacy boundary.
2. **Two-layer storage** — raw notes (documents + chunks) AND extracted memories (facts with versioning). Both are searchable.
3. **Zero-friction capture** — getting content into Brain should be as easy as piping text to stdin. Classification and extraction happen asynchronously.
4. **Incremental processing** — never re-index what hasn't changed. Content hashing, file watching, and status tracking.
5. **Composable search** — BM25 + vector + reranking + scoping + memory mode, all independently toggleable.

### 3.2 Data Model Changes

#### New: `memory_entries` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `memory` | TEXT | The extracted fact string |
| `memory_embedding` | BLOB | Vector embedding of the fact |
| `source_note_id` | TEXT FK | Which note this was extracted from |
| `source_chunk_id` | TEXT FK | Which chunk specifically |
| `container_tag` | TEXT | Namespace (project, context, etc.) |
| `is_latest` | BOOLEAN | Whether this is the current version |
| `parent_memory_id` | TEXT FK | Previous version of this fact |
| `root_memory_id` | TEXT FK | Original version in the chain |
| `relation_type` | TEXT | `updates \| extends \| derives` (relative to parent) |
| `valid_at` | DATETIME | When this fact became true |
| `invalid_at` | DATETIME | When this fact stopped being true |
| `forget_after` | DATETIME | Auto-expire date |
| `is_forgotten` | BOOLEAN | Whether auto-expired |
| `is_inference` | BOOLEAN | Whether derived by AI vs explicit |
| `created_at` | DATETIME | When extracted |

#### New: `memory_history` table (event log)

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `memory_id` | TEXT FK | Which memory changed |
| `event` | TEXT | `add \| update \| delete \| forget` |
| `old_memory` | TEXT | Previous value (null for add) |
| `new_memory` | TEXT | New value (null for delete) |
| `actor` | TEXT | Who/what made the change |
| `created_at` | DATETIME | When the change happened |

#### New: `inbox` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `content` | TEXT | Raw captured content |
| `source` | TEXT | Where it came from (`cli`, `rss`, `crawler`, `alert`, `api`) |
| `source_url` | TEXT | Original URL if applicable |
| `source_meta` | JSON | Feed name, alert query, crawler config, etc. |
| `status` | TEXT | `pending \| processing \| indexed \| failed \| discarded` |
| `created_at` | DATETIME | When captured |
| `processed_at` | DATETIME | When indexed |

#### Modified: `chunks` table additions

| Column | Type | Description |
|--------|------|-------------|
| `chunk_type` | TEXT | `heading \| paragraph \| code \| list \| blockquote` |
| `heading_ancestry` | TEXT | Full heading breadcrumb prepended to chunk |
| `cut_type` | TEXT | `heading_boundary \| paragraph_end \| semantic_split \| token_limit` |
| `position` | INTEGER | Order within parent document |

### 3.3 Ingestion Pipeline

```
Source -> Inbox -> Extract -> Chunk -> Embed -> Memory Extract -> Done
                    |                              |
                    v                              v
              content detection            fact reconciliation
              (markdown, code,             (ADD/UPDATE/DELETE
               URL, PDF, etc.)              against existing)
```

#### Sources (how content enters)

1. **`brain add`** — existing command, enhanced with `--container` flag
2. **`brain quick`** (new) — zero-frontmatter capture, just text. Classifies on next index.
3. **`brain inbox`** (new) — manage the inbox queue (list, process, discard)
4. **`brain ingest`** (new) — bulk import from:
   - RSS/Atom feed URL (`brain ingest --rss <url>`)
   - Directory of files (`brain ingest --dir <path> --glob "*.md"`)
   - URL list (`brain ingest --urls <file>`)
   - Stdin pipe (`curl ... | brain ingest --stdin`)
5. **`brain feed`** (new) — manage persistent feed subscriptions:
   - `brain feed add <url> --container <tag> --filter <prompt>` — subscribe to RSS/Atom feed
   - `brain feed list` — show subscriptions
   - `brain feed poll` — fetch new items from all subscriptions
   - `brain feed remove <id>` — unsubscribe
6. **Future**: API endpoint for programmatic ingestion (Google Alerts -> webhook -> brain)

#### Content Detection and Extraction

| Content Type | Detection | Strategy |
|---|---|---|
| Markdown | `.md`/`.mdx` extension | Parse frontmatter, preserve structure |
| Code | Language extensions | AST-aware via `code-chunk` |
| URL | `http(s)://` prefix | Fetch, strip boilerplate, extract article content |
| Plain text | Default fallback | Treat as prose |
| PDF | `.pdf` extension | Future: `unstructured` or similar |

#### Chunking Strategy

- **Markdown notes**: Heading-aware split with ancestry prepending (Khoj pattern), `@langchain/textsplitters` `MarkdownTextSplitter` as baseline, optional semantic splitting for long prose sections
- **Code files**: `code-chunk` for AST-aware splitting at function/class boundaries with contextualized headers
- **Plain text / inbox items**: `RecursiveCharacterTextSplitter` with sentence-aware boundaries
- **Chunk metadata**: Every chunk carries `chunk_type`, `heading_ancestry`, `cut_type`, `position`
- **Deterministic IDs**: UUID5 from chunk content for automatic deduplication (Cognee pattern)

#### Memory Extraction (the new layer)

Runs after embedding, uses LLM (Ollama local or remote):

1. For each newly indexed note/chunk, call LLM with fact extraction prompt -> list of atomic facts
2. For each fact, embed it and search existing `memory_entries` for semantic matches
3. Call LLM with reconciliation prompt (mem0 pattern) -> ADD/UPDATE/DELETE/NONE decision for each
4. For UPDATE: create new memory entry, chain via `parent_memory_id`, set `is_latest` on new, clear on old
5. Log every operation to `memory_history`
6. Optional: set `forget_after` for time-sensitive facts, `is_inference` for derived facts

### 3.4 Search Improvements

#### Search Modes

- **`brain search "query"`** — default hybrid (BM25 + vector over chunks, as today)
- **`brain search --mode memories "query"`** — search extracted facts only
- **`brain search --mode hybrid "query"`** — search both chunks and memories, merge by RRF
- **`brain search --rerank`** — apply cross-encoder reranking to top results
- **`brain search --scope tag:project-x --since 30d`** — narrow corpus before search

#### Embedding Improvements

- Switch to `nomic-embed-text-v1.5` with Matryoshka support
- Store 256-dim vectors by default (vs current full-dimension)
- Optional full-dim storage for high-priority notes
- Two-stage retrieval: fast ANN with 256-dim, optional re-score with full vectors

#### Cross-Encoder Reranking

- `@huggingface/transformers` with `Xenova/ms-marco-MiniLM-L-6-v2` (~90MB)
- Applied as post-processing step after BM25 + vector fusion
- Opt-in via `--rerank` flag or config default

### 3.5 Container Tags

Simple namespace isolation without schema changes:
- Every note and memory entry gets an optional `container_tag`
- Search is scoped to container(s) when specified
- Default container is `default` (backwards compatible)
- Use cases: per-project isolation, separating personal vs work, AI agent scoping

### 3.6 New Commands Summary

| Command | Description | Status |
|---------|-------------|--------|
| `brain quick` | Zero-friction text capture to inbox | Implemented |
| `brain inbox` | View/manage/discard inbox items | Implemented |
| `brain ingest` | Bulk file import to inbox | Implemented |
| `brain feed add/list/remove` | Manage feed subscriptions | Implemented |
| `brain feed poll` | Fetch new items from subscribed feeds | Not yet |
| `brain extract` | Extract memories from notes (Ollama) | Implemented |
| `brain memories list` | List active memories with filters | Implemented |
| `brain memories history <id>` | Show version chain for a memory | Implemented |
| `brain memories stats` | Memory count and expiry sweep | Implemented |
| `brain context <id>` | Related notes/memories/graph for a note | Implemented |
| `brain profile` | Generate agent context profile | Implemented |
| `brain tidy` | LLM-powered note cleanup suggestions | Implemented |
| `brain search --memories` | Search extracted memories alongside notes | Implemented |
| `brain search --rerank` | Cross-encoder reranking | Implemented |
| `brain index --inbox` | Process inbox items during indexing | Implemented |
| `brain index --extract` | Extract memories during indexing | Implemented |
| `brain index --watch` | File watcher for incremental re-indexing | Implemented |

---

## 4. Implementation Phases

### Phase 1: Better Chunking and Search (no LLM dependency) — DONE

- [x] Content-type-aware chunking (markdown heading-aware, `chunk_type` field)
- [x] Heading ancestry prepending on chunks (Khoj pattern)
- [x] Chunk metadata (`chunk_type`, `cut_type`, `position`)
- [x] Deterministic SHA256-based chunk IDs (adapted from Cognee's UUID5 pattern)
- [x] Cross-encoder reranking via `--rerank` (`Xenova/ms-marco-MiniLM-L-6-v2`)
- [ ] AST-aware code chunking via `code-chunk` (deferred — needs tree-sitter WASM integration)
- [ ] Matryoshka embedding support with `nomic-embed-text-v1.5` (deferred — current embedder works well)
- [ ] Scoped search `--scope` flag (partially done via existing `--tier`, `--tags`, `--category`, `--since` filters)

### Phase 2: Inbox and Ingestion — DONE

- [x] `brain quick` command — zero-friction text capture to inbox
- [x] `inbox` table (V4 schema migration) and `brain inbox` command
- [x] `brain ingest` — bulk file import to inbox
- [x] `brain feed add/list/remove` — persistent feed subscriptions
- [x] `brain index --inbox` — process pending inbox items into notes
- [x] Status tracking (`pending -> processing -> indexed/failed/discarded`)
- [ ] `brain feed poll` — actual RSS fetching (schema ready, fetch not implemented)
- [ ] Content-type detection for URLs, PDFs (deferred)

### Phase 3: Memory Extraction Layer — DONE

- [x] `memory_entries` and `memory_history` tables (V5 schema migration)
- [x] Ollama LLM client (`qwen2.5:3b` default) for fact extraction
- [x] Fact extraction prompt (extracts discrete facts from chunks)
- [x] Reconciliation prompt (ADD/UPDATE/DELETE/NONE against existing memories)
- [x] Memory versioning (`parent_memory_id`, `is_latest`, `root_memory_id`, `relation_type`)
- [x] Memory vector search (`memory_vectors` table, `brain search --memories`)
- [x] Container tags on memories (`--container` flag)
- [x] `brain extract` command (`--note`, `--all`, `--tag`)
- [x] `brain index --extract` — extract memories as part of indexing pipeline

### Phase 4: Temporal Intelligence — DONE

- [x] `valid_at`/`invalid_at` on memories (schema fields, set during extraction)
- [x] Automatic forgetting (`forget_after`/`is_forgotten`, sweep on access)
- [x] Temporal query support (`getMemoriesSince()`, `brain memories list --since`)
- [x] `brain memories history <id>` — version chain and event log
- [x] `brain memories list` — view active memories with filters
- [x] `brain memories stats` — count active memories, run expiry sweep
- [x] `brain context <id>` — related notes, memories, and graph relations

### Phase 5: Polish and Agent Integration — DONE

- [x] `brain tidy` — LLM-powered note cleanup suggestions via Ollama
- [x] `brain profile` — context profiles for agent system prompts (text/markdown/xml/json)
- [x] Watch mode (`brain index --watch`) — fs.watch with debounced re-indexing
- [ ] Background daemon for incremental indexing (deferred — watch mode covers the use case interactively)
- [ ] API endpoint for external integrations (deferred — CLI + stdin covers current needs)

---

## 5. Cross-Reference: Ideas by Source

| Idea | Source(s) | Phase | Status |
|------|-----------|-------|--------|
| Heading ancestry prepending | Khoj | 1 | Done |
| AST-aware code chunking | Supermemory (`code-chunk`) | 1 | Deferred |
| SHA256 deterministic chunk IDs | Cognee (adapted from UUID5) | 1 | Done |
| Cross-encoder reranking | Graphiti, Supermemory, LlamaIndex | 1 | Done |
| Matryoshka embeddings | Supermemory, LlamaIndex | 1 | Deferred |
| Scoped search | Reflect | 1 | Partial (via existing filters) |
| Zero-friction inbox | Mem.ai | 2 | Done |
| RSS/feed subscriptions | Original (inspired by Mem.ai inbox concept) | 2 | Done (schema + CRUD, no fetch) |
| Content-type detection | Supermemory, Unstructured | 2 | Deferred |
| Fact extraction prompts | mem0 | 3 | Done |
| ADD/UPDATE/DELETE reconciliation | mem0 | 3 | Done |
| Memory versioning chain | Supermemory, mem0 | 3 | Done |
| Container tags | Supermemory | 3 | Done |
| SQLite event-sourcing history | mem0 | 3 | Done |
| Bi-temporal `valid_at`/`invalid_at` | Graphiti | 4 | Done (schema + query) |
| Automatic forgetting | Supermemory | 4 | Done |
| Related notes context | Obsidian Smart Connections, Mem.ai Heads Up | 4 | Done |
| Watch mode / background indexing | Obsidian, Apple Intelligence | 5 | Done (watch mode) |
| Profile API for agents | Supermemory | 5 | Done |
| LLM note cleanup | Mem.ai Clean Up | 5 | Done |

### Deferred Items (future work)

| Item | Why Deferred | Prerequisite |
|------|-------------|-------------|
| AST-aware code chunking | Needs tree-sitter WASM, `code-chunk` has Effect.js dependency | Evaluate `code-chunk` bundle size |
| Matryoshka embeddings | Current embedder works well, optimization not urgent | Switch to `nomic-embed-text-v1.5` |
| Content-type detection | Markdown-only is sufficient for current use | Add URL/PDF support when needed |
| `brain feed poll` | Feed subscription schema is ready | Implement RSS/Atom XML parsing |
| Background daemon | Watch mode covers interactive use | Consider for server deployment |
| API endpoint | CLI + stdin covers current needs | Consider when external integrations needed |
