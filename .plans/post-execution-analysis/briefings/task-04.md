# Task 04: Create gpa-scorer.ts

## Architectural Context

`src/modules/sessions/analytics/gpa-scorer.ts` computes the Agent GPA score — three dimensions: Action (algorithmic from error rate + friction density), Goal (LLM-scored), Plan (LLM-scored). It accepts a narrow `GpaScoringInput` interface (not full `SessionAnalytics`) to keep coupling minimal. LLM calls use `AbortSignal.timeout(30_000)`; null is returned for Goal/Plan on timeout or Ollama unavailability.

## File Ownership

**May modify:**
- `src/modules/sessions/analytics/gpa-scorer.ts` (create)
- `__tests__/modules/sessions/analytics/gpa-scorer.test.ts`

**Must not touch:**
- `src/modules/sessions/analytics/post-execution-analyzer.ts` (Task 06)
- `src/modules/sessions/analytics/skill-counters.ts` (Task 05)

**Read for context (do not modify):**
- `src/services/ollama.ts` — Ollama client interface (mock in tests)
- `src/modules/sessions/types.ts` — session types

## Steps

### Step 1: Verify spec test exists
Confirm `__tests__/modules/sessions/analytics/gpa-scorer.test.ts` exists (unstashed in Task 01).
Run: `npm test -- gpa-scorer` — expected: ERR_MODULE_NOT_FOUND (file not yet created)

### Step 2: Create gpa-scorer.ts with interfaces and computeActionScore
```typescript
export interface GpaDimensions { goal: number | null; plan: number | null; action: number; }
export interface AgentGpaScore { sessionId: string; gpa: number | null; dimensions: GpaDimensions; rationale: { goal?: string; plan?: string; action: string }; scoredAt: string; }
export interface GpaScoringInput { errorRate: number; frictionSignals: Array<{ type: string }>; toolCalls: Array<{ tool: string }>; taskRefs: string[]; planPresent: boolean; outcome: string | null; assistantTexts: string[]; }
export function computeActionScore(input: { errorRate: number; frictionSignals: Array<unknown>; toolCalls: Array<unknown> }): number {
  if (input.toolCalls.length === 0) return 5.0; // sentinel: no tool calls
  const frictionDensity = input.frictionSignals.length / Math.max(input.toolCalls.length, 1);
  const raw = 1 - Math.min(1, Math.max(0, input.errorRate * 2 + frictionDensity));
  return raw * 10;
}
```

### Step 3: Implement scoreGpa with LLM scoring
- Build compact context string (~2000 tokens): task description, top 10 tool calls, friction signals, plan presence, outcome
- Submit structured prompt asking for Goal (0–10) and Plan (0–10) with one-sentence rationale each
- Wrap Ollama call with `AbortSignal.timeout(30_000)`; on timeout or error, Goal/Plan → null, emit `console.warn`
- If LLM response score is non-numeric (EC-05), fall back to null with `console.warn`
- If `taskDescription` is null, skip LLM call for Goal (return null), still attempt Plan
- GPA = arithmetic mean of non-null dimensions; if all null, GPA = null

### Step 4: Run test to verify it passes
Run: `npm test -- gpa-scorer`
Expected: all tests pass (AC-06, AC-07, AC-08, EC-01, EC-05)

### Step 5: Commit
```
git add src/modules/sessions/analytics/gpa-scorer.ts __tests__/modules/sessions/analytics/gpa-scorer.test.ts
git commit -m "Add gpa-scorer.ts: algorithmic Action + LLM Goal/Plan GPA scoring"
```

## Success Criteria

- [ ] `npm test -- gpa-scorer` passes (AC-06, AC-07, AC-08, EC-01, EC-05)
- [ ] `npx eslint src/modules/sessions/analytics/gpa-scorer.ts` clean
- [ ] `npx tsc --noEmit` passes
- [ ] Empty toolCalls returns 5.0 (not 0.0 or 10.0)
- [ ] LLM timeout/unavailability returns null Goal/Plan with console.warn

## Anti-patterns

- Do NOT modify files outside the ownership list
- Do NOT modify CLAUDE.md
- Do NOT add features beyond the steps
- Do NOT couple to full `SessionAnalytics` type — use `GpaScoringInput` only
