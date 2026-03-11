# Brainstorm: Present Design

Assisted-mode phase. Present the design section by section, getting approval after each.

---

## Context

- Topic: `{{TASK_DESCRIPTION}}`
- Project: `{{PROJECT_PREFIX}}`
- Chosen approach: (from propose phase)

## Instructions

Present the design incrementally. Cover these sections, scaled to complexity:

1. **Architecture** — Components, layers, data flow
2. **API / Interface** — Public contracts, types, signatures
3. **Data model** — State shape, storage, migrations
4. **Error handling** — Failure modes, recovery, user feedback
5. **Testing strategy** — What to test, how, coverage targets

After each section, ask: "Does this look right so far?"

If the user has concerns, revise before moving on. If something needs clarification, the workflow can loop back to interview.

## Completion

This phase is complete when all sections are approved.
Advance to write-doc.
