# PM Data Audit — voltras-workspace (VW)

**Date:** 2026-03-01
**Project:** voltras-workspace (prefix: VW)
**Brain version:** V8

---

## Summary Stats

| Entity Type        | Count | Field Completeness                                      |
|--------------------|-------|---------------------------------------------------------|
| Projects           | 1     | title ✓, prefix ✓, status ✓, body ✗ (empty shell)      |
| Workstreams        | 5     | title ✓, description ✓, status ✓ — all fields complete  |
| Tasks              | 47    | title ✓, priority ✓, category ✓, mode ✓, body ✓ (100%) |
| Research notes     | 11    | content ✓, module_instance ✗ (empty), project ✓ via metadata |
| Onboard manifest   | 1     | complete with phase log                                 |
| Relations          | 0     | no cross-note relations exist                           |
| Dependencies       | 0     | no task deps defined anywhere                           |

Total notes in DB: 65 (1 project + 5 workstreams + 47 tasks + 11 research + 1 manifest)
Total chunks: 267

---

## Task Quality

### Priority Distribution

| Priority | Count | % of total |
|----------|-------|------------|
| critical | 3     | 6.4%       |
| high     | 12    | 25.5%      |
| medium   | 20    | 42.6%      |
| low      | 12    | 25.5%      |

**Assessment:** Well-distributed. Not a monoculture. The pyramid (few critical, moderate high, many medium/low) is realistic. No tasks are missing a priority.

### Category Distribution

| Category       | Count |
|----------------|-------|
| implementation | 12    |
| infrastructure | 11    |
| research       | 10    |
| documentation  | 7     |
| testing        | 4     |
| design         | 2     |
| bug            | 1     |

**Assessment:** Good variety. All 7 categories are distinct and meaningful. No monoculture. Only 1 bug task is low but reflects the project state (mostly greenfield work).

### Body Completeness

All 47 task files have substantive body content:

- **Min:** 606 bytes (VW-02.06 — CI validation step)
- **Max:** 1,032 bytes (VW-04.06 — WebSocketBLEAdapter design)
- **Avg:** 806 bytes
- **Empty (< 50 bytes):** 0
- **Thin (50–200 bytes):** 0
- **Substantive (200+ bytes):** 47 / 47 (100%)

Every task body contains:
1. A paragraph-length description with context
2. An explicit "Acceptance criteria" checklist (3–6 bullet points)
3. A "Ref:" line pointing to relevant file paths in the codebase

**Assessment:** Excellent. Task bodies are among the highest quality in any PM dataset examined. Zero empty shells.

### Mode Distribution

| Mode        | Count |
|-------------|-------|
| auto        | 39    |
| interactive | 8     |

Interactive tasks are correctly limited to WS-01 (BLE hardware experiments requiring physical device access). Auto tasks span the remaining 4 workstreams covering pure software work. Mode assignment is appropriate.

### Dependency Coverage

**0 of 47 tasks have any dependency defined.**

No `deps:` / `dependencies:` / `blocked_by:` fields appear in any task frontmatter. The relations table in the database is completely empty (0 rows). All tasks have `+READY` and `+ELIGIBLE` virtual states, meaning the dependency engine has nothing to evaluate — every task appears runnable immediately.

This is the most significant structural gap in the dataset.

### Workstream Distribution

| Workstream | Tasks |
|------------|-------|
| VW-01 (BLE Protocol)       | 10 |
| VW-02 (Testing Infra)      | 10 |
| VW-03 (VBT Autoregulation) | 11 |
| VW-04 (SDK Release)        | 6  |
| VW-05 (DX & Docs)          | 10 |

Even distribution. VW-03 has 11 (the richest workstream) and VW-04 has 6 (narrowest). No workstream is a stub.

---

## Note Quality

### Research Notes (Ingested Docs)

11 notes of type `research` were created from 20 ingested documents:

| Note Title                        | Chunks | Content Size |
|-----------------------------------|--------|--------------|
| voltra_vbt_autoregulation_spec    | 46     | 25,084 bytes |
| react-native                      | 26     | 19,266 bytes |
| web                               | 20     | 12,949 bytes |
| ARCHITECTURE                      | 22     | 9,575 bytes  |
| node                              | 17     | 9,005 bytes  |
| README                            | 27     | 7,547 bytes  |
| platform-adapters                 | 19     | 6,271 bytes  |
| CLAUDE                            | 13     | 5,383 bytes  |
| bluetooth-protocol                | 7      | 4,081 bytes  |
| MIGRATION                         | 6      | 3,647 bytes  |
| CHANGELOG                         | 8      | 2,685 bytes  |

**Content depth:** All 11 research notes are substantive — minimum 2,685 bytes with real content (no empty shells). The VBT spec (25KB, 46 chunks) is the most valuable single document in the project.

