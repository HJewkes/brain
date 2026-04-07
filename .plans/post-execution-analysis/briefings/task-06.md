# Task 06: Create post-execution-analyzer.ts

## Architectural Context

`src/modules/sessions/analytics/post-execution-analyzer.ts` is the pipeline orchestrator — it reads session metadata, maps it to `GpaScoringInput`, calls `scoreGpa`, writes an analysis brain note, updates skill counters, and optionally generates evolution suggestions. It also provides `sessionNoteMetaToScoringInput()` for JSONL re-analysis (EC-04) and `parsePrUrl()` (re-exported from aggregate.ts for AC-02).

## File Ownership

**May modify:**
- `src/modules/sessions/analytics/post-execution-analyzer.ts` (create)
- `__tests__/modules/sessions/analytics/post-execution-analyzer.test.ts`

**Must not touch:**
- `src/modules/sessions/analytics/gpa-scorer.ts` (Task 04)
- `src/modules/sessions/analytics/skill-counters.ts` (Task 05)
- `src/modules/sessions/hooks/session-analysis-handler.ts` (Task 07)

**Read for context (do not modify):**
- `src/modules/sessions/engine/aggregate.ts` — `aggregateSessionEvents()`, `parsePrUrl()`
- `src/modules/sessions/analytics/gpa-scorer.ts` — `scoreGpa`, `GpaScoringInput` (mock in tests)
- `src/modules/sessions/analytics/skill-counters.ts` — `updateSkillCounter` (mock in tests)

## Steps

### Step 1: Verify spec test exists
Confirm `__tests__/modules/sessions/analytics/post-execution-analyzer.test.ts` exists.
Run: `npm test -- post-execution-analyzer` — expected: ERR_MODULE_NOT_FOUND

### Step 2: Implement AnalysisResult interface and runPostExecutionAnalysis
```typescript
export interface AnalysisResult {
  sessionId: string; gpa: AgentGpaScore; analysisNoteSlug: string | null;
  skillCountersUpdated: string[]; evolutionSuggestionSlug: string | null;
}
```
Pipeline stages:
1. Load session metadata (via session-ops or direct DB lookup)
2. Map `SessionAnalytics` fields to `GpaScoringInput`
3. Call `scoreGpa(input, sessionId, taskDescription)`
4. Write analysis note: `module: sessions`, `type: analysis`, `visibility: private`; frontmatter: `session_id`, `gpa`, `outcome`; body: dimension rationale + friction summary (cap at 5 friction signals, 3 tool names — NF-02)
5. For each skill in `skillUsage`, call `updateSkillCounter` (session-level: 1 increment per skill)
6. If `dimensions.action < 6` && `frictionSignals.length > 3`: append "Evolution Suggestions" sub-section to analysis note (not a separate note)
7. Check for existing analysis note before writing (EC-03 idempotency — skip if exists and `force` not set)

### Step 3: Implement sessionNoteMetaToScoringInput for EC-04
```typescript
export function sessionNoteMetaToScoringInput(noteMeta: Record<string, unknown>): GpaScoringInput {
  // Maps: error_rate → errorRate, tool_calls (number) → toolCalls array (length only),
  // friction_count → frictionSignals, etc.
}
```

### Step 4: Run test to verify it passes
Run: `npm test -- post-execution-analyzer`
Expected: all tests pass (AC-09, AC-10, AC-11, EC-03, EC-04)

### Step 5: Commit
```
git add src/modules/sessions/analytics/post-execution-analyzer.ts __tests__/modules/sessions/analytics/post-execution-analyzer.test.ts
git commit -m "Add post-execution-analyzer.ts: pipeline orchestrator for GPA scoring and note writing"
```

## Success Criteria

- [ ] `npm test -- post-execution-analyzer` passes (AC-09, AC-10, AC-11, EC-03, EC-04)
- [ ] `npx eslint src/modules/sessions/analytics/post-execution-analyzer.ts` clean
- [ ] `npx tsc --noEmit` passes
- [ ] Analysis note < 5 KB (NF-02: cap friction signals, tool names)
- [ ] Evolution suggestions appended to analysis note (not separate note)

## Anti-patterns

- Do NOT modify files outside the ownership list
- Do NOT modify CLAUDE.md
- Do NOT add features beyond the steps
- Do NOT write evolution suggestion as a separate brain note — append to analysis note
