import type { BrainService } from '../../../services/brain-service.js';
import type { SessionMetadata } from '../types.js';
import type { AgentGpaScore, GpaDimensions, GpaScoringInput } from './gpa-scorer.js';

export type { AgentGpaScore, GpaDimensions };

export interface PostExecutionResult {
  score: AgentGpaScore;
  notePath: string | null;
  skipped: boolean;
  skipReason?: string;
}

/**
 * Run the GPA post-execution analysis pipeline for a session.
 * Scores the session on Goal/Plan/Action dimensions, persists an analysis note,
 * and returns the result. Pass `force: true` to overwrite an existing analysis.
 *
 * Stub — full implementation provided by VNM-34.113.
 */
export async function runPostExecutionAnalysis(
  _svc: BrainService,
  _sessionId: string,
  _taskDescription?: string,
  _opts?: { force?: boolean }
): Promise<PostExecutionResult> {
  throw new Error('runPostExecutionAnalysis: not yet implemented (pending VNM-34.113)');
}

/**
 * Build a GpaScoringInput from session note metadata (no live events required).
 * Used in --all mode for sessions that only have JSONL data.
 *
 * Stub — full implementation provided by VNM-34.113.
 */
export function sessionNoteMetaToScoringInput(_meta: SessionMetadata): GpaScoringInput {
  throw new Error('sessionNoteMetaToScoringInput: not yet implemented (pending VNM-34.113)');
}
