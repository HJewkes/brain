// === Embedder Interface ===

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>
  readonly model: string
  readonly dimensions: number
}

// === Note Types ===

export type NoteTier = 'slow' | 'fast'

export type NoteType =
  | 'note'
  | 'decision'
  | 'pattern'
  | 'research'
  | 'meeting'
  | 'session-log'
  | 'guide'

export type NoteConfidence = 'high' | 'medium' | 'low' | 'speculative'

export type NoteStatus = 'current' | 'outdated' | 'deprecated' | 'draft'

export const VALID_NOTE_TYPES: NoteType[] = ['note', 'decision', 'pattern', 'research', 'meeting', 'session-log', 'guide']
export const VALID_NOTE_TIERS: NoteTier[] = ['slow', 'fast']
export const VALID_NOTE_CONFIDENCES: NoteConfidence[] = ['high', 'medium', 'low', 'speculative']
export const VALID_NOTE_STATUSES: NoteStatus[] = ['current', 'outdated', 'deprecated', 'draft']

export type RelationType = 'related-to' | 'supersedes' | 'informs' | 'parent'

export interface NoteSource {
  url: string
  accessed: string
  type: string
}

export interface NoteFrontmatter {
  id?: string
  title: string
  type: NoteType
  tier: NoteTier
  category?: string
  tags?: string[]
  summary?: string
  confidence?: NoteConfidence
  status?: NoteStatus
  sources?: NoteSource[]
  created?: string
  modified?: string
  'last-reviewed'?: string
  'review-interval'?: string
  expires?: string
  date?: string
  participants?: string[]
  project?: string
  outcome?: string
  related?: string[]
  supersedes?: string
  parent?: string
}

// === Chunk Types ===

export type ChunkType = 'section' | 'observation'

export interface RawChunk {
  heading: string | null
  text: string
  tokenCount: number
}

export interface Chunk {
  id: string
  noteId: string
  heading: string | null
  content: string
  tokenCount: number
  chunkType: ChunkType
}

// === Search Types ===

export interface SearchResult {
  score: number
  filePath: string
  noteId: string
  heading: string | null
  excerpt: string
  tier: NoteTier
  tags: string[]
  confidence: NoteConfidence | null
}

export type FusionStrategy = 'rrf' | 'score'

export interface SearchOptions {
  limit: number
  tier?: NoteTier
  tags?: string[]
  category?: string
  confidence?: NoteConfidence
  since?: string
  expand?: boolean
  fusionStrategy?: FusionStrategy
  minScore?: number
}

// === Graph Types ===

export interface Relation {
  sourceId: string
  targetId: string
  type: RelationType
}

export interface GraphNode {
  id: string
  title: string
  type: NoteType
  tier: NoteTier
  depth: number
}

export interface GraphResult {
  root: GraphNode
  nodes: GraphNode[]
  edges: Relation[]
}

// === Config Types ===

export type EmbedderBackend = 'local' | 'ollama' | 'remote'

export interface BrainConfig {
  notesDir: string
  dbPath: string
  embedder: EmbedderBackend
  ollamaUrl?: string
  fusionWeights: {
    bm25: number
    vector: number
  }
}

// === Parsed Note (output of markdown parser) ===

export interface ParsedNote {
  id: string
  filePath: string
  frontmatter: NoteFrontmatter
  content: string
  chunks: RawChunk[]
  relations: Relation[]
}

// === DB Record Types ===

export interface FileRecord {
  path: string
  hash: string
  mtime: number
  indexedAt: number
}

export interface NoteRecord {
  id: string
  filePath: string
  title: string
  type: NoteType
  tier: NoteTier
  category: string | null
  tags: string | null
  summary: string | null
  confidence: NoteConfidence | null
  status: NoteStatus
  sources: string | null
  createdAt: string | null
  modifiedAt: string | null
  lastReviewed: string | null
  reviewInterval: string | null
  expires: string | null
  metadata: string | null
}
