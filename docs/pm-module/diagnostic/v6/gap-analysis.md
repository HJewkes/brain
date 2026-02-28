# Documentation Coverage Gap Analysis — V6

Analyzed: 2026-02-28
Scope: `/Users/hjewkes/Documents/projects/brain/` repo docs vs brain knowledge base (`~/brain/`)

---

## Available Documentation

### Brain Project PM Docs (`docs/pm-module/`)

| File path | Topic | Lines | Ingested |
|-----------|-------|-------|----------|
| `docs/pm-module/architecture.md` | PM internals: layers, data model, state machine, routing, templates, design decisions | 357 | **No** |
| `docs/pm-module/commands.md` | Complete `brain pm` command reference with flags and examples *(updated v6: +58 lines for virtual states, display ID syntax, plural aliases, onboard section)* | 1510 | **No** |
| `docs/pm-module/guide.md` | PM user guide: projects, workstreams, tasks, decisions, prompts, orchestration | 793 | **No** |
| `docs/pm-module/quickstart.md` | PM 10-minute setup walkthrough | 176 | **No** |
| `docs/pm-module/diagnostic-workflow.md` | Diagnostic loop procedure | 355 | **No** |
| `docs/pm-module/demo.md` | Demo script for PM module | 364 | **No** |
| `docs/pm-module/e2e-testing-strategy.md` | E2E and integration test design | 268 | **No** |
| `docs/pm-module/onboarding-observations.md` | Accumulated onboarding findings through V5 (V6 observations marked inline) | 750 | **No** |
| `docs/pm-module/test-bench-prompts.md` | Test bench prompt catalog | 247 | **No** |

### Brain Project PM Docs — Validation (`docs/pm-module/validation/`)

| File path | Topic | Lines | Ingested |
|-----------|-------|-------|----------|
| `docs/pm-module/validation/assisted-walkthrough.md` | Assisted mode walkthrough | 130 | **No** |
| `docs/pm-module/validation/orchestrator-walkthrough.md` | Orchestrator walkthrough | 144 | **No** |
| `docs/pm-module/validation/decision-capture.md` | Decision capture validation | 171 | **No** |
| `docs/pm-module/validation/skill-chain.md` | Skill chain validation | 159 | **No** |

### Brain Project PM Docs — Diagnostic Results (`docs/pm-module/diagnostic/`)

