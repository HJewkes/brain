import type { BrainDB } from './brain-db.js';
import type { Relation, GraphNode, GraphResult } from '../types.js';

const MAX_DEPTH = 3;
const BIDIRECTIONAL_TYPES = new Set(['related-to']);

export function getDirectRelations(db: BrainDB, noteId: string): Relation[] {
  const outgoing = db.getRelationsFrom(noteId);
  const incoming = db.getRelationsTo(noteId);
  return [...outgoing, ...incoming];
}

export function traverseGraph(db: BrainDB, rootId: string, depth: number): GraphResult {
  const effectiveDepth = Math.min(depth, MAX_DEPTH);

  const rootNote = db.getNoteById(rootId);
  const root: GraphNode = {
    id: rootId,
    title: rootNote?.title ?? rootId,
    type: rootNote?.type ?? 'note',
    tier: rootNote?.tier ?? 'slow',
    depth: 0,
  };

  const visited = new Map<string, number>();
  visited.set(rootId, 0);

  const allEdges: Relation[] = [];
  const frontier = [rootId];

  for (let d = 0; d < effectiveDepth; d++) {
    const nextFrontier: string[] = [];

    for (const nodeId of frontier) {
      const outgoing = db.getRelationsFrom(nodeId);
      for (const rel of outgoing) {
        allEdges.push(rel);
        if (!visited.has(rel.targetId)) {
          visited.set(rel.targetId, d + 1);
          nextFrontier.push(rel.targetId);
        }
      }

      const incoming = db.getRelationsTo(nodeId);
      for (const rel of incoming) {
        if (!BIDIRECTIONAL_TYPES.has(rel.type)) continue;
        allEdges.push(rel);
        if (!visited.has(rel.sourceId)) {
          visited.set(rel.sourceId, d + 1);
          nextFrontier.push(rel.sourceId);
        }
      }
    }

    frontier.length = 0;
    frontier.push(...nextFrontier);
  }

  const nodes: GraphNode[] = [];
  for (const [id, nodeDepth] of visited) {
    const note = id === rootId ? rootNote : db.getNoteById(id);
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
