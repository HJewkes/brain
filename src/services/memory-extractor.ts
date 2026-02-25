import { randomUUID } from 'node:crypto';
import type { OllamaClient } from './ollama.js';
import type { BrainDB } from './brain-db.js';
import type { Chunk, Embedder, ExtractedFact, MemoryEntry } from '../types.js';

const EXTRACTION_SYSTEM = `You are a fact extraction engine. Given a text, extract discrete, self-contained facts.
Each fact should be a single sentence that stands alone without context.
Output one fact per line. Do not number them. Do not add commentary.
If the text contains no extractable facts, output nothing.
Focus on: decisions, preferences, patterns, technical facts, relationships, and conclusions.
Skip: filler text, questions, TODOs, and speculative statements.`;

const RECONCILIATION_SYSTEM = `You are a memory reconciliation engine. You will receive:
1. NEW FACTS extracted from a document
2. EXISTING MEMORIES already stored

For each new fact, decide:
- ADD: This is genuinely new information not covered by existing memories.
- UPDATE <id>: This updates/replaces an existing memory (provide the memory ID).
- NONE: This fact is already captured by existing memories (skip it).

For each existing memory, decide if it should be:
- KEEP: Still valid, no changes needed.
- DELETE <id>: No longer supported by the source document (provide the memory ID).

Output valid JSON with this exact structure:
{"actions":[{"type":"ADD","fact":"..."},{"type":"UPDATE","id":"...","fact":"..."},{"type":"DELETE","id":"..."},{"type":"NONE"}]}

Only output the JSON object, nothing else.`;

export type ReconcileAction =
  | { type: 'ADD'; fact: string }
  | { type: 'UPDATE'; id: string; fact: string }
  | { type: 'DELETE'; id: string }
  | { type: 'NONE' };

export interface ExtractionResult {
  noteId: string;
  facts: ExtractedFact[];
  memoriesCreated: number;
  memoriesUpdated: number;
  memoriesDeleted: number;
}

export async function extractMemoriesFromNote(
  db: BrainDB,
  llm: OllamaClient,
  noteId: string,
  containerTag: string = 'default',
  embedder?: Embedder
): Promise<ExtractionResult> {
  const chunks = db.getChunksForNote(noteId);
  if (chunks.length === 0) {
    return { noteId, facts: [], memoriesCreated: 0, memoriesUpdated: 0, memoriesDeleted: 0 };
  }

  const allFacts: ExtractedFact[] = [];
  for (const chunk of chunks) {
    const facts = await extractFactsFromChunk(llm, chunk);
    allFacts.push(...facts);
  }

  if (allFacts.length === 0) {
    return { noteId, facts: [], memoriesCreated: 0, memoriesUpdated: 0, memoriesDeleted: 0 };
  }

  const existingMemories = db.getMemoriesForNote(noteId);

  if (existingMemories.length === 0) {
    const created = await applyAdditions(db, allFacts, noteId, containerTag, embedder);
    return {
      noteId,
      facts: allFacts,
      memoriesCreated: created,
      memoriesUpdated: 0,
      memoriesDeleted: 0,
    };
  }

  const actions = await reconcile(llm, allFacts, existingMemories);
  const result = await applyActions(db, actions, existingMemories, noteId, containerTag, embedder);

  return {
    noteId,
    facts: allFacts,
    memoriesCreated: result.created,
    memoriesUpdated: result.updated,
    memoriesDeleted: result.deleted,
  };
}

async function embedMemory(
  db: BrainDB,
  memoryId: string,
  text: string,
  embedder?: Embedder
): Promise<void> {
  if (!embedder) return;
  const [embedding] = await embedder.embed([text]);
  db.upsertMemoryVector(memoryId, new Float32Array(embedding));
}

async function applyAdditions(
  db: BrainDB,
  facts: ExtractedFact[],
  noteId: string,
  containerTag: string,
  embedder?: Embedder
): Promise<number> {
  const now = new Date().toISOString();
  for (const fact of facts) {
    await createMemory(db, fact.fact, noteId, containerTag, now, {
      sourceChunkId: fact.sourceChunkId,
      actor: 'extractor',
      embedder,
    });
  }
  return facts.length;
}

export async function reconcile(
  llm: OllamaClient,
  newFacts: ExtractedFact[],
  existingMemories: MemoryEntry[]
): Promise<ReconcileAction[]> {
  const factsBlock = newFacts.map((f, i) => `${i + 1}. ${f.fact}`).join('\n');
  const memoriesBlock = existingMemories.map((m) => `[${m.id}] ${m.memory}`).join('\n');

  const prompt = `NEW FACTS:\n${factsBlock}\n\nEXISTING MEMORIES:\n${memoriesBlock}`;

  const response = await llm.generate(prompt, RECONCILIATION_SYSTEM);
  return parseReconciliationResponse(response);
}

