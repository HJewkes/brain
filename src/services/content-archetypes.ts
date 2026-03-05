import type { Embedder } from '../types.js';

/** Default archetype texts used when no registry-provided texts are available */
export const ARCHETYPE_TEXTS: Record<string, string> = {
  task: 'A list of tasks with status, priority, and assignees. Work items, tickets, action items, to-do lists, sprint backlogs, and checkbox checklists tracking progress.',
  research:
    'System architecture documentation describing components, data flow, deployment topology, infrastructure, microservices, APIs, and technical design decisions.',
  guide: 'Product requirements document with user stories, acceptance criteria, functional and non-functional requirements. PRDs, specs, and feature requests.',
  meeting:
    'Meeting notes with attendees, agenda, discussion points, decisions made, and action items. Standup notes, retrospectives, and planning session summaries.',
  note: 'Reference material such as configuration tables, API documentation, glossaries, lookup tables, and comparison matrices. Structured data meant to be consulted, not acted upon.',
};

let cachedEmbeddings: Map<string, Float32Array> | null = null;
let cachedTextsKey: string | null = null;

function textsKey(texts: Map<string, string>): string {
  return [...texts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}:${v.length}`).join('|');
}

export async function getArchetypeEmbeddings(
  embedder: Embedder,
  archetypeTexts?: Map<string, string>
): Promise<Map<string, Float32Array>> {
  const textsToUse = archetypeTexts ?? new Map(Object.entries(ARCHETYPE_TEXTS));
  const key = textsKey(textsToUse);

  if (cachedEmbeddings && cachedTextsKey === key) return cachedEmbeddings;

  const classes = [...textsToUse.keys()];
  const texts = classes.map((cls) => textsToUse.get(cls)!);
  const vectors = await embedder.embed(texts);

  cachedEmbeddings = new Map();
  cachedTextsKey = key;
  for (let i = 0; i < classes.length; i++) {
    cachedEmbeddings.set(classes[i], new Float32Array(vectors[i]));
  }

  return cachedEmbeddings;
}

export function clearArchetypeCache(): void {
  cachedEmbeddings = null;
  cachedTextsKey = null;
}
