# Design Review: Task Management Framework

**Date:** 2026-02-25
**Reviewer:** Claude (Sonnet)
**Documents reviewed:**
- 01-brain-module-system.md
- 02-pm-module-design.md
- 03-orchestration-layer.md
- 04-workflows-and-skills.md

**Research reviewed:**
- tools-and-patterns.md
- methodologies.md
- orchestration-patterns.md

**Codebase reviewed:**
- brain/src/types.ts, cli.ts, services/brain-db.ts, services/brain-service.ts, services/config.ts, CLAUDE.md

---

## Summary

The design series is ambitious, well-researched, and coherent at the conceptual level. Cross-document consistency is good — the docs build on each other correctly. The primary concerns are (1) a critical mismatch between the design's assumptions about the `notes` table and brain's actual schema, (2) several places where the design invents new infrastructure that brain already has (or that could be composed from existing parts), and (3) meaningful scope creep in v1 that should be deferred. The underlying architecture — module registry, namespace isolation, dependency DAG, orchestrator-as-skill — is sound.

---

## Issues

### Critical

**C1. The `notes` table has no `frontmatter` column — the dependency engine SQL will not work.**

Doc 02's eligible task query and impact analysis SQL rely on `json_extract(n.frontmatter, '$.status')` to read task status:

```sql
AND json_extract(n.frontmatter, '$.status') = 'pending'
AND json_extract(dep.frontmatter, '$.status') != 'done'
```

The actual `notes` table schema (brain-db.ts, schemaV1, line 202) has no `frontmatter` column. Brain parses frontmatter and stores each field in individual typed columns: `type`, `status`, `tags`, `summary`, `confidence`, etc. The `metadata` column exists but stores implementation-specific metadata, not the full frontmatter JSON.

This means:
- The SQL in doc 02's "Eligible Task Computation" and `onTaskComplete` will not execute.
- PM-specific fields (`mode`, `priority`, `workstream`, `number`, `depends_on`, `blocks`, `prompt_file`) have no column in `notes` and no storage path.

**Fix required:** The PM module needs either (a) its own `pm_tasks` table that mirrors PM-specific fields in SQL-queryable columns, or (b) a JSON blob column added to `notes` for module-owned extended fields. The simplest path: the `pm_tasks` table holds `(note_id, status, mode, priority, workstream_number, number, display_id)` with a FK to `notes.id`. Status queries operate on `pm_tasks`, not `notes`. This needs to be specified explicitly before implementation.

---

**C2. The `NoteType` enum is closed — PM types cannot be registered dynamically without forking core.**

`types.ts` declares `NoteType` as a closed union:
```typescript
export type NoteType = 'note' | 'decision' | 'pattern' | 'research' | 'meeting' | 'session-log' | 'guide';
```

The `NoteRecord` type stores `type: NoteType`. The module system design (doc 01) assumes modules register custom note types (`task`, `workstream`, `project`, `prompt`), but brain's indexer will reject or coerce any `type` value not in this enum during `frontmatterToRecord()` in `indexing.ts`.

Additionally, `VALID_NOTE_TYPES` is used for validation. There is no extension point.

**Fix required:** `NoteType` must be widened to accept module-owned types. The cleanest approach: add a `string & {}` escape hatch with runtime validation that defers to the module registry for unknown types. Alternatively, store module note types in a parallel column (`module_type TEXT`) and leave the base `type` column as a generic anchor (e.g., `type: 'note'` for all module notes, with `module_type: 'task'`). This is a core types.ts change and should be decided before implementation begins.

---

**C3. `withBrain()` in brain-service.ts does not match the design's proposed signature.**

Doc 01 proposes a module-aware `withBrain()` that takes `opts?: { configDir?, dbPath? }` and a `loadModules()` call. The actual `withBrain()` in `brain-service.ts` takes no options and has no module loading. More importantly, the design's `BrainContext` (returned by `withBrain`) adds a `modules` field — but there is no `BrainContext` type in the codebase; the existing helpers return a `BrainService` struct.

