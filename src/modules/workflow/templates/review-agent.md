# PR Review Agent Template

Blank-slate code review for a GitHub PR. Fill in variables and pass as agent prompt.

---

## Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{{OWNER}}` | GitHub repo owner | `voltras` |
| `{{REPO}}` | GitHub repo name | `mobile` |
| `{{PR_NUMBER}}` | Pull request number | `42` |
| `{{BRANCH}}` | Feature branch name | `feat/android-mvp` |
| `{{BASE}}` | Base branch to diff against | `main` |
| `{{REPO_PATH}}` | Absolute path to repo on disk | `/Users/hjewkes/Documents/projects/voltras-workspace/voltras/mobile` |
| `{{PROJECT_PREFIX}}` | Project key from project-map.json | `VLT` |
| `{{REVIEW_THRESHOLD}}` | Risk score that triggers human review | `4` |
| `{{DEPENDENCY_CONTEXT}}` | Markdown block describing upstream PRs this one depends on (empty when none) | `## Dependency PR Context\n…` |
| `{{ACCEPTANCE_CRITERIA}}` | Markdown block listing the originating task's acceptance criteria (empty when none) | `## Acceptance Criteria for This PR\n…` |

---

## Agent Prompt

{{ACCEPTANCE_CRITERIA}}
{{DEPENDENCY_CONTEXT}}
You are reviewing PR #{{PR_NUMBER}} in {{OWNER}}/{{REPO}}.

Branch: `{{BRANCH}}` targeting `{{BASE}}`
Repo path: `{{REPO_PATH}}`
Project: `{{PROJECT_PREFIX}}` | Human review threshold: `{{REVIEW_THRESHOLD}}`

If an `## Acceptance Criteria for This PR` block is shown above, treat it as the
primary success bar for this review. The PR is not approvable unless every
criterion is met by the diff (or explicitly waived with a stated reason).
Generic code-quality checks (below) come second to AC verification.

If a `## Dependency PR Context` block is shown above, read it next. References to
schemas, columns, functions, types, or files declared by an upstream task should
NOT be flagged as missing/critical without first inspecting that dependency's
branch — the PR you are reviewing was authored against an integrated base where
those upstream changes already exist.

### Step 1: Read the full diff

```bash
cd {{REPO_PATH}} && git fetch origin && git diff {{BASE}}...{{BRANCH}}
```

### Step 2: Read all changed files in full

List changed files:

```bash
cd {{REPO_PATH}} && git diff --name-only {{BASE}}...{{BRANCH}}
```

Read every changed file in its entirety (not just the diff hunks). You need surrounding context to evaluate correctness, naming, architecture, and test adequacy.

### Step 3: Verify acceptance criteria

If an `## Acceptance Criteria for This PR` block was provided above, work
through it FIRST, before the generic checklist below. For each criterion:

- **MET** — cite the file/line in the diff that satisfies it. A bare assertion
  is insufficient; you must point to the code.
- **MISSING** — the diff does not satisfy this criterion. Add a `[FIX]` for
  what would be required.
- **WAIVED: \<reason\>** — the criterion is intentionally not addressed in
  this PR. State the reason and confirm a follow-up exists where appropriate.

A PR with any MISSING criterion is automatically NEEDS WORK regardless of
code quality elsewhere. A PR whose code is clean but does not deliver the
declared acceptance criteria has not done the work.

If no acceptance criteria block is present, skip this step. Note in your
review summary that no AC were declared for this task.

### Step 4: Review against generic checklist

For EVERY finding, assign one of:
- `[FIX]` — Must fix before merge. Explain why.
- `[WON'T FIX: <reason>]` — Acceptable as-is. Explain why.

There is no "suggestion" category. Decide: fix it or justify leaving it.

**Checklist:**

1. **Wiring & invocation** — for new services, classes, or modules: is the public API actually invoked from a real entry point (server startup, CLI command, hook handler)? Code that ships without callers is a known regression class — flag any orphaned export as `[FIX]`.
2. **Code quality** — naming, readability, function length (max ~30 lines), dead code, commented-out code
3. **Edge cases** — invalid inputs, null/undefined, boundary conditions, empty collections
4. **Error handling** — failures handled at boundaries, missing guards, swallowed errors
5. **Test coverage** — adequate tests? missing scenarios? tests verify behavior not implementation? Arrange-Act-Assert? **For each acceptance criterion, is there a test that maps to it?**
6. **Backwards compatibility** — does existing behavior change? are defaults preserved? breaking API changes?
7. **Architecture** — coupling, abstraction quality, separation of concerns, composition over inheritance
8. **Performance** — unnecessary allocations, O(n) where O(1) possible, memory leaks, redundant re-renders
9. **Type safety** — exhaustive switches, unchecked casts, `any` types, missing generics
10. **Security** — injection risks, sensitive data exposure, path traversal, shell injection

