import type { OllamaClient } from '../../../services/ollama.js';
import type { AutoloopInsight, AutoloopCounters } from '../types.js';
import type { TranscriptTurn } from './discovery.js';

export interface InsightSet {
  insights: AutoloopInsight[];
  sessionId: string;
  sessionDisplayId: string;
}

const SYSTEM_PROMPT = `You are an analyst reviewing Claude Code session transcripts to extract actionable insights.

Analyze the transcript and extract insights in these categories:
- pattern: Recurring behaviors, workflows, or approaches observed
- friction: Problems encountered, things that slowed work down, errors
- decision: Architectural or design choices made with rationale
- learning: New knowledge, techniques, or discoveries
- improvement: Suggestions for better workflows, tools, or approaches

For each insight, provide:
1. A short title (under 80 chars)
2. A 1-3 sentence description
3. A confidence score 0.0-1.0 (how certain you are this is a real insight)
4. The category

Output ONLY valid JSON array. No markdown, no explanation. Example:
[
  {"category": "friction", "title": "Tests fail on ONNX model loading", "content": "The eval tests consistently fail due to ONNX model file corruption in worktrees. This is a known pre-existing issue, not related to current work.", "confidence": 0.9},
  {"category": "decision", "title": "Used PM notes for research items", "content": "Research queue items stored as PM notes rather than extending inbox table, for consistency with existing PM patterns.", "confidence": 0.85}
]`;

export async function extractInsights(
  ollama: OllamaClient,
  transcript: TranscriptTurn[],
  sessionId: string,
  sessionDisplayId: string,
  counters: AutoloopCounters
): Promise<InsightSet> {
  const condensed = condenseTranscript(transcript);
  if (condensed.length < 50) {
    return { insights: [], sessionId, sessionDisplayId };
  }

  counters.llmCalls++;
  const response = await ollama.generate(condensed, SYSTEM_PROMPT);

  const insights = parseInsightResponse(response, sessionId, sessionDisplayId);
  return { insights, sessionId, sessionDisplayId };
}

function condenseTranscript(turns: TranscriptTurn[]): string {
  const lines: string[] = [];

  for (const turn of turns) {
    switch (turn.role) {
      case 'user':
        lines.push(`USER: ${turn.content}`);
        break;
      case 'assistant':
        lines.push(`ASSISTANT: ${turn.content}`);
        break;
      case 'tool_use':
        lines.push(`TOOL: ${turn.content}`);
        break;
      case 'tool_result':
        // Skip tool results to keep transcript compact
        break;
    }
  }

  return lines.join('\n');
}

function parseInsightResponse(
  response: string,
  sessionId: string,
  sessionDisplayId: string
): AutoloopInsight[] {
  // Try to extract JSON from the response
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      category?: string;
      title?: string;
      content?: string;
      confidence?: number;
    }>;

    if (!Array.isArray(parsed)) return [];

    const validCategories = new Set(['pattern', 'friction', 'decision', 'learning', 'improvement']);

    return parsed
      .filter(
        (item) => item.title && item.content && item.category && validCategories.has(item.category)
      )
      .map((item) => ({
        category: item.category as AutoloopInsight['category'],
        title: item.title!.slice(0, 80),
        content: item.content!,
        confidence: Math.max(0, Math.min(1, item.confidence ?? 0.5)),
        sourceSessionIds: [sessionId],
        sourceSessionDisplayIds: [sessionDisplayId],
      }));
  } catch {
    return [];
  }
}