This is not a blocking issue for the module system design, but it means doc 01's code samples are illustrative rather than copy-paste-ready. The actual integration path requires touching `brain-service.ts` and adding the `configDir`/`dbPath` override options (which config.ts's `loadConfig` already supports but `withBrain` does not thread through).

---

### Important

**I1. `brain pm complete` returns impact data but the mechanism is unspecified.**

Doc 03 and doc 04 both show:
```typescript
const impact = JSON.parse(await bash(`brain pm task show ${taskId} --json`));
return { validationPassed, decisions, newlyEligible: impact.unblocked };
```

But `brain pm task show` is a task detail command — there is no `unblocked` field defined in any JSON schema in the docs. The `brain pm complete` command is supposed to "check unblocked tasks and return impact summary" (doc 02, orchestration commands section), but neither doc 02 nor doc 03 specifies what `brain pm complete --json` returns. The orchestrator code in doc 04 calls `brain pm task show` after `complete`, which is awkward — `complete` itself should return the impact.

The JSON output contract for `brain pm complete` needs to be defined alongside the other output schemas in doc 02. This is important because the orchestrator makes dispatch decisions based on this output.

---

**I2. The `CLAIMED` state from research is absent from the design's state machine.**

The orchestration-patterns research (section 4.1) identifies `CLAIMED` as essential: "only one process can transition a task from READY to CLAIMED — this must be enforced with a lock." Doc 02's state machine has `pending → ready → in-progress` with no `claimed` intermediate state. In a multi-agent scenario where two orchestrator sessions (or background agents) might simultaneously claim the same `ready` task, there is a race condition.