**README deduplication issue:** The manifest records 10 README.md files ingested (from 4 repos × multiple packages), but only 1 `readme.md` exists on disk. This is a slug collision — all 10 were written to the same path sequentially, with only the last surviving. The surviving README is titan-design's, but the 9 others (node-sdk, voltra-private, workout-analytics READMEs) were silently discarded. The brain status confirms `research=11` notes total, not 20.

**`module_instance` field is empty on all notes.** Tasks, workstreams, research notes, and the project note all have `module_instance = NULL` in the DB. The PM module stores project affiliation in `metadata.project = 'VW'` (a JSON field) instead of the `module_instance` column. This is a schema design choice, not a data entry error, but the column is unused.

### Links Between Research Notes and Tasks

**Zero cross-note relations exist.** The `relations` table has 0 rows. Research docs and tasks are in the same module namespace (`pm`) but are not formally linked. Task bodies contain plain-text `Ref:` lines pointing to codebase file paths, not to brain note IDs. The `context` command surfaces related notes via vector similarity search at runtime — this works correctly (verified by running `brain pm context VW-01.01`), but there is no static graph to audit.

---

## Data Issues

1. **No task dependencies defined.** All 47 tasks are `+READY` and `+ELIGIBLE` simultaneously. The dependency wave engine is entirely bypassed. Clear ordering constraints exist but are not encoded: VW-03.01 (ExerciseModel interface) should block VW-03.02 (EWMA state machine); VW-01.01 (broken test imports) should block VW-02.06 (CI setup); VW-02.02 (testing subpath export) should block VW-02.01 (integration tests). Without deps, dispatch cannot sequence work correctly.

2. **README slug collision lost 9 of 10 ingested READMEs.** The onboard manifest records "20 docs ingested" but only 11 research notes exist in the DB. Nine README files from different repos shared the same `readme` slug and were silently overwritten. Only the titan-design README survived. This is the largest information loss in the dataset.

3. **Project note body is empty.** `project.md` contains only the frontmatter and a bare `# voltras-workspace` heading with no body text. There is no project-level description, goals, or repo inventory in the project note itself.

4. **`module_instance` column unused across all 65 notes.** If future namespace isolation or multi-project scoping relies on this column, it will return empty results. The PM module uses `metadata.project` instead, which is a non-indexed JSON field.

5. **Research notes not formally linked to tasks.** 11 research docs have no `relations` rows connecting them to the tasks or workstreams they informed. Cross-references exist only as plain text in task `Ref:` lines.

6. **No wave assignments.** The wave/dependency subsystem was not invoked during setup. All tasks are implicitly wave-0 (all equally eligible). For a 47-task project with clear ordering constraints in WS-03, this is a missed opportunity for phased dispatch.

7. **WS-04 may be under-scoped.** VW-04 has 6 tasks vs. 10–11 for other workstreams. The WebSocketBLEAdapter design task (VW-04.06) is large enough to warrant a design subtask and an implementation subtask. Similarly, the npm publish task (VW-04.01) bundles automation setup, semantic versioning, and CI wiring into a single ticket.

---

## Recommendations

### For the Setup Agent (Next Run)

1. **Define dependency graph before task creation.** Before writing task files, identify ordering constraints and assign `deps: [VW-XX.YY, ...]` in task frontmatter. At minimum: persistence/interface tasks before implementation tasks in WS-03; test import fix before CI setup in WS-01/WS-02.

2. **Use component-scoped slugs for multi-repo ingestion.** When ingesting docs that share generic names (README.md, CHANGELOG.md), derive the slug from the component name: `node-sdk-readme`, `voltra-private-readme`, etc. The current behavior silently discards slug collisions.

3. **Populate project note body.** Add an executive summary to `project.md`: what the project is, its goals, the 4 repos involved, and links to the 5 workstreams. This surfaces correctly in project-level context assembly.

4. **Assign waves after task creation.** After all tasks are written, run a wave assignment pass grouping tasks by dependency depth. This enables the dispatch system to surface only unblocked wave-1 tasks to agents initially.

5. **Create informs relations from research to workstreams.** After ingestion, create explicit `relations` rows of type `informs` linking research notes to the workstreams they underpin (e.g., `voltra_vbt_autoregulation_spec → VW-03`, `bluetooth-protocol → VW-01`). This makes context assembly deterministic.

6. **Split large tasks.** VW-04.06 (WebSocketBLEAdapter) and VW-03.05 (workout planner module) each cover a full new module and should be split into a design task and an implementation task.

7. **Clarify `module_instance` usage.** Investigate whether PM notes should set `module_instance = 'VW'` on all notes for proper namespace scoping. If not, document that `metadata.project` is the canonical field for PM namespace isolation.
