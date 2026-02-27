# Polish, Publish & Real-World Onboarding — Design

**Date:** 2026-02-27
**Status:** Approved
**Approach:** Option B — Minimal tooling + manual onboarding

---

## Context

The PM module is complete: 1,053 tests, zero lint/type issues, 5 user-facing docs, 4 validation checklists, setup command, orchestrator skill. The project is functionally ready but has accumulated documentation debt and minor code issues that should be resolved before publishing.

The user wants to:
1. Publish `@titan-design/brain` to npm as a clean public package
2. Onboard a real project on their work machine — multiple active areas within a monorepo, dozens of planning docs, meeting notes, PR stacks, Confluence access

## Phase 1: Polish & Publish

**Goal:** Clean npm publish of `@titan-design/brain` v0.4.0

### 1A: Documentation Polish

**README.md rewrite:**
- Accurate test count (1,053, not 380)
- Full feature list: core knowledge base + PM module + orchestrator
- CLI command table covering all 22 core commands + `brain pm` subcommands
- Quick-start section linking to `docs/pm-module/quickstart.md`
- Architecture overview (brief, links to detailed docs)
- Installation and global usage instructions
- Contributing section

**CLAUDE.md update:**
- Add module system to architecture section
- Add PM module to subsystems description
- Update command count and test count
- Add `brain pm` command table

**Stale doc fixes:**
- `note_relations` → `relations` table name in design docs (01, 02, review docs)
- Test counts in any doc that references "380 tests"

### 1B: Deferred Code Review Fixes

Priority items from `docs/review-deferred.md`:

| Item | File | Impact |
|------|------|--------|
| stdin fallback unreachable | `quick.ts` | Makes piping work |
| parseInt NaN guard | `memories.ts` | Silent data loss prevention |
| Mutually exclusive flags | `inbox.ts` | CLI UX |
| upsertChunks length assert | `note-repo.ts:127` | Data integrity |
| URL validation error | `feed.ts` | Error message quality |
| Dead ChunkType variants | `types.ts` | Type surface cleanup |
| Reranker excerpt truncation | `reranker.ts:29` | Search quality |
| extract.ts early init | `extract.ts` | Wasted resources |
| tidy.ts magic number | `tidy.ts` | Code quality |

### 1C: Test Gap Coverage

| Gap | File |
|-----|------|
| `rerank` option branch | `search.ts` |
| `forgetExpiredMemories` history | `memory-repo.ts` |
| Multi-chunk extraction | `memory-extractor.ts` |
| RRF fusion explicit test | `search.ts` |

### 1D: Publish Preparation

- Version bump: 0.3.0 → 0.4.0
- Verify `npm run build` produces clean `dist/cli.js`
- Verify `npm pack` includes correct files (check `files` field in package.json)
- Test global install: `npm install -g` and verify `brain` command works
- Verify `postinstall`/`preuninstall` scripts in `scripts/` work correctly
- Update CHANGELOG or release notes

### Phase 1 Success Criteria

- [ ] README accurate and comprehensive
- [ ] CLAUDE.md reflects current architecture
- [ ] All deferred code items addressed
- [ ] Test gaps filled
- [ ] `npm pack` produces clean tarball
- [ ] Global install works
- [ ] All tests pass, types clean, lint clean

---

## Phase 2: Real-World Onboarding

**Goal:** Onboard one real project from the work monorepo into brain PM, using minimal new tooling and letting real usage drive what to build next.

### Onboarding Flow

```
Phase 2A: Context Ingestion
  Bulk ingest markdown docs (existing capability)
  Manual PR review → markdown summaries
  Confluence access via MCP (if needed)
        │
        ▼
Phase 2B: Assisted Planning
  Chronological triage of ingested docs
  LLM-assisted task & decision extraction
  Human review and approval
  PM project structure creation
        │
        ▼
Phase 2C: Execution (already built)
  Orchestrator runs tasks
  Decision capture during execution
  Audit and telemetry
```

### 2A: Context Ingestion

**What already works:**
- `brain ingest --dir ./docs/planning/` — bulk import markdown files to inbox
- `brain index` — index notes with embeddings for search
- `brain search` — hybrid search across ingested corpus

