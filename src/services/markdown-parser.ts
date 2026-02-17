import matter from 'gray-matter'
import type {
  ParsedNote,
  NoteFrontmatter,
  NoteType,
  NoteTier,
  RawChunk,
  Relation,
  RelationType,
} from '../types.js'

const MAX_CHUNK_TOKENS = 512
const FENCE_OPEN = /^```/
const FENCE_CLOSE = /^```\s*$/
const MIN_CHUNK_LENGTH = 20

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0
  return Math.ceil(text.length / 4)
}

export function parseMarkdown(filePath: string, content: string): ParsedNote {
  const { data, content: body } = matter(content)

  const id = deriveId(filePath, data)
  const frontmatter = buildFrontmatter(filePath, data)
  const chunks = chunkBody(body)
  const relations = extractRelations(id, data)

  return { id, filePath, frontmatter, content: body, chunks, relations }
}

function deriveId(filePath: string, data: Record<string, unknown>): string {
  if (typeof data.id === 'string' && data.id.length > 0) return data.id
  const filename = filePath.split('/').pop() ?? filePath
  return filename.replace(/\.md$/, '')
}

function buildFrontmatter(
  filePath: string,
  data: Record<string, unknown>,
): NoteFrontmatter {
  const filename = (filePath.split('/').pop() ?? filePath).replace(/\.md$/, '')
  return {
    ...data,
    title: typeof data.title === 'string' ? data.title : filename,
    type: (data.type as NoteType) ?? 'note',
    tier: (data.tier as NoteTier) ?? 'slow',
  }
}

interface Section {
  heading: string | null
  lines: string[]
}

function splitIntoSections(body: string): Section[] {
  const lines = body.split('\n')
  const sections: Section[] = []
  let current: Section = { heading: null, lines: [] }

  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)$/)
    if (match) {
      sections.push(current)
      current = { heading: match[2], lines: [] }
    } else {
      current.lines.push(line)
    }
  }
  sections.push(current)

  return sections
}

function chunkBody(body: string): RawChunk[] {
  const sections = splitIntoSections(body)
  const chunks: RawChunk[] = []

  for (const section of sections) {
    const text = section.lines.join('\n').trim()
    if (text.length < MIN_CHUNK_LENGTH) continue

    const tokens = estimateTokens(text)
    if (tokens <= MAX_CHUNK_TOKENS) {
      chunks.push({ heading: section.heading, text, tokenCount: tokens })
    } else {
      const subChunks = splitOversizedSection(section.heading, text)
      chunks.push(...subChunks)
    }
  }

  return chunks
}

function splitOversizedSection(
  heading: string | null,
  text: string,
): RawChunk[] {
  const paragraphs = splitParagraphsProtectingFences(text)
  const chunks: RawChunk[] = []
  let buffer = ''
  let overlapPrefix = ''

  for (const para of paragraphs) {
    const budgetForContent = overlapPrefix.length > 0
      ? MAX_CHUNK_TOKENS - estimateTokens(overlapPrefix + '\n\n')
      : MAX_CHUNK_TOKENS
    const bufferWithPara = buffer.length > 0 ? buffer + '\n\n' + para : para
    if (estimateTokens(bufferWithPara) > budgetForContent && buffer.length > 0) {
      const chunkText = overlapPrefix.length > 0
        ? overlapPrefix + '\n\n' + buffer
        : buffer
      const tokenCount = estimateTokens(chunkText)
      chunks.push({ heading, text: chunkText.trim(), tokenCount })
      overlapPrefix = extractOverlap(buffer)
      buffer = para
    } else {
      buffer = buffer.length > 0 ? buffer + '\n\n' + para : para
    }
  }

  if (buffer.length > 0) {
    const chunkText = overlapPrefix.length > 0
      ? overlapPrefix + '\n\n' + buffer
      : buffer
    const tokenCount = estimateTokens(chunkText)
    chunks.push({ heading, text: chunkText.trim(), tokenCount })
  }

  return chunks
}

function extractOverlap(text: string): string {
  const targetTokens = Math.ceil(estimateTokens(text) * 0.1)
  const targetChars = targetTokens * 4
  if (text.length <= targetChars) return text
  return text.slice(-targetChars)
}

function splitParagraphsProtectingFences(text: string): string[] {
  const lines = text.split('\n')
  const paragraphs: string[] = []
  let current: string[] = []
  let inFence = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (!inFence && FENCE_OPEN.test(line)) {
      // If there's accumulated non-fence text, flush it first
      if (current.length > 0) {
        const joined = current.join('\n').trim()
        if (joined.length > 0) paragraphs.push(joined)
        current = []
      }
      inFence = true
      current.push(line)
      continue
    }

    if (inFence) {
      current.push(line)
      // Close fence: a line that is just ``` (possibly with trailing whitespace)
      // but not the opening line itself
      if (FENCE_CLOSE.test(line) && current.length > 1) {
        const joined = current.join('\n').trim()
        if (joined.length > 0) paragraphs.push(joined)
        current = []
        inFence = false
      }
      continue
    }

    // Outside fence: split on blank lines
    if (line.trim() === '') {
      if (current.length > 0) {
        const joined = current.join('\n').trim()
        if (joined.length > 0) paragraphs.push(joined)
        current = []
      }
    } else {
      current.push(line)
    }
  }

  const joined = current.join('\n').trim()
  if (joined.length > 0) paragraphs.push(joined)

  return paragraphs
}

function extractRelations(
  sourceId: string,
  data: Record<string, unknown>,
): Relation[] {
  const relations: Relation[] = []

  if (Array.isArray(data.related)) {
    for (const target of data.related) {
      if (typeof target === 'string') {
        relations.push({
          sourceId,
          targetId: target,
          type: 'related-to' as RelationType,
        })
      }
    }
  }

  if (typeof data.supersedes === 'string') {
    relations.push({
      sourceId,
      targetId: data.supersedes,
      type: 'supersedes' as RelationType,
    })
  }

  if (typeof data.parent === 'string') {
    relations.push({
      sourceId,
      targetId: data.parent,
      type: 'parent' as RelationType,
    })
  }

  return relations
}
