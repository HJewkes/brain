import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdvisorRequest {
  question: string;
  context?: string;
  maxTokens?: number;
}

export interface AdvisorReviewRequest {
  focus?: string;
  context: string;
  maxTokens?: number;
}

export interface AdvisorResponse {
  advice: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    durationMs: number;
  };
}

interface ClaudeJsonOutput {
  result: string;
  is_error: boolean;
  duration_ms: number;
  total_cost_usd: number;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const ADVISOR_SYSTEM_PROMPT = `You are a strategic advisor for a software engineering coordinator agent. Your role is to provide concise, actionable guidance — not to implement anything yourself.

Rules:
1. Answer with enumerated steps or bullet points, not paragraphs
2. Be direct — state the recommended action first, then brief rationale
3. If the question involves trade-offs, list options with pros/cons in 1–2 lines each
4. Flag risks or blockers the coordinator should address
5. Stay within the coordinator's domain — do not suggest manual human actions unless asked`;

const REVIEW_SYSTEM_PROMPT = `You are a strategic advisor performing a full review of an autonomous software engineering operation. You have been given assembled context about the current state of work.

Produce a structured review with these sections:

## Assessment
What's working well and what isn't. Be specific — cite task IDs, agent names, or concrete observations.

## Action Items
Numbered list of specific, actionable steps the coordinator should take next. Each item should be immediately executable.

## Risk Flags
Things that could go wrong in the next wave or dispatch cycle. Include: dependency conflicts, resource constraints, stalled work, patterns of failure.

## Recommended Next Steps
Ordered priority list of what to do next, considering the current wave state and any blockers.

Rules:
1. Be concrete — reference specific task IDs and agent statuses from the context
2. Prioritize action items by impact
3. Flag any tasks that appear stuck or have been in-progress too long
4. If you see repeated failures, suggest a different approach
5. Keep each section concise — no more than 5-7 items per section`;

// ---------------------------------------------------------------------------
// Claude binary resolution (mirrors dispatch.ts pattern)
// ---------------------------------------------------------------------------

let _claudePath: string | null = null;

function getClaudePath(): string {
  if (_claudePath) return _claudePath;
  const candidates = [
    join(homedir(), '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      _claudePath = p;
      return p;
    }
  }
  try {
    _claudePath = execSync('which claude', { encoding: 'utf-8' }).trim();
  } catch {
    _claudePath = 'claude';
  }
  return _claudePath;
}

// ---------------------------------------------------------------------------
// Core advisor invocation
// ---------------------------------------------------------------------------

export function askAdvisor(req: AdvisorRequest): AdvisorResponse {
  const userPrompt = req.context
    ? `Context:\n${req.context}\n\nQuestion:\n${req.question}`
    : req.question;

  const maxTokens = req.maxTokens ?? 500;
  const claudeBin = getClaudePath();

  const args = [
    '-p',
    '--output-format',
    'json',
    '--model',
    'claude-opus-4-6',
    '--max-turns',
    '1',
    '--permission-mode',
    'plan',
    '--system-prompt',
    ADVISOR_SYSTEM_PROMPT,
    '--max-tokens',
    String(maxTokens),
  ];

  const start = Date.now();
  let stdout: string;
  try {
    stdout = execSync(`${claudeBin} ${args.map(shellEscape).join(' ')}`, {
      input: userPrompt,
      encoding: 'utf-8',
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Advisor invocation failed: ${msg}`);
  }
  const elapsed = Date.now() - start;

  let parsed: ClaudeJsonOutput;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      advice: stdout.trim(),
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: elapsed },
    };
  }

  if (parsed.is_error) {
    throw new Error(`Advisor returned error: ${parsed.result}`);
  }

  return {
    advice: parsed.result,
    usage: {
      inputTokens: parsed.usage?.input_tokens ?? 0,
      outputTokens: parsed.usage?.output_tokens ?? 0,
      costUsd: parsed.total_cost_usd ?? 0,
      durationMs: parsed.duration_ms ?? elapsed,
    },
  };
}

// ---------------------------------------------------------------------------
// Full-review advisor invocation
// ---------------------------------------------------------------------------

export function reviewAdvisor(req: AdvisorReviewRequest): AdvisorResponse {
  const focusLine = req.focus ? `\nReview focus: ${req.focus}\n` : '';
  const userPrompt = `${focusLine}\n${req.context}`;

  const maxTokens = req.maxTokens ?? 1500;
  const claudeBin = getClaudePath();

  const args = [
    '-p',
    '--output-format',
    'json',
    '--model',
    'claude-opus-4-6',
    '--max-turns',
    '1',
    '--permission-mode',
    'plan',
    '--system-prompt',
    REVIEW_SYSTEM_PROMPT,
    '--max-tokens',
    String(maxTokens),
  ];

  const start = Date.now();
  let stdout: string;
  try {
    stdout = execSync(`${claudeBin} ${args.map(shellEscape).join(' ')}`, {
      input: userPrompt,
      encoding: 'utf-8',
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Advisor review failed: ${msg}`);
  }
  const elapsed = Date.now() - start;

  let parsed: ClaudeJsonOutput;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      advice: stdout.trim(),
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: elapsed },
    };
  }

  if (parsed.is_error) {
    throw new Error(`Advisor review returned error: ${parsed.result}`);
  }

  return {
    advice: parsed.result,
    usage: {
      inputTokens: parsed.usage?.input_tokens ?? 0,
      outputTokens: parsed.usage?.output_tokens ?? 0,
      costUsd: parsed.total_cost_usd ?? 0,
      durationMs: parsed.duration_ms ?? elapsed,
    },
  };
}

// ---------------------------------------------------------------------------
// Shell escape helper
// ---------------------------------------------------------------------------

function shellEscape(arg: string): string {
  if (/^[a-zA-Z0-9._\-/=]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