**Manual steps (no new code needed):**
- Export Google Docs to markdown (already done)
- For PR stack: `gh pr list --json title,body,url,createdAt,state` → manually or script-convert to markdown notes
- For Confluence: use existing Confluence MCP server (atlassian skill already available) to fetch pages, save as markdown

**Optional new tooling (build only if friction warrants it):**
- `brain pm import-prs --repo owner/repo` — automate PR → markdown conversion
- Confluence bulk export script

### 2B: Assisted Planning

**The key challenge:** 30+ planning docs from different dates where later docs may supersede earlier decisions. Need temporal ordering and human judgment.

**Approach: LLM-assisted triage session**

This is a manual-but-guided process using existing brain capabilities:

1. **Sort by date**: Organize ingested docs chronologically
2. **Search for context**: `brain search "project vision"`, `brain search "architecture decisions"` to find relevant clusters
3. **Create project**: `brain pm init "Project Name" --prefix PRJ`
4. **Extract decisions**: Review docs in order, `brain pm decision add` for each architectural choice. Use `brain pm decision supersede` when later docs contradict earlier ones.
5. **Identify workstreams**: Group related work into 2-5 workstreams
6. **Extract tasks**: `brain pm task add` for each identified work item, with dependencies
7. **Review**: `brain pm waves` to see the dependency graph, `brain pm briefing` for overview

**Optional new tooling (build only if the manual process is too slow):**
- `brain pm onboard` — LLM-assisted command that:
  - Scans notes tagged with a project
  - Extracts candidate decisions and tasks
  - Presents for human approval
  - Creates PM entities from approved items

### 2C: Execution

Already fully built:
- `brain pm briefing` — project status
- `brain pm next` — eligible task selection
- Orchestrator skill — agent dispatch with routing, worktrees, verification
- `brain pm decision add` — capture decisions during execution
- `brain pm audit summary` — cost and progress tracking

### Phase 2 Success Criteria

- [ ] One real project onboarded with workstreams and tasks
- [ ] Existing planning docs ingested and searchable
- [ ] Key decisions captured with supersession chains
- [ ] At least one task dispatched via orchestrator
- [ ] Friction points documented for future tooling decisions

---

## What We're NOT Building Yet

These are explicitly deferred until real usage proves they're needed:

| Capability | Why deferred |
|-----------|-------------|
| `brain pm onboard` command | Manual process may be sufficient; build after trying manual |
| `brain pm import-prs` | `gh` + manual markdown may be enough |
| Confluence connector | MCP server already available; custom integration only if MCP insufficient |
| Slack integration | Not connected yet; address when connected |
| JIT context refresh | Designed in Stream 3 but deferred |
| Session continuity | Requires Claude Code SDK changes |

---

## Dependency Graph

```
Phase 1 (parallel workstreams):
  1A: Docs polish ──────────┐
  1B: Deferred fixes ───────┤
  1C: Test gaps ────────────┤
                             ▼
  1D: Publish prep ─────────── npm publish

Phase 2 (sequential, on work machine):
  2A: Context ingestion (manual + existing tools)
        │
        ▼
  2B: Assisted planning (manual + PM commands)
        │
        ▼
  2C: Execution (orchestrator)
```

Phase 1 tasks are parallelizable (different file sets). Phase 2 is sequential and happens on the work machine after Phase 1 ships.

---

## Estimated New/Modified Files

### Phase 1
| File | Type |
|------|------|
| `README.md` | Rewrite |
| `CLAUDE.md` (repo root) | Update |
| `docs/plans/pm-module/01-*.md` etc | Fix table name |
| `src/commands/quick.ts` | Fix |
| `src/commands/memories.ts` | Fix |
| `src/commands/inbox.ts` | Fix |
| `src/commands/feed.ts` | Fix |
| `src/commands/extract.ts` | Fix |
| `src/commands/tidy.ts` | Fix |
| `src/services/repos/note-repo.ts` | Fix |
| `src/services/reranker.ts` | Fix |
| `src/types.ts` | ChunkType cleanup |
| `__tests__/services/search.test.ts` | New tests |
| `__tests__/services/repos/memory-repo.test.ts` | New tests |
| `package.json` | Version bump |

### Phase 2
No new code files planned — manual onboarding using existing commands. New tooling only if friction warrants it.
