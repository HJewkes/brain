import type { BrainDB } from './brain-db.js';
import type { EmbedderBackend, HealthCheckResult, HealthReport } from '../types.js';
import { checkOllamaHealth, type OllamaHealthResult } from './ollama.js';
import { getEmbedderInfo } from '../adapters/index.js';
import { parseIntervalDays } from '../utils.js';

const DEFAULT_LLM_MODEL = 'qwen2.5:3b';

export function checkDatabase(db: BrainDB): HealthCheckResult {
  try {
    const version = db.getMetaValue('schema_version') ?? 'unknown';
    const noteCount = db.getAllNotes().length;
    const chunkCount = db.getChunkCount();
    return {
      name: 'Database',
      status: 'ok',
      message: `v${version}, ${noteCount} notes, ${chunkCount} chunks`,
    };
  } catch (err) {
    return {
      name: 'Database',
      status: 'error',
      message: 'Database error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export function checkEmbedder(backend: EmbedderBackend): HealthCheckResult {
  try {
    const info = getEmbedderInfo(backend);
    return {
      name: 'Embedder',
      status: 'ok',
      message: `${backend} (${info.model}, ${info.dimensions}d)`,
    };
  } catch (err) {
    return {
      name: 'Embedder',
      status: 'error',
      message: 'Embedder configuration error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export function checkLlm(
  ollamaHealth: OllamaHealthResult,
  model: string = DEFAULT_LLM_MODEL
): HealthCheckResult {
  if (!ollamaHealth.running) {
    return {
      name: 'LLM',
      status: 'warning',
      message: 'Ollama not running (extract, tidy unavailable)',
    };
  }

  const hasModel = ollamaHealth.models.some((m) => m === model || m.startsWith(model + ':'));
  if (!hasModel) {
    return {
      name: 'LLM',
      status: 'warning',
      message: `Model "${model}" not found (run \`ollama pull ${model}\`)`,
    };
  }

  return {
    name: 'LLM',
    status: 'ok',
    message: `Ollama (${model})`,
  };
}

export function checkInbox(db: BrainDB): HealthCheckResult {
  const pending = db.getInboxItems('pending');
  const failed = db.getInboxItems('failed');

  const parts: string[] = [];
  if (pending.length > 0) parts.push(`${pending.length} pending`);
  if (failed.length > 0) parts.push(`${failed.length} failed`);

  if (failed.length > 0) {
    return { name: 'Inbox', status: 'warning', message: parts.join(', ') };
  }

  return {
    name: 'Inbox',
    status: 'ok',
    message: parts.length > 0 ? parts.join(', ') : '0 pending, 0 failed',
  };
}

export function checkStaleNotes(db: BrainDB): HealthCheckResult {
  const notes = db.getAllNotes();
  const now = new Date();
  let staleCount = 0;

  for (const note of notes) {
    if (note.lastReviewed && note.reviewInterval) {
      const reviewed = new Date(note.lastReviewed);
      const intervalDays = parseIntervalDays(note.reviewInterval);
      const due = new Date(reviewed.getTime() + intervalDays * 86_400_000);
      if (due < now) staleCount++;
    }
  }

  if (staleCount === 0) {
    return { name: 'Stale notes', status: 'ok', message: 'None past review' };
  }

  return {
    name: 'Stale notes',
    status: 'warning',
    message: `${staleCount} note(s) past review interval`,
  };
}

export async function runAllChecks(
  db: BrainDB,
  embedderBackend: EmbedderBackend,
  ollamaUrl?: string,
  ollamaModel?: string
): Promise<HealthReport> {
  const ollamaHealth = await checkOllamaHealth(ollamaUrl);

  const checks: HealthCheckResult[] = [
    checkDatabase(db),
    checkEmbedder(embedderBackend),
    checkLlm(ollamaHealth, ollamaModel),
    checkInbox(db),
    checkStaleNotes(db),
  ];

  const summary = {
    ok: checks.filter((c) => c.status === 'ok').length,
    warnings: checks.filter((c) => c.status === 'warning').length,
    errors: checks.filter((c) => c.status === 'error').length,
  };

  return { checks, summary };
}
