# PM Data Audit — VOLTR Project (2026-02-28)

Audit of what was actually created by the `brain pm onboard` setup agent vs what a well-structured PM project should contain.

---

## Summary Stats

| Entity | Count | Field Completeness |
|---|---|---|
| Projects | 1 | 100% required fields; body = title echo only |
| Workstreams | 7 | 100% required fields; bodies = description paragraph (adequate) |
| Tasks | 41 | 100% required fields; **body: 0%** — all empty |
| Research docs | 11 | 100% ingested; titles = filename stems (low quality) |
| Onboard manifest | 1 | Complete |
| Decisions | 0 | — |
| Prompts | 0 | — |
| Activities | 0 | — |
| PM relations | 0 | — |

---

## Task Quality

### Priority Distribution

| Priority | Count | % |
|---|---|---|
| high | 22 | 54% |
| medium | 13 | 32% |
| critical | 5 | 12% |
| low | 1 | 2% |

**Assessment:** Heavy clustering at `high` (54%). The distribution is technically varied but the spread is uninformative — "high" is the default fallback. Only 5 tasks earned `critical` despite the workstream descriptions indicating multiple blocking gaps. `low` used only once (VOLTR-07.05).

### Category Distribution

| Category | Count |
|---|---|
| testing | 12 |
| research | 9 |
| implementation | 7 |
| infrastructure | 5 |
| documentation | 4 |
| bug | 2 |
| design | 2 |

**Assessment:** Good categorical variety. The categories accurately reflect the workstream themes (WS1-2 are research-heavy, WS3-4 are testing/infrastructure, WS5-7 are mixed). No monoculture issues.

### Body Completeness

**0 of 41 tasks have a substantive body (0%).**

Every task note follows this pattern:
```
---
[frontmatter]
---

# <title repeated verbatim>
```

No task contains:
- Acceptance criteria
- Implementation notes or approach guidance
- References to relevant research docs
- Links to specific files or code locations
- Scope / out-of-scope bounds
- Known risks or blockers (beyond the `depends_on` field)

Task content directories (`VOLTR-XX.YY/`) were created for all 41 tasks but are **entirely empty** — no `context.md`, `notes.md`, or any other artifact.

### Dependency Coverage

9 of 41 tasks have explicit dependencies (22%). All are shallow one-level chains:

| Task | Depends On |
|---|---|
| VOLTR-01.06 | VOLTR-02.01 |
| VOLTR-02.06 | VOLTR-02.01 |
| VOLTR-03.09 | VOLTR-03.01 |
| VOLTR-03.10 | VOLTR-05.01 |
| VOLTR-04.07 | VOLTR-04.01 |
| VOLTR-05.08 | VOLTR-05.02 |
| VOLTR-05.09 | VOLTR-05.05, VOLTR-05.02 |
| VOLTR-06.06 | VOLTR-04.04 |
| VOLTR-07.06 | VOLTR-04.01 |

Wave analysis produces only 2 waves (wave 0: 32 tasks, wave 1: 9 tasks), meaning most tasks are structurally parallel with no ordering. This is plausible for a research/verification project, but suggests the agent did not model logical sequencing within workstreams (e.g., protocol analysis tasks in WS1-2 could be ordered).

### Mode Distribution

**All 41 tasks are `mode: auto`.** This is incorrect for several tasks that require human action by definition:
- `VOLTR-02.05` — "Engage Voltra vendor for protocol documentation or NDAs" (requires a human to email/call a vendor)
- `VOLTR-01.02` — "Validate sequence number behavior under real BLE sessions" (requires physical hardware)
- `VOLTR-01.04` — "Verify isokinetic mode confirmation notification on device" (requires physical hardware)
- `VOLTR-01.06` — "Verify 19-byte vs 21-byte chain command length on hardware" (requires physical hardware)
- Any task requiring an app running on real iOS/Android devices (WS6)

### Number Gaps

Task numbers are non-contiguous across all 7 workstreams:

| WS | Present | Missing |
|---|---|---|
| 1 | 2,3,4,5,6 | **1** |
| 2 | 1,2,4,5,6 | **3** |
| 3 | 1,3,4,5,7,8,9,10 | **2, 6** |
| 4 | 1,3,4,5,6,7 | **2** |
| 5 | 1,2,5,6,7,8,9 | **3, 4** |
| 6 | 1,2,4,5,6 | **3** |
| 7 | 1,3,4,5,6 | **2** |

13 gaps total. These were likely removed tasks or re-sequenced ideas from the setup agent's planning phase that were not renumbered. The gaps make sequential numbering meaningless for humans trying to understand progression within a workstream.

---

## Note Quality

### Research Docs (11 ingested)