export function parseReconciliationResponse(response: string): ReconcileAction[] {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { actions?: ReconcileAction[] };
    if (!Array.isArray(parsed.actions)) return [];

    return parsed.actions.filter((a) => {
      if (a.type === 'ADD') return typeof a.fact === 'string' && a.fact.length > 0;
      if (a.type === 'UPDATE') return typeof a.id === 'string' && typeof a.fact === 'string';
      if (a.type === 'DELETE') return typeof a.id === 'string';
      if (a.type === 'NONE') return true;
      return false;
    });
  } catch {
    return [];
  }
}

async function applyActions(
  db: BrainDB,
  actions: ReconcileAction[],
  existingMemories: MemoryEntry[],
  noteId: string,
  containerTag: string,
  embedder?: Embedder
): Promise<{ created: number; updated: number; deleted: number }> {
  const now = new Date().toISOString();
  const existingById = new Map(existingMemories.map((m) => [m.id, m]));
  let created = 0;
  let updated = 0;
  let deleted = 0;

  for (const action of actions) {
    if (action.type === 'ADD') {
      await createMemory(db, action.fact, noteId, containerTag, now, {
        actor: 'reconciler',
        embedder,
      });
      created++;
    } else if (action.type === 'UPDATE') {
      const existing = existingById.get(action.id);
      if (!existing) continue;
      await updateMemoryFromAction(db, existing, action.fact, noteId, containerTag, now, embedder);
      updated++;
    } else if (action.type === 'DELETE') {
      const existing = existingById.get(action.id);
      if (!existing) continue;
      deleteMemoryAction(db, existing, now);
      deleted++;
    }
  }

  return { created, updated, deleted };
}

async function createMemory(
  db: BrainDB,
  fact: string,
  noteId: string,
  containerTag: string,
  now: string,
  opts: { sourceChunkId?: string | null; actor: string; embedder?: Embedder }
): Promise<void> {
  const id = randomUUID();
  db.addMemory({
    id,
    memory: fact,
    sourceNoteId: noteId,
    sourceChunkId: opts.sourceChunkId ?? null,
    containerTag,
    isLatest: true,
    parentMemoryId: null,
    rootMemoryId: null,
    relationType: null,
    validAt: now,
    invalidAt: null,
    forgetAfter: null,
    isForgotten: false,
    isInference: false,
    createdAt: now,
  });
  await embedMemory(db, id, fact, opts.embedder);
  db.addMemoryHistory({
    memoryId: id,
    event: 'add',
    oldMemory: null,
    newMemory: fact,
    actor: opts.actor,
    createdAt: now,
  });
}

async function updateMemoryFromAction(
  db: BrainDB,
  existing: MemoryEntry,
  fact: string,
  noteId: string,
  containerTag: string,
  now: string,
  embedder?: Embedder
): Promise<void> {
  db.markMemorySuperseded(existing.id);
  const newId = randomUUID();
  const rootId = existing.rootMemoryId ?? existing.id;
  db.addMemory({
    id: newId,
    memory: fact,
    sourceNoteId: noteId,
    sourceChunkId: existing.sourceChunkId,
    containerTag,
    isLatest: true,
    parentMemoryId: existing.id,
    rootMemoryId: rootId,
    relationType: 'updates',
    validAt: now,
    invalidAt: null,
    forgetAfter: null,
    isForgotten: false,
    isInference: false,
    createdAt: now,
  });
  await embedMemory(db, newId, fact, embedder);
  db.addMemoryHistory({
    memoryId: newId,
    event: 'update',
    oldMemory: existing.memory,
    newMemory: fact,
    actor: 'reconciler',
    createdAt: now,
  });
}

function deleteMemoryAction(db: BrainDB, existing: MemoryEntry, now: string): void {
  db.markMemorySuperseded(existing.id);
  db.deleteMemoryVector(existing.id);
  db.addMemoryHistory({
    memoryId: existing.id,
    event: 'delete',
    oldMemory: existing.memory,
    newMemory: null,
    actor: 'reconciler',
    createdAt: now,
  });
}

async function extractFactsFromChunk(llm: OllamaClient, chunk: Chunk): Promise<ExtractedFact[]> {
  const text = chunk.content;
  if (text.trim().length < 20) return [];

  const response = await llm.generate(text, EXTRACTION_SYSTEM);

  if (!response.trim()) return [];

  const lines = response
    .split('\n')
    .map((l) => l.replace(/^[-*•]\s*/, '').trim())
    .filter((l) => l.length > 10);

  return lines.map((fact) => ({
    fact,
    sourceChunkId: chunk.id,
  }));
}
