# Planning Interview Guide

## When to Use

This guide is for the **orchestrator** (not a sub-agent). Use it during the interview phase of the planning workflow for **high-complexity** tasks. The orchestrator asks questions one at a time in the active session, not as a batch.

## Prerequisites

Before starting the interview:
- Research phase must be complete
- Read `.plans/{{PLAN_ID}}/research-brief.md` for context
- Have the task description ready: {{TASK_DESCRIPTION}}

## Interview Flow

Use the `AskUserQuestion` tool to ask each question **one at a time**. Wait for the answer before proceeding. Adapt follow-ups based on responses. Do not batch questions — each `AskUserQuestion` call should contain a single focused question.

### Core Questions

**1. Problem Framing**
> "What specific problem does this solve? What happens if we don't build it?"

Listen for: clarity of problem statement, urgency, impact scope.

**2. Constraints**
> "What can't change? What existing behavior must be preserved?"

Listen for: backward compatibility requirements, performance constraints, API contracts.

**3. Scope Boundary**
> "What's explicitly out of scope for this work?"

Listen for: feature creep risks, adjacent work that should be separate tasks.

**4. Success Criteria**
> "How will we know this works? What would you test manually?"

Listen for: testable conditions that become acceptance criteria.

**5. Prior Art**
> "Is there existing code that does something similar? Any patterns we should follow or avoid?"

Listen for: reusable code, anti-patterns from past experience.

### Research-Informed Follow-ups

Based on the research brief, ask targeted questions about:
- Knowledge gaps identified in research (ask the human to fill them)
- Competing approaches found (ask which direction the human prefers)
- Risks identified (ask about acceptable trade-offs)

Example: "Research found that [X approach] and [Y approach] are both viable. [X] is simpler but [Y] handles [edge case]. Which direction do you lean?"

### Complexity Reassessment

After the interview, reassess complexity:
- If answers reveal the task is simpler than expected: keep current complexity level (complexity only goes UP)
- If answers reveal cross-cutting concerns, new patterns, or architectural decisions not in the original description: escalate to high complexity
- If the human identifies prerequisites or decomposition needs: note for the decompose phase

## Recording Answers

Do NOT write answers to a file. Keep them in orchestrator context for passing to the design agent. The design agent receives interview answers as part of its {{INTERVIEW_ANSWERS}} variable.

## Output

After the interview, the orchestrator should have:
1. Validated assumptions from the research brief
2. Clear scope boundaries
3. Testable success criteria (raw, to be formalized in acceptance-criteria.md)
4. Complexity assessment (confirmed or escalated)
5. Any new research questions to investigate before design

If new research is needed, dispatch a targeted research agent before proceeding to design.
