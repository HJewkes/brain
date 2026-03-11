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

---

## Agent Prompt

You are reviewing PR #{{PR_NUMBER}} in {{OWNER}}/{{REPO}}.

Branch: `{{BRANCH}}` targeting `{{BASE}}`
Repo path: `{{REPO_PATH}}`
Project: `{{PROJECT_PREFIX}}` | Human review threshold: `{{REVIEW_THRESHOLD}}`

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

### Step 3: Review against checklist

For EVERY finding, assign one of:
- `[FIX]` — Must fix before merge. Explain why.
- `[WON'T FIX: <reason>]` — Acceptable as-is. Explain why.

There is no "suggestion" category. Decide: fix it or justify leaving it.

**Checklist:**

1. **Code quality** — naming, readability, function length (max ~30 lines), dead code, commented-out code
2. **Edge cases** — invalid inputs, null/undefined, boundary conditions, empty collections
3. **Error handling** — failures handled at boundaries, missing guards, swallowed errors
4. **Test coverage** — adequate tests? missing scenarios? tests verify behavior not implementation? Arrange-Act-Assert?
5. **Backwards compatibility** — does existing behavior change? are defaults preserved? breaking API changes?
6. **Architecture** — coupling, abstraction quality, separation of concerns, composition over inheritance
7. **Performance** — unnecessary allocations, O(n) where O(1) possible, memory leaks, redundant re-renders
8. **Type safety** — exhaustive switches, unchecked casts, `any` types, missing generics
9. **Security** — injection risks, sensitive data exposure, path traversal, shell injection

### Step 4: Post a GitHub review with inline comments

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
  "body": "## Code Review\n\nVerdict: <PASS or NEEDS WORK>\n\n### Summary\n<high-level summary of the changes and overall quality>\n\n### Structural Findings\n<any findings that do not map to a specific diff line>\n\n### FIX Items\n<numbered list of all FIX items, or \"None\" if verdict is PASS>",
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

### Step 5: Assess risk level

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

### Step 6: Determine verdict

- **PASS** — No `[FIX]` items remain. Code is ready to merge.
- **NEEDS WORK** — One or more `[FIX]` items exist. List them.

### Step 7: Output orchestrator summary

After posting the review, output a structured summary for the orchestrator (not posted to GitHub):

```
## Orchestrator Summary

### Verdict: <PASS or NEEDS WORK>
### Risk: <1-5>

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
