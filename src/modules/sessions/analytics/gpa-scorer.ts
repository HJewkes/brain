import type { OllamaClient } from '../../../services/ollama.js';

export interface GpaDimensions {
  goal: number | null;
  plan: number | null;
  action: number;
}

export interface AgentGpaScore {
  sessionId: string;
  gpa: number | null;
  dimensions: GpaDimensions;
  rationale: { goal?: string; plan?: string; action: string };
  scoredAt: string;
}

export interface GpaScoringInput {
  errorRate: number;
  frictionSignals: Array<{ type: string }>;
  toolCalls: Array<{ tool: string }>;
  taskRefs: string[];
  planPresent: boolean;
  outcome: string | null;
  assistantTexts: string[];
}

/**
 * Algorithmic Action score: 0–10.
 * Based on error rate and friction density relative to tool call count.
 * Returns 5.0 as a sentinel when there are no tool calls.
 */
export function computeActionScore(input: {
  errorRate: number;
  frictionSignals: Array<unknown>;
  toolCalls: Array<unknown>;
}): number {
  if (input.toolCalls.length === 0) return 5.0;
  const frictionDensity = input.frictionSignals.length / Math.max(input.toolCalls.length, 1);
  const raw = 1 - Math.min(1, Math.max(0, input.errorRate * 2 + frictionDensity));
  return raw * 10;
}

function buildContext(input: GpaScoringInput): string {
  const topTools = input.toolCalls
    .slice(0, 10)
    .map((t) => t.tool)
    .join(', ');
  const frictionSummary = input.frictionSignals.map((f) => f.type).join(', ') || 'none';
  const taskList = input.taskRefs.join(', ') || 'none';
  const lines = [
    `Tasks worked: ${taskList}`,
    `Plan present: ${input.planPresent}`,
    `Outcome: ${input.outcome ?? 'unknown'}`,
    `Top tools (first 10): ${topTools || 'none'}`,
    `Friction signals: ${frictionSummary}`,
    `Total tool calls: ${input.toolCalls.length}`,
  ];
  return lines.join('\n');
}

interface LlmScores {
  goal: number | null;
  goalRationale: string;
  plan: number | null;
  planRationale: string;
}

function parseLlmResponse(text: string): LlmScores {
  const result: LlmScores = {
    goal: null,
    goalRationale: '',
    plan: null,
    planRationale: '',
  };

  const goalMatch = text.match(/goal[^:]*:\s*([0-9]+(?:\.[0-9]+)?)/i);
  const planMatch = text.match(/plan[^:]*:\s*([0-9]+(?:\.[0-9]+)?)/i);
  const goalRationaleMatch = text.match(/goal rationale[^:]*:\s*(.+)/i);
  const planRationaleMatch = text.match(/plan rationale[^:]*:\s*(.+)/i);

  if (goalMatch) {
    const v = parseFloat(goalMatch[1]);
    result.goal = isNaN(v) ? null : Math.min(10, Math.max(0, v));
  }
  if (planMatch) {
    const v = parseFloat(planMatch[1]);
    result.plan = isNaN(v) ? null : Math.min(10, Math.max(0, v));
  }
  result.goalRationale = goalRationaleMatch ? goalRationaleMatch[1].trim() : '';
  result.planRationale = planRationaleMatch ? planRationaleMatch[1].trim() : '';

  return result;
}

const LLM_PROMPT_SYSTEM = `You are an evaluator scoring an AI coding agent session.
Score Goal (0-10): did the agent accomplish the stated task objectives?
Score Plan (0-10): did the agent follow a coherent plan, using skills and structured approaches?
Respond in exactly this format:
Goal: <number>
Goal rationale: <one sentence>
Plan: <number>
Plan rationale: <one sentence>`;

/**
 * Score a session using the Agent GPA framework.
 * Action score is algorithmic; Goal and Plan use LLM scoring.
 * Returns null for Goal/Plan when LLM is unavailable or times out.
 */
export async function scoreGpa(
  sessionId: string,
  input: GpaScoringInput,
  ollama: OllamaClient | null
): Promise<AgentGpaScore> {
  const actionScore = computeActionScore(input);
  const actionRationale = buildActionRationale(input);

  let goalScore: number | null = null;
  let planScore: number | null = null;
  let goalRationale = '';
  let planRationale = '';

  const hasTaskDescription = input.taskRefs.length > 0;

  if (ollama !== null) {
    const context = buildContext(input);
    const prompt = `Session context:\n${context}\n\nPlease score this session.`;

    try {
      const response = await Promise.race([
        ollama.generate(prompt, LLM_PROMPT_SYSTEM),
        new Promise<never>((_, reject) =>
          AbortSignal.timeout(30_000).addEventListener('abort', () =>
            reject(new DOMException('LLM timeout', 'TimeoutError'))
          )
        ),
      ]);

      const parsed = parseLlmResponse(response);

      if (!hasTaskDescription) {
        goalScore = null;
      } else if (parsed.goal === null) {
        console.warn('[gpa-scorer] LLM returned non-numeric Goal score; falling back to null');
        goalScore = null;
      } else {
        goalScore = parsed.goal;
        goalRationale = parsed.goalRationale;
      }

      if (parsed.plan === null) {
        console.warn('[gpa-scorer] LLM returned non-numeric Plan score; falling back to null');
        planScore = null;
      } else {
        planScore = parsed.plan;
        planRationale = parsed.planRationale;
      }
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
      console.warn(
        isTimeout
          ? '[gpa-scorer] LLM scoring timed out; Goal/Plan set to null'
          : '[gpa-scorer] LLM scoring failed; Goal/Plan set to null',
        isTimeout ? '' : err
      );
    }
  }

  const nonNullDimensions = [goalScore, planScore, actionScore].filter(
    (v): v is number => v !== null
  );
  const gpa =
    nonNullDimensions.length > 0
      ? nonNullDimensions.reduce((s, v) => s + v, 0) / nonNullDimensions.length
      : null;

  const rationale: AgentGpaScore['rationale'] = { action: actionRationale };
  if (goalRationale) rationale.goal = goalRationale;
  if (planRationale) rationale.plan = planRationale;

  return {
    sessionId,
    gpa,
    dimensions: { goal: goalScore, plan: planScore, action: actionScore },
    rationale,
    scoredAt: new Date().toISOString(),
  };
}

function buildActionRationale(input: GpaScoringInput): string {
  if (input.toolCalls.length === 0) return 'No tool calls recorded (sentinel score 5.0)';
  const frictionDensity = input.frictionSignals.length / Math.max(input.toolCalls.length, 1);
  return `Error rate ${(input.errorRate * 100).toFixed(1)}%, friction density ${frictionDensity.toFixed(2)}`;
}