| Doc | Lines | Quality |
|---|---|---|
| react-native.md | 746 | Substantive |
| voltra-vbt-autoregulation-spec.md | 602 | Substantive |
| web.md | 432 | Substantive |
| node.md | 355 | Substantive |
| readme.md | 330 | Generic |
| architecture.md | 314 | Substantive |
| platform-adapters.md | 207 | Substantive |
| claude.md | 144 | Adequate |
| migration.md | 126 | Adequate |
| bluetooth-protocol.md | 105 | Thin |
| changelog.md | 65 | Thin |

**Titles:** All titles are filename stems (`CHANGELOG`, `README`, `ARCHITECTURE`). These are not useful in a multi-repo context where every component has a README. The onboard manifest shows 20 docs were discovered across 4 components, but only 11 were ingested (9 README variants were reduced to 1 via score deduplication), losing component-specific READMEs.

**Linkage:** Research docs are linked to the project via `metadata.project = 'VOLTR'` but `module_instance` is null for all of them. The relation table has **0 entries** in the PM namespace — no task-to-doc or task-to-task relations exist in the graph layer. Linkage is only via `depends_on` frontmatter on tasks.

### Workstream Notes (7)

All workstream notes contain a meaningful one-paragraph description body. Adequate as navigation aids. No issues.

### Project Note

The project note (`project.md`) body is:
```
# voltras-workspace
```

No project-level summary, goals, in-scope repos, or cross-cutting concerns.

---

## Data Issues

1. **All 41 task bodies are empty shells.** The setup agent created valid frontmatter but wrote no body content. Tasks have zero acceptance criteria, no approach notes, no file references, and no scope definition. An agent dispatched on any of these tasks will have nothing but the title to work from.

2. **All 41 task content directories are empty.** The `VOLTR-XX.YY/` directories exist but contain no files. These appear to be pre-created stubs with no artifact.

3. **All 41 tasks are `mode: auto`.** At minimum 5-6 tasks require human interaction (physical device testing, vendor outreach) and should be `mode: manual`.

4. **0 decisions recorded.** The codebase has documented architectural choices (BLE protocol design, session key structure, ReplayBLEAdapter approach, Epley e1RM limitations) that should be captured as decisions with rationale for agent context.

5. **0 prompts created.** No reusable agent dispatch templates were created, so every `brain pm dispatch` invocation starts cold.

6. **0 activities logged.** No history of what happened during setup.

7. **0 PM-namespace relations.** No links between tasks and supporting research docs, and no links between related tasks beyond `depends_on` frontmatter.

8. **13 task number gaps across 7 workstreams.** Non-contiguous numbering (e.g., WS3: 1,3,4,5,7,8,9,10) makes workstream navigation confusing, implying missing in-progress work rather than intentional exclusions.

9. **Project note has no body.** The root project note only echoes the title.

10. **Research doc titles are filename stems.** `CHANGELOG`, `README`, `ARCHITECTURE` are not useful for search or disambiguation in a multi-repo project.

11. **9 component READMEs reduced to 1 during ingestion.** Component-specific READMEs for `node-sdk`, `voltra-private`, `titan-design`, and `workout-analytics` contain unique information that is now absent. Score-based deduplication discarded them.

12. **`module_instance` is null on all research docs.** They're linked to the project only via metadata JSON, not via the DB column. This may affect queries that filter by `module_instance`.

---

## Recommendations

What the setup agent (`brain pm onboard`) should do differently:

1. **Write substantive task bodies.** For each task generate at minimum: (a) a 2-3 sentence description of what "done" looks like, (b) acceptance criteria as a bullet list, (c) references to relevant research docs or code files. Empty bodies are the single largest data quality gap.

2. **Set `mode: manual` for human-only tasks.** Classify tasks that require physical hardware, external communication, or human judgment as `mode: manual` during planning.

3. **Number tasks sequentially from 1.** If a task is excluded from the plan, renumber the survivors. Non-contiguous numbering implies missing work.

4. **Record key decisions.** During analysis, identify known architectural decisions and create decision records with `status: decided` and a rationale. These are high-value for agent context.

5. **Create links between tasks and research docs.** After ingesting docs, add `related_to` or `context_from` links from tasks to the docs they'll need. This makes `brain pm context <id>` much more useful.

6. **Ingest component-specific READMEs separately.** Don't deduplicate across components — prefix the title with the component name (e.g., `node-sdk README`, `titan-design README`). Each component's README is a distinct document.

7. **Give research docs descriptive titles.** Derive from the component path + filename or from the first H1. Avoid bare filename stems.

8. **Write a minimal project note body.** Include: what the project is, which repos are in scope, current phase/focus, and any cross-cutting constraints.

9. **Don't create empty content directories.** Either populate `VOLTR-XX.YY/context.md` with supporting context at creation time, or skip the directory until there's content to put in it.

10. **Create 1-2 starter prompts.** A default dispatch prompt template for `auto` tasks would make the PM loop immediately usable.