This matters most when parallel agents are dispatched (doc 03's parallel execution section). Two agents calling `brain pm next --mode agent` simultaneously could receive the same task. The design needs either a `claimed` state with optimistic concurrency, or a note that parallel dispatch is single-session-only (which is a valid and simpler constraint for v1).

---

**I3. Config type extension is not feasible without modifying `BrainConfig`.**

Doc 01 proposes storing module config under `config.modules.pm { ... }` in brain's config.json. But `BrainConfig` in `types.ts` is a typed interface with no `modules` field:
```typescript
export interface BrainConfig {
  notesDir: string;
  dbPath: string;
  embedder: EmbedderBackend;
  ollamaUrl?: string;
  ollamaModel?: string;
  fusionWeights: { bm25: number; vector: number; };
}
```

`config.ts`'s `loadConfig()` reads and spreads the JSON file, so unknown keys will be present at runtime, but the TypeScript type won't expose them without a type assertion or extension. The `ModuleContext.config` accessor would return a `BrainConfig` without the module's keys visible to TypeScript.

**Fix:** Add `modules?: Record<string, Record<string, unknown>>` to `BrainConfig`, or use a separate module config file. Needs to be explicit in doc 01.

---

**I4. Session-log note type conflict.**

Doc 03 specifies that the orchestrator writes session summary notes with `type: session-log` and `module: pm`. But `session-log` is already a first-class `NoteType` in brain's core (`types.ts` line 18). If a user also creates personal session logs outside the PM module, there is ambiguity: is a `session-log` a PM session or a personal journal entry? The `module: pm` frontmatter disambiguates at the application layer, but brain's type system treats both identically.

This is not broken, but it highlights that the PM module is reusing a brain-native type name for a module-owned concept — which conflicts with the namespace isolation principle in doc 01.

---

**I5. `brain pm prompt write` command is referenced in doc 04 but not defined in doc 02.**

Doc 04 (workflow 1, step 6) shows: `brain pm prompt write XX-NN.MM --content "..."`. Doc 02's CLI section lists `brain pm dispatch` and describes the prompt note type, but does not include a `brain pm prompt` subcommand set (list, show, write, update). The orchestrator needs to create prompt notes during project initialization, but the command for doing so is undefined.

Either add a `brain pm prompt` subcommand group to doc 02, or clarify that prompt notes are created directly with `brain note add` plus a template.

---

**I6. The `brain pm decision audit` command is referenced but not designed.**

Doc 04 (workflow 5) shows:
```bash
brain pm decision audit --project OC
# Uses brain memory extraction to find decision-like statements
```

This command is not listed anywhere in doc 02's CLI interface section. It's non-trivial — it requires running LLM extraction over completed task logs to find undocumented decisions. Including it in the workflow doc without specifying it in the data model doc is a gap that would cause scope creep during implementation.

---

**I7. `brain pm archive` is mentioned but not defined.**

Doc 04 (workflow 6, retrospective) ends with `brain pm archive OC`. No archive command is defined in doc 02. Brain core already has an `archive` command (`brain archive`), but whether `brain pm archive` calls that, does something different, or is simply a gap is unspecified.

---

**I8. The `hill_position` field is defined but the state machine does not include it.**

Doc 02 defines `hill_position: exploring | executing | done` as an optional task field, with a sample output format for `brain pm status`. However, the state machine section does not specify: how does `hill_position` relate to `status`? Is it set manually or computed? What transitions are valid? The `schema enforcement` section in doc 01 would flag it as an unvalidated optional field unless the task JSON Schema in doc 01 is updated. This is a minor inconsistency but should be clarified to prevent confusion during implementation.

---

### Minor

**m1. Identifier system inconsistency between docs 01 and 02.**

Doc 01 uses `pm:openclaw:08.02` as the fully qualified reference format in the frontmatter example. Doc 02 defines the display ID format as `OC-08.05` (project prefix + workstream.task). The frontmatter example in doc 01's `depends_on` array uses `pm:openclaw:08.02` (no project prefix, no dash), but doc 02's task frontmatter uses `OC-08.04` and `OC-07.04`. These formats need to be reconciled: the fully qualified format should use the display ID, e.g., `pm:openclaw:OC-08.02`.

---

**m2. `brain pm use` vs `brain pm use openclaw` — the `--all` flag is underspecified.**

Doc 01 defines: `brain pm use --all` sets module context without instance filter. It's unclear what this means in practice for search visibility: does it include all instances' `contextual` notes? If there are 3 projects in the PM module, does `--all` flood search with all of them? This needs a sentence of clarification in doc 01.

---

**m3. `brain-service.ts` design code imports `loadModules` — this function does not exist.**

The illustrative code in doc 01's `withBrain()` proposal calls `await loadModules(config, db, embedder)`. No such function is specified anywhere in doc 01. It's implied but needs to be defined: where does it live, how does it enumerate built-in modules, how does it handle a module whose `register()` throws?

---

**m4. `ModuleContext.onNoteDelete` is used in doc 01 but not declared in the `ModuleContext` interface.**

The cascade hooks section shows `ctx.onNoteDelete((noteId) => {...})` but `onNoteDelete` is not in the `ModuleContext` interface defined at the top of doc 01. Minor omission in the interface definition.

---

**m5. `brain pm next --json` return shape is not defined.**

Doc 03 says `brain pm next --json` returns "ranked list with rationale for each recommendation." No JSON schema is given, but the orchestrator parses this output. Doc 02 defines `brain pm status --json` and `brain pm dispatch --json` schemas in detail — the same should be done for `brain pm next --json`.

---

**m6. Doc 04's `processAgentOutput` function calls `checkValidation(output, dispatch.validation)` — this function is undefined.**

It's reasonable to leave implementation details loose in a design document, but `extractDecisions(output)` and `checkValidation()` are non-trivial NLP operations. Their strategies (regex, LLM, heuristics) are not discussed anywhere. At minimum, doc 04 should note that these require a separate design decision.

---

**m7. The `pm` skill (doc 04) has no defined SKILL.md structure.**

Doc 04 lists a `pm` skill (`/pm`) alongside the `orchestrator` skill, but unlike the `orchestrator` skill (which gets a full SKILL.md outline in doc 03), the `pm` skill has no content. If it's just a convenience wrapper for `brain pm` commands, say so. If it has its own logic, define it.

---

## Strengths

**Principled architecture.** The one-way dependency rule (modules depend on brain core; core never imports modules), the module registry lifecycle, and the `ModuleContext` as the sole API surface are all textbook plugin system design. The comparison to Obsidian and Grafana plugin systems in doc 01 is apt.

**Research is genuinely incorporated.** The design docs are not research-laundering — the methodology choices are traceable. Taskwarrior's UDA model informed the namespace isolation approach. Linear's human-readable ID format (`OC-08.05`) is directly adopted with credit. GTD's capture/clarify split maps cleanly to `brain pm capture` + `brain pm process`. The decision ADR pattern from orchestration-patterns research is implemented fully in doc 02's decision model, including supersession chains and impact arrays.

**The prompt staleness detection is clever and practical.** Using a content hash on the rendered prompt plus decision timestamps to detect when a prompt needs re-rendering is a concrete solution to a real problem (agents executing with stale context). This directly implements the research finding on "detecting invalidated assumptions."

**Context isolation discipline is excellent.** The `brain pm dispatch` design — bundling exactly the dependencies, decisions, and validation criteria an agent needs, with nothing extra — reflects the research's "clean spawn" principle well. The context tiers table in doc 03 (Always / Active / Reference / Archive) is particularly well-thought-out.

**State persistence outside the session is the right call.** By making brain the authoritative store for all state, the orchestrator has no single-session coupling. Session interruptions become trivial to recover from. This is the key architectural insight from the orchestration-patterns research (section 1.5 and 8).

**Soft protection before hard protection.** The data protection approach in doc 01 — warn first, block later as opt-in — is pragmatic and reduces friction during initial adoption. Most module users will be the module author themselves.

**Phased implementation.** All four docs break work into 4-6 ordered phases with clear deliverables and test coverage expectations. Phase 1 of each doc is minimal and testable independently. This is exactly the right structure for iterative delivery.

**The skill chain integration is well-thought-out.** The `brainstorming → writing-plans → PM → orchestrator` chain in doc 04 is a concrete UX story that makes the whole system feel designed as a whole rather than bolted together. Auto-loading the orchestrator skill when a PM project is active is the kind of zero-config UX that makes tools feel magical.

---

## Recommendations

### Before starting implementation

**R1. Resolve the `notes` schema mismatch (C1) first.** Design a `pm_tasks` table (or equivalent) that stores PM-specific queryable columns alongside a FK to `notes.id`. All PM dependency and status queries operate on `pm_tasks`, not `notes`. This table schema should be added to doc 02 as the canonical PM SQL layer. The frontmatter remains the source of truth for display and editing; the table is a computed index rebuilt on `brain index`.

**R2. Define how `NoteType` is extended (C2).** Either widen the union in `types.ts` or add a `module_type` column to `notes`. Write the decision as a section in doc 01. This decision affects the indexing pipeline, the markdown parser, and every place `VALID_NOTE_TYPES` is referenced.

**R3. Add the `CLAIMED` state or explicitly scope out concurrent dispatch (I2).** If v1 dispatch is single-session-only, say so in doc 02 and doc 03. If concurrent dispatch is required in v1, add `claimed` to the state machine with a note on how the DB transaction enforces exclusive claiming.

**R4. Define the `brain pm complete --json` output contract (I1).** Add a JSON schema to doc 02's Output Formats section. Include `unblocked` (tasks newly ready), `decisions` (captured), and `stalePropmt` (tasks whose prompts need re-rendering). The orchestrator in doc 03 and doc 04 depends on this.

### Scope to defer from v1

**R5. Defer `brain pm decision audit` (I6).** LLM-powered retroactive decision discovery from completed task logs is interesting but not necessary for the core workflow. It requires its own prompt engineering, LLM call management, and human approval UX. Move to Phase 7 or later.

**R6. Defer hill chart tracking (I8) unless clarified.** The `hill_position` field adds surface area (new field, validation rules, display logic, potential for stale values) without being part of any core workflow. It's a nice-to-have from Shape Up research. If included in v1, add it to the task schema in doc 01 with defined transitions; otherwise defer.

**R7. Defer session metrics and project health observability (doc 03, Metrics section).** Velocity tracking, throughput by mode, block rate, decision density, and WIP age are all valuable but require completing several phases of the PM module first. They add no capability to v1 execution; they describe it retrospectively. Defer to Phase 5+ of doc 03.

**R8. Defer external module distribution (doc 01, Open Questions #1).** npm-package modules add versioning, security review, and discovery surface area. Built-in modules only for v1 is the right call and is already noted in doc 01 as the plan. Just make sure the design decision is reaffirmed in the implementation guide when it is written.

### Gaps to fill before declaring design complete

**R9. Specify `brain pm prompt` subcommand (I5).** Add `brain pm prompt add`, `brain pm prompt show`, `brain pm prompt list` to doc 02's CLI section. Prompt notes are a core entity and need their own management surface.

**R10. Define `brain pm next --json` output schema (m5).** Add alongside `brain pm status --json` and `brain pm dispatch --json` in doc 02's Output Formats section.

**R11. Reconcile the fully qualified ID format (m1).** Pick one format for cross-module references and use it consistently in both docs. Recommendation: `pm:openclaw:OC-08.02` (module:instance:displayId).

**R12. Add `onNoteDelete` to `ModuleContext` interface (m4).** Minor, but the interface as written is incomplete.

### Research patterns not fully addressed

**R13. No retry/backoff design for agent failures.** Orchestration-patterns research (section 4.3) recommends exponential backoff with jitter and per-task-type retry limits. Doc 03's error handling specifies "max retries: 2" but no backoff. For v1 this is acceptable — but the design should acknowledge that transient vs non-transient errors require different handling (retry immediately vs wait).

**R14. The `NEEDS_REVISION` state from research (section 4.4) is not modeled.** The design collapses "agent output rejected by reviewer" into transitioning back to `pending`. Research identifies a separate `NEEDS_REVISION` state as valuable because it allows the task to carry revision feedback forward to the next agent attempt (separate from the original prompt). For v1 this is low priority, but worth a note in doc 02's Open Questions.

**R15. File ownership for parallel agents is not addressed.** Orchestration-patterns research (section 3.4) explicitly warns: "assign each parallel agent explicit ownership of the files it will modify." Doc 03 mentions parallel dispatch but has no mechanism for preventing two simultaneously dispatched agents from touching the same files. The `brain pm dispatch --json` output could include a `fileScope` array (files the agent is expected to modify) that the orchestrator uses to prevent conflicts. Defer to Phase 2 parallel dispatch, but note it.

---

## Coverage Assessment (against the stated checklist)

| Topic | Covered | Notes |
|-------|---------|-------|
| Brain isolation and scoping | Strong | Doc 01 is thorough. Visibility tiers are well-designed. |
| Brain module system | Strong | Registry, lifecycle, namespace isolation are complete. Config extension has the gap noted in I3. |
| Task management module primitives | Strong | Data model, state machine, dependency engine are solid. SQL gap (C1) is the main concern. |
| CLI for interacting with storage | Good | All key commands are specified. `brain pm prompt` missing (I5). `brain pm archive` gap (I7). JSON output contracts partially complete. |
| Brain extensions for state machine | Adequate | State machine is well-designed. `CLAIMED` state missing (I2). Relationship between `hill_position` and `status` unclear (I8). |
| Agent/user workflows | Strong | Doc 04 covers all four task modes thoroughly. Decision capture and propagation workflows are end-to-end. |
| Agent skills for CLI interaction | Adequate | Orchestrator skill is fully specified. PM skill is named but undesigned (m7). Skill chain integration is well-described. |
| Orchestration skills and layer | Good | Session lifecycle, parallel dispatch, model selection, error recovery are covered. Metrics/observability slightly over-specified for v1. |
