import type { BrainDB } from '../../../services/brain-db.js';
import type { Embedder } from '../../../types.js';
import { listTasks } from '../../pm/data/task-ops.js';
import { readTaskBody } from '../../pm/engine/dispatch.js';
import { getPmNotes } from '../../pm/data/queries.js';

export interface DedupPair {
  taskA: string;
  taskB: string;
  titleA: string;
  titleB: string;
  similarity: number;
  suggestion: 'cancel-one' | 'merge' | 'keep-both';
  rationale: string;
}

export interface DedupScanResult {
  totalScanned: number;
  pairsFound: number;
  pairs: DedupPair[];
  errors: string[];
}

export interface DedupScanOptions {
  project?: string;
  workstream?: number;
  threshold?: number;
  status?: string;
}

const DEFAULT_THRESHOLD = 0.85;

export async function scanForDuplicates(
  db: BrainDB,
  embedder: Embedder,
  opts?: DedupScanOptions
): Promise<DedupScanResult> {
  const project = opts?.project ?? process.env.BRAIN_PM_PROJECT ?? 'VNM';
  const threshold = opts?.threshold ?? DEFAULT_THRESHOLD;
  const errors: string[] = [];

  const result = listTasks(
    db,
    project,
    {
      workstream: opts?.workstream,
      status: opts?.status ?? 'pending',
    },
    'default'
  );

  if (!result.ok) {
    return { totalScanned: 0, pairsFound: 0, pairs: [], errors: [result.error.message] };
  }

  const tasks = result.data;
  if (tasks.length < 2) {
    return { totalScanned: tasks.length, pairsFound: 0, pairs: [], errors };
  }

  const taskTexts = buildTaskTexts(db, tasks);
  const texts = taskTexts.map((t) => t.text);

  let embeddings: number[][];
  try {
    embeddings = await embedder.embed(texts);
  } catch (err) {
    return {
      totalScanned: tasks.length,
      pairsFound: 0,
      pairs: [],
      errors: [`Embedding failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const pairs = findDuplicatePairs(taskTexts, embeddings, threshold);

  return {
    totalScanned: tasks.length,
    pairsFound: pairs.length,
    pairs,
    errors,
  };
}

interface TaskText {
  displayId: string;
  title: string;
  workstream: number;
  status: string;
  text: string;
}

function buildTaskTexts(
  db: BrainDB,
  tasks: { display_id: string; title?: string; workstream: number; status: string }[]
): TaskText[] {
  return tasks.map((task) => {
    const notes = getPmNotes(db, 'task', { display_id: task.display_id });
    const body = notes.length > 0 ? readTaskBody(notes[0]) : '';
    const title = task.title ?? '';
    const text = `${title}\n${body}`.trim();
    return {
      displayId: task.display_id,
      title,
      workstream: task.workstream,
      status: task.status,
      text: text || title || task.display_id,
    };
  });
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

function findDuplicatePairs(
  taskTexts: TaskText[],
  embeddings: number[][],
  threshold: number
): DedupPair[] {
  const pairs: DedupPair[] = [];

  for (let i = 0; i < taskTexts.length; i++) {
    for (let j = i + 1; j < taskTexts.length; j++) {
      const sim = cosineSimilarity(embeddings[i], embeddings[j]);
      if (sim >= threshold) {
        pairs.push({
          taskA: taskTexts[i].displayId,
          taskB: taskTexts[j].displayId,
          titleA: taskTexts[i].title,
          titleB: taskTexts[j].title,
          similarity: Math.round(sim * 1000) / 1000,
          ...suggestResolution(taskTexts[i], taskTexts[j], sim),
        });
      }
    }
  }

  return pairs.sort((a, b) => b.similarity - a.similarity);
}

function suggestResolution(
  a: TaskText,
  b: TaskText,
  similarity: number
): { suggestion: DedupPair['suggestion']; rationale: string } {
  const sameWorkstream = a.workstream === b.workstream;

  if (similarity >= 0.95) {
    return {
      suggestion: 'cancel-one',
      rationale: sameWorkstream
        ? 'Near-identical tasks in same workstream — cancel the less specified one'
        : 'Near-identical tasks across workstreams — consolidate into one',
    };
  }

  if (similarity >= 0.9) {
    return {
      suggestion: 'merge',
      rationale: sameWorkstream
        ? 'Highly similar tasks — merge descriptions and cancel duplicate'
        : 'Overlapping scope across workstreams — merge into the primary workstream',
    };
  }

  return {
    suggestion: sameWorkstream ? 'merge' : 'keep-both',
    rationale: sameWorkstream
      ? 'Similar tasks in same workstream — review for potential merge'
      : 'Related tasks in different workstreams — may be intentional parallel work',
  };
}