| File path | Topic | Lines | Ingested |
|-----------|-------|-------|----------|
| `docs/pm-module/diagnostic/v5/observations.md` | V5 diagnostic observations — 30+ labeled findings *(NEW since v5)* | 446 | **No** |
| `docs/pm-module/diagnostic/v5/summary.md` | V5 diagnostic summary | 107 | **No** |
| `docs/pm-module/diagnostic/v5/gap-analysis.md` | V5 gap analysis (this document's predecessor) | ~280 | **No** |
| `docs/pm-module/diagnostic/v4/observations.md` | V4 observations | 245 | **No** |
| `docs/pm-module/diagnostic/v4/summary.md` | V4 summary | ~80 | **No** |

### Brain Project Root Docs

| File path | Topic | Lines | Ingested |
|-----------|-------|-------|----------|
| `README.md` | Project overview and quick-start | 169 | **No** |
| `CLAUDE.md` | Project dev standards and architecture overview | ~130 | No (loaded as context only) |
| `docs/demos.md` | Brain CLI demo walkthroughs | ~367 | **No** |
| `docs/review-deferred.md` | Deferred review tracking | 73 | **No** |
| `skill/SKILL.md` | Published skill documentation | 70 | **No** |
| `templates/*.md` | Note templates (decision, meeting, note, research) | ~80 | **No** |

### Design Plan Docs (`docs/plans/`)

| File path | Topic | Lines | Ingested |
|-----------|-------|-------|----------|
| `docs/plans/2026-02-21-brain-vision-design.md` | Brain product vision and roadmap | 656 | **No** |
| `docs/plans/2026-02-22-init-resilience-design.md` | Init resilience design | 151 | **No** |
| `docs/plans/2026-02-22-research-skill-brainstorm-prompt.md` | Research skill brainstorm | 154 | **No** |
| `docs/plans/2026-02-22-research-skill-investigation-plan.md` | Research skill investigation | 186 | **No** |
| `docs/plans/2026-02-23-research-skill-design.md` | Research skill design | 575 | **No** |
| `docs/plans/2026-02-26-module-system-integration-tests-design.md` | Module integration tests design | 98 | **No** |
| `docs/plans/2026-02-27-pm-cli-fix-pass-design.md` | PM CLI fix pass design | 134 | **No** |
| `docs/plans/2026-02-27-pm-fix-pass-v2-design.md` | PM fix pass V2 design | 328 | **No** |
| `docs/plans/2026-02-27-polish-publish-onboard-design.md` | Polish/publish/onboard design | 233 | **No** |
| `docs/plans/2026-02-27-sanity-check-design.md` | Sanity check design | 393 | **No** |
| `docs/plans/2026-02-28-pm-onboard-design.md` | PM onboard command design | 440 | **No** |
| `docs/plans/2026-02-28-v6-diagnostic-fixes-design.md` | V6 diagnostic fix design *(NEW since v5)* | 302 | **No** |

### Design Plan Docs — PM Module Series (`docs/plans/pm-module/`)

| File path | Topic | Lines | Ingested |
|-----------|-------|-------|----------|
| `docs/plans/pm-module/00-overview.md` | PM module overview | 388 | **No** |
| `docs/plans/pm-module/01-brain-module-system.md` | Brain module system design | 1008 | **No** |
| `docs/plans/pm-module/02-pm-module-design.md` | PM module data model & CLI design | 1190 | **No** |
| `docs/plans/pm-module/03-orchestration-layer.md` | Orchestration layer design | 1199 | **No** |
| `docs/plans/pm-module/04-workflows-and-skills.md` | Workflows and skills design | 527 | **No** |
| `docs/plans/pm-module/2026-02-26-pm-module-stream2-design.md` | Stream 2 implementation design | 512 | **No** |
| `docs/plans/pm-module/2026-02-26-review-resolution-design.md` | Review resolution design | 276 | **No** |
| `docs/plans/pm-module/2026-02-26-stream3-orchestration-design.md` | Stream 3 orchestration design | 497 | **No** |
| `docs/plans/pm-module/2026-02-27-wrap-up-design.md` | Wrap-up design | 346 | **No** |
| `docs/plans/pm-module/research/methodologies.md` | PM methodologies research | 538 | **No** |
| `docs/plans/pm-module/research/orchestration-patterns.md` | Orchestration patterns research | 619 | **No** |
| `docs/plans/pm-module/research/tools-and-patterns.md` | Tools and patterns research | 1067 | **No** |
| `docs/plans/pm-module/reviews/05-design-review.md` | Design review 1 | 277 | **No** |
| `docs/plans/pm-module/reviews/06-review-resolutions.md` | Review resolutions | 270 | **No** |
| `docs/plans/pm-module/reviews/07-design-review-2.md` | Design review 2 | 369 | **No** |

### Voltras External Component Docs (via `brain pm onboard`)

| Doc | Source component | Ingested |
|-----|-----------------|----------|
| `architecture.md` | titan-design (ARCHITECTURE.md) | Yes |
| `bluetooth-protocol.md` | voltra-node-sdk | Yes |
| `changelog.md` | voltra-private | Yes |
| `claude.md` | titan-design (CLAUDE.md) | Yes |
| `migration.md` | voltra-private | Yes |
| `node.md` | voltra-node-sdk | Yes |
| `platform-adapters.md` | voltra-node-sdk | Yes |
| `react-native.md` | voltra-node-sdk | Yes |
| `readme.md` | titan-design + others (9 READMEs collapsed) | Yes |
| `voltra-vbt-autoregulation-spec.md` | voltra-private | Yes |
| `web.md` | voltra-node-sdk | Yes |

---

## Coverage Summary

| Category | Docs found | Ingested | Coverage |
|----------|-----------|----------|----------|
| PM module docs (`docs/pm-module/`) | 9 files, ~3,820 lines | 0 | **0%** |
| PM module validation docs | 4 files, 604 lines | 0 | **0%** |
| PM diagnostic results (v4–v6) | ~10 key files, ~1,500 lines | 0 | **0%** |
| Design plans — top-level (`docs/plans/`) | 12 files, ~3,650 lines | 0 | **0%** |
| Design plans — pm-module/ | 9 files, ~5,943 lines | 0 | **0%** |
| Design plans — research/ | 3 files, 2,224 lines | 0 | **0%** |
| Design plans — reviews/ | 3 files, 916 lines | 0 | **0%** |
| Project root docs | 6 files, ~889 lines | 0 | **0%** |
| Templates | 4 files, ~80 lines | 0 | **0%** |
| Voltras external docs | 11 notes | 11 | **100%** |
| **Total brain repo docs** | **~60 files** | **0** | **0%** |
| **Total all docs** | **~71 files** | **11** | **~15%** |

### Regression from V5

V5 reported ~35% coverage with 11 design plan docs and 2 PM user docs listed as ingested. The current database contains **zero** brain project self-documentation. All 61 indexed notes are VOLTR project data (7 workstreams, 41 tasks, 11 Voltras component docs, 2 project records).

The v5 "Yes" entries reflected a prior indexing state that was cleared between diagnostic cycles — likely during a `brain init` or database reset. The current state is a **full regression to 0% brain project doc coverage**.

---

## Major Gaps

### 1. `docs/pm-module/commands.md` (1510 lines) — CRITICAL, UPDATED IN V6

The command reference grew by 58 lines in the v6 fixes commit. New content covers:
- `--status blocked` virtual state filter (O-105 fix)
- Workstream display ID syntax (`WS-01`, `WS-02`) for `--workstream` flags
- Plural command aliases (`workstreams`, `tasks`, `waves`)
- Complete `brain pm onboard` section

None of this content is indexed. Agents writing v6 task prompts are working from stale memory or hallucination.

### 2. `docs/pm-module/architecture.md` (357 lines) — CRITICAL

Documents the state machine, virtual state computation (the `blocked` filter now fixed in v6), routing table, claim token semantics, and worktree budget. Without it, the v6-fixed behavior has no searchable documentation in the knowledge base.

### 3. `docs/pm-module/onboarding-observations.md` (750 lines) — CRITICAL

Updated in the v6 fixes commit: 11 observations marked `v6-fixed`, 1 marked `v6-partial`. This is the primary living record of six diagnostic cycles of accumulated findings. Zero of it is indexed.

**Impact**: Each new session starts from zero institutional knowledge. Agents can't distinguish resolved error patterns from active ones.

### 4. `docs/pm-module/diagnostic/v5/observations.md` (446 lines) — HIGH, NEW SINCE V5

Created during v5, not present in the v5 gap analysis. Contains 30+ labeled observations including the root causes for every v6 fix (O-103, O-104, O-105). Provides the evidence base for `2026-02-28-v6-diagnostic-fixes-design.md`.

**Impact**: Agents reviewing v6 changes can't access the observations that motivated them.

### 5. `docs/plans/2026-02-28-v6-diagnostic-fixes-design.md` (302 lines) — HIGH, NEW SINCE V5

The design spec for the current `feat/v6-fixes` branch. Documents each bug, approach, and behavioral change introduced in v6. All context for current work is injected via CLAUDE.md, not search.

### 6. Orchestration design series (03, 04, stream2, stream3, wrap-up) — HIGH

Five docs (~2,180 lines) covering the dispatch engine, routing, agent brief format, claim token protocol, and wave execution. Absent across all diagnostic cycles.

### 7. All top-level design plans (12 files, ~3,650 lines) — MEDIUM

Previously indexed in v5 via manual ingestion, now fully absent. Cover brain product vision, research skill design, init resilience, and onboard design.

### 8. Research docs and design reviews — MEDIUM

Three research docs (~2,224 lines) and three review docs (~916 lines) with design rationale and rejected alternatives. Absent across all diagnostic cycles.

---

## Root Causes

### 1. Database reset between diagnostic cycles (new in v6)

All previously indexed brain project docs were wiped. A `brain init`, database migration, or notesDir reconfiguration cleared the index between v5 and v6. This turned a partial gap into a complete coverage collapse.

`brain init` has no safeguard against destroying an existing index. There is no warning, no `--preserve-index` option, and no recovery path.

### 2. `brain pm onboard` targets external projects, not self

The onboard command ingests docs from the project under management (Voltras). When brain manages itself, there is no supported path to ingest the brain repo's own `docs/` directory via the onboard workflow. This structural blind spot has persisted since v4.

### 3. Manual ingestion is volatile by design

All brain project doc ingestion was ad hoc, undocumented, and session-specific. Any database operation that clears the index resets coverage to zero. Without a reproducible, scripted ingestion procedure, coverage can only degrade.

### 4. No coverage regression detection

`brain status` reports note counts without flagging drops from a prior state. `brain doctor` checks system health, not knowledge completeness. A 61 → 61 note count after a full reset looks identical to a stable state if the note composition changes entirely.

### 5. Living docs grow faster than re-ingestion happens

Between v5 and v6: `commands.md` +58 lines, `onboarding-observations.md` +304 lines, `diagnostic/v5/observations.md` created (446 lines new). Even if indexed in v5, all v6 updates would be stale. Brain has no mechanism to watch repo files for changes and re-index them.

---

## Recommendations

### Immediate (unblock current session)

```bash
# Critical — command reference with v6 additions
npx tsx src/cli.ts ingest docs/pm-module/commands.md

# Critical — architecture and state machine
npx tsx src/cli.ts ingest docs/pm-module/architecture.md

# Critical — accumulated institutional knowledge through V6
npx tsx src/cli.ts ingest docs/pm-module/onboarding-observations.md

# High — v5 observation evidence base
npx tsx src/cli.ts ingest docs/pm-module/diagnostic/v5/observations.md

# High — v6 fix design rationale
npx tsx src/cli.ts ingest docs/plans/2026-02-28-v6-diagnostic-fixes-design.md

# High — user guide and quickstart
npx tsx src/cli.ts ingest docs/pm-module/guide.md
npx tsx src/cli.ts ingest docs/pm-module/quickstart.md

# Medium — orchestration design
npx tsx src/cli.ts ingest docs/plans/pm-module/03-orchestration-layer.md
npx tsx src/cli.ts ingest docs/plans/pm-module/04-workflows-and-skills.md
```

### Short-term: `brain init` safeguard

Require `--force` confirmation when an existing index would be cleared:

```
brain init
→ Warning: 61 notes currently indexed. Re-initializing will clear all index data.
  Use --force to proceed, or --preserve-index to keep existing notes.
```

### Short-term: `brain ingest --dir` with coverage report

```bash
brain ingest ./docs/ --recursive --report
# Output: 60 files found, 0 already indexed, 60 added
```

### Medium-term: `brain pm onboard --self`

When brain is managing itself, allow targeting the brain repo's own `docs/pm-module/`:

```bash
brain pm onboard brain --self --docs-dir ./docs/pm-module
```

### Medium-term: `brain doctor --coverage <path>`

```
brain doctor --coverage ./docs
→ Found 60 files, 0 indexed (0%).
→ Critical gap: docs/pm-module/commands.md (1510 lines, not indexed)
→ Run: brain ingest docs/ --recursive
```

### Medium-term: repo file watch for re-indexing

Add a `brain watch --repo ./docs` mode or post-commit hook that re-indexes modified files in `docs/` automatically after each commit.
