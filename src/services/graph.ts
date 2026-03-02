import type { BrainDB } from './brain-db.js';
import type { Relation, GraphNode, GraphResult, RelationType } from '../types.js';

const MAX_DEPTH = 3;
const BIDIRECTIONAL_TYPES = new Set(['related-to', 'related', 'parent', 'depends_on']);

function distanceToCosineSim(distance: number): number {
  return 1 - (distance * distance) / 2;
}

export function computeAutoLinks(
  db: BrainDB,
  noteId: string,
  threshold = 0.85,
  maxLinks = 5,
  embedding?: Float32Array,
): Relation[] {
  let queryEmbedding = embedding;
  if (!queryEmbedding) {
    const chunks = db.getChunksForNote(noteId);
    if (chunks.length === 0) return [];
    const stored = db.getChunkEmbedding(chunks[0].id);
    if (!stored) return [];
    queryEmbedding = stored;
  }

  const vectorResults = db.searchVector(queryEmbedding, maxLinks + 1);

  const existing = db.getRelationsFrom(noteId);
  const existingTargets = new Set(existing.map((r) => r.targetId));

  const links: Relation[] = [];
  for (const result of vectorResults) {
    if (result.noteId === noteId) continue;
    const cosineSim = distanceToCosineSim(result.distance);
    if (cosineSim < threshold) continue;
    if (existingTargets.has(result.noteId)) continue;
    links.push({
      sourceId: noteId,
      targetId: result.noteId,
      type: 'related',
    });
  }
  return links;
}

export function getDirectRelations(db: BrainDB, noteId: string): Relation[] {
  const outgoing = db.getRelationsFrom(noteId);
  const incoming = db.getRelationsTo(noteId);
  return [...outgoing, ...incoming];
}

export function traverseGraph(db: BrainDB, rootId: string, depth: number): GraphResult {
  const effectiveDepth = Math.min(depth, MAX_DEPTH);

  const visited = new Map<string, number>();
  visited.set(rootId, 0);

  const allEdges: Relation[] = [];
  let frontier = [rootId];

  for (let d = 0; d < effectiveDepth; d++) {
    const relationsBatch = db.getRelationsBatch(frontier);
    const nextFrontier: string[] = [];

    for (const nodeId of frontier) {
      const rels = relationsBatch.get(nodeId);
      if (!rels) continue;

      for (const rel of rels.from) {
        allEdges.push(rel);
        if (!visited.has(rel.targetId)) {
          visited.set(rel.targetId, d + 1);
          nextFrontier.push(rel.targetId);
        }
      }

      for (const rel of rels.to) {
        if (!BIDIRECTIONAL_TYPES.has(rel.type)) continue;
        allEdges.push(rel);
        if (!visited.has(rel.sourceId)) {
          visited.set(rel.sourceId, d + 1);
          nextFrontier.push(rel.sourceId);
        }
      }
    }

    frontier = nextFrontier;
  }

  const allIds = [...visited.keys()];
  const notesById = db.getNotesByIds(allIds);

  const root: GraphNode = {
    id: rootId,
    title: notesById.get(rootId)?.title ?? rootId,
    type: notesById.get(rootId)?.type ?? 'note',
    tier: notesById.get(rootId)?.tier ?? 'slow',
    depth: 0,
  };

  const nodes: GraphNode[] = [];
  for (const [id, nodeDepth] of visited) {
    const note = notesById.get(id);
    nodes.push({
      id,
      title: note?.title ?? id,
      type: note?.type ?? 'note',
      tier: note?.tier ?? 'slow',
      depth: nodeDepth,
    });
  }

  const nodeIds = new Set(visited.keys());
  const edges = deduplicateEdges(
    allEdges.filter((e) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId))
  );

  return { root, nodes, edges };
}

export function expandResults(
  db: BrainDB,
  noteIds: string[],
  depth: number
): Array<{ noteId: string; decayedScore: number }> {
  if (noteIds.length === 0) return [];

  const inputSet = new Set(noteIds);
  const scoreMap = new Map<string, number>();

  for (const noteId of noteIds) {
    const result = traverseGraph(db, noteId, depth);
    for (const node of result.nodes) {
      if (inputSet.has(node.id)) continue;
      const decayed = Math.pow(0.5, node.depth);
      const existing = scoreMap.get(node.id) ?? 0;
      scoreMap.set(node.id, Math.max(existing, decayed));
    }
  }

  return Array.from(scoreMap.entries())
    .map(([noteId, decayedScore]) => ({ noteId, decayedScore }))
    .sort((a, b) => b.decayedScore - a.decayedScore);
}

export interface GraphScore {
  noteId: string;
  score: number;
  relationType: RelationType;
  depth: number;
}

export function computeGraphScores(
  db: BrainDB,
  rootId: string,
  maxDepth: number = 3
): Map<string, GraphScore> {
  const result = traverseGraph(db, rootId, maxDepth);
  const scores = new Map<string, GraphScore>();

  // Build a map from node id to its nearest edge type
  const edgeTypeByTarget = new Map<string, RelationType>();
  for (const edge of result.edges) {
    const neighbor = edge.sourceId === rootId ? edge.targetId : edge.sourceId;
    if (!edgeTypeByTarget.has(neighbor)) {
      edgeTypeByTarget.set(neighbor, edge.type);
    }
  }

  for (const node of result.nodes) {
    if (node.id === rootId) continue;
    const depth = node.depth;
    const score = 1.0 / Math.pow(2, depth);
    const relationType = edgeTypeByTarget.get(node.id) ?? 'related';

    const existing = scores.get(node.id);
    if (!existing || score > existing.score) {
      scores.set(node.id, { noteId: node.id, score, relationType, depth });
    }
  }

  return scores;
}

function deduplicateEdges(edges: Relation[]): Relation[] {
  const seen = new Set<string>();
  const result: Relation[] = [];
  for (const edge of edges) {
    const key = `${edge.sourceId}|${edge.targetId}|${edge.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(edge);
    }
  }
  return result;
}