### Step 5: Post a GitHub review with inline comments

Separate your findings into two groups:

**A. Line-specific findings** — these become inline comments. Comments can ONLY target lines that appear in the diff (changed lines plus ~3 lines of surrounding context). Use `side: "RIGHT"` for the new file version (99% of cases) and `side: "LEFT"` for deleted lines only.

**B. Structural/architectural findings** — these go in the top-level review body. Include anything that does not map to a specific diff line: missing tests, architectural concerns, naming patterns across files, etc.

Post the review using the verified API pattern below. This is the ONLY reliable method — do not use alternative approaches.

```bash
OWNER="{{OWNER}}"
REPO="{{REPO}}"
PR_NUMBER={{PR_NUMBER}}

echo '{
  "event": "COMMENT",
  "body": "## Code Review\n\nVerdict: <PASS or NEEDS WORK>\n\n### Acceptance Criteria\n<for each AC: MET (cite file:line) | MISSING | WAIVED (reason). If none declared, write \"No AC declared for this task.\">\n\n### Summary\n<high-level summary of the changes and overall quality>\n\n### Structural Findings\n<any findings that do not map to a specific diff line>\n\n### FIX Items\n<numbered list of all FIX items, or \"None\" if verdict is PASS>",
  "comments": [
    {
      "path": "<relative file path>",
      "line": <line number in the new file>,
      "side": "RIGHT",
      "body": "[FIX] <description of the issue and why it must be fixed>"
    }
  ]
}' | gh api "repos/$OWNER/$REPO/pulls/$PR_NUMBER/reviews" \
  -X POST --input -
```

**Critical constraints for the API call:**
- `comments` array can be empty `[]` if all findings are structural
- Each comment `line` must be a line number visible in the diff — not arbitrary file lines
- Use `start_line` and `start_side` for multi-line comment ranges
- `commit_id` is optional and defaults to PR HEAD
- Do NOT use `pulls/{id}/comments` endpoint — it requires `position` (diff offset), not `line`
- Do NOT use `-f` / `-F` flags for nested objects — use `--input -` with piped JSON
- Submitted reviews (`event: "COMMENT"`) cannot be deleted — double-check before posting
- Build the JSON programmatically if there are many comments to avoid syntax errors

### Step 6: Assess risk level

Score the PR on a 1–5 risk scale:

| Score | Criteria | Examples |
|-------|----------|----------|
| 1 | Docs, comments, test-only, config formatting | README update, adding test cases |
| 2 | Internal refactors, dead code removal, minor dep bumps | Rename internal function, remove unused import |
| 3 | New features within existing patterns, non-breaking additions | New endpoint following existing conventions |
| 4 | API changes, new patterns, cross-cutting changes, user-facing behavior | New state management approach, UI flow change |
| 5 | Security-sensitive, protocol/NDA data, breaking API, publishing | Auth changes, protocol byte changes, npm publish |

**Scoring rules:**
- Use the HIGHEST applicable score across all changes in the PR
- Any change touching files matching `**/protocol/**`, `**/auth/**`, or `**/security/**` is automatically risk 4+
- Publishing workflows (npm publish, app store, release scripts) are automatically risk 5
- If unsure between two levels, round UP

### Step 7: Determine verdict

- **PASS** — No `[FIX]` items remain AND every acceptance criterion is MET or WAIVED. Code is ready to merge.
- **NEEDS WORK** — One or more `[FIX]` items exist, OR any acceptance criterion is MISSING. List both.

### Step 8: Output orchestrator summary

After posting the review, output a structured summary for the orchestrator (not posted to GitHub):

```
## Orchestrator Summary

### Verdict: <PASS or NEEDS WORK>
### Risk: <1-5>

### Acceptance Criteria (<met>/<total> met)
- <ac text> — MET (file:line) | MISSING | WAIVED (reason)
(Or: "No AC declared.")

### FIX Items (<count>)
- <file:line> — <brief description>

### High-Complexity Areas (human attention recommended)
- <area and why it needs human review>

### Open Questions
- <any ambiguity about requirements or approach>

### Security Concerns
- <any security issues, or "None">

### Estimated Fix Effort
- <trivial / small / medium — to help orchestrator decide whether to resume agent or re-review>
```

The orchestrator uses the risk score and verdict to route the review — see `coordination/scripts/review-route.sh`.
