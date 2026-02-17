import { Command } from '@commander-js/extra-typings'
import { loadConfig } from '../services/config.js'
import { BrainDB } from '../services/brain-db.js'
import { traverseGraph } from '../services/graph.js'
import type { GraphResult, Relation } from '../types.js'

interface TreeChild {
  relationType: string
  nodeId: string
  nodeType: string
  children: TreeChild[]
}

function buildTree(result: GraphResult): TreeChild[] {
  const edgesBySource = new Map<string, Relation[]>()
  for (const edge of result.edges) {
    const list = edgesBySource.get(edge.sourceId) ?? []
    list.push(edge)
    edgesBySource.set(edge.sourceId, list)
  }

  const nodeMap = new Map(result.nodes.map((n) => [n.id, n]))
  const visited = new Set<string>([result.root.id])

  function expand(nodeId: string): TreeChild[] {
    const edges = edgesBySource.get(nodeId) ?? []
    const children: TreeChild[] = []

    for (const edge of edges) {
      if (visited.has(edge.targetId)) continue
      visited.add(edge.targetId)
      const target = nodeMap.get(edge.targetId)
      children.push({
        relationType: edge.type,
        nodeId: edge.targetId,
        nodeType: target?.type ?? 'note',
        children: expand(edge.targetId),
      })
    }

    return children
  }

  return expand(result.root.id)
}

function printTree(
  rootId: string,
  rootType: string,
  children: TreeChild[],
): void {
  console.log(`${rootId} (${rootType})`)
  printChildren(children, '')
}

function printChildren(children: TreeChild[], prefix: string): void {
  for (let i = 0; i < children.length; i++) {
    const isLast = i === children.length - 1
    const connector = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 '
    const child = children[i]
    console.log(`${prefix}${connector}${child.relationType}: ${child.nodeId} (${child.nodeType})`)
    const childPrefix = prefix + (isLast ? '    ' : '\u2502   ')
    printChildren(child.children, childPrefix)
  }
}

export const graphCommand = new Command('graph')
  .description('Show note relations as a graph')
  .argument('<note-id>', 'Root note ID')
  .option('--depth <n>', 'Traversal depth', parseInt, 2)
  .option('--json', 'Output as JSON')
  .action((noteId, opts) => {
    const config = loadConfig()
    const db = new BrainDB(config.dbPath)

    try {
      const result = traverseGraph(db, noteId, opts.depth)

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2))
      } else {
        const tree = buildTree(result)
        printTree(result.root.id, result.root.type, tree)
      }
    } finally {
      db.close()
    }
  })
