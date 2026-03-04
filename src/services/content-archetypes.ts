import type { ContentClass, Embedder } from '../types.js';

export const ARCHETYPE_TEXTS: Record<Exclude<ContentClass, 'general'>, string> = {
  'task-list':
    'A list of tasks with status, priority, and assignees. Work items, tickets, action items, to-do lists, sprint backlogs, and checkbox checklists tracking progress.',
  'bug-report':
    'A bug report describing steps to reproduce, expected behavior, actual behavior, severity, and environment details. Issue reports, defect descriptions, and crash logs.',
  architecture:
    'System architecture documentation describing components, data flow, deployment topology, infrastructure, microservices, APIs, and technical design decisions.',
  requirements:
    'Product requirements document with user stories, acceptance criteria, functional and non-functional requirements. PRDs, specs, and feature requests.',
  'meeting-notes':
    'Meeting notes with attendees, agenda, discussion points, decisions made, and action items. Standup notes, retrospectives, and planning session summaries.',
  reference:
    'Reference material such as configuration tables, API documentation, glossaries, lookup tables, and comparison matrices. Structured data meant to be consulted, not acted upon.',
};

let cachedEmbeddings: Map<Exclude<ContentClass, 'general'>, Float32Array> | null = null;

export async function getArchetypeEmbeddings(
  embedder: Embedder
): Promise<Map<Exclude<ContentClass, 'general'>, Float32Array>> {
  if (cachedEmbeddings) return cachedEmbeddings;

  const classes = Object.keys(ARCHETYPE_TEXTS) as Exclude<ContentClass, 'general'>[];
  const texts = classes.map((cls) => ARCHETYPE_TEXTS[cls]);
  const vectors = await embedder.embed(texts);

  cachedEmbeddings = new Map();
  for (let i = 0; i < classes.length; i++) {
    cachedEmbeddings.set(classes[i], new Float32Array(vectors[i]));
  }

  return cachedEmbeddings;
}

export function clearArchetypeCache(): void {
  cachedEmbeddings = null;
}
