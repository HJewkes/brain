import type { ContentClass, Embedder, NoteType } from '../types.js';
import { splitIntoSections } from './markdown-parser.js';
import { classifySection, classifySectionWithEmbedding } from './content-classifier.js';
import type { ClassifiedSection } from './content-classifier.js';
import matter from 'gray-matter';

export interface SplitResult {
  sourceNote: { frontmatter: Record<string, unknown>; content: string };
  derivedNotes: Array<{
    content: string;
    contentClass: ContentClass;
    suggestedType: NoteType;
    suggestedTitle: string;
    confidence: number;
  }>;
}

const CLASS_TO_TYPE: Record<ContentClass, { type: NoteType; tier: 'slow' | 'fast' }> = {
  'task-list': { type: 'note', tier: 'fast' },
  'bug-report': { type: 'note', tier: 'fast' },
  'architecture': { type: 'research', tier: 'slow' },
  'requirements': { type: 'research', tier: 'slow' },
  'meeting-notes': { type: 'meeting', tier: 'fast' },
  'reference': { type: 'note', tier: 'slow' },
  'general': { type: 'note', tier: 'slow' },
};

const MIN_SECTION_LENGTH = 20;

export async function splitDocument(
  content: string,
  filePath: string,
  embedder: Embedder,
  opts?: { minSplitConfidence?: number }
): Promise<SplitResult> {
  const minConfidence = opts?.minSplitConfidence ?? 0.7;
  const { data: frontmatter, content: body } = matter(content);
  const sections = splitIntoSections(body);

  const classified: ClassifiedSection[] = [];
  for (const section of sections) {
    const text = section.lines.join('\n').trim();
    if (text.length < MIN_SECTION_LENGTH) continue;

    let result = classifySection(text, section.heading);
    if (result.contentClass === 'general' && result.confidence < minConfidence) {
      result = await classifySectionWithEmbedding(text, section.heading, embedder);
    }
    classified.push(result);
  }

  if (classified.length === 0) {
    return { sourceNote: { frontmatter, content: body }, derivedNotes: [] };
  }

  const classCounts = new Map<ContentClass, number>();
  for (const c of classified) {
    classCounts.set(c.contentClass, (classCounts.get(c.contentClass) ?? 0) + 1);
  }

  const distinctHighConfidence = [...classCounts.keys()].filter((cls) =>
    classified.some((c) => c.contentClass === cls && c.confidence >= minConfidence)
  );

  if (distinctHighConfidence.length < 2) {
    return { sourceNote: { frontmatter, content: body }, derivedNotes: [] };
  }

  const dominantClass = [...classCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const derivedNotes: SplitResult['derivedNotes'] = [];
  let currentGroup: ClassifiedSection[] = [];
  let currentClass: ContentClass | null = null;

  for (const section of classified) {
    if (section.contentClass === dominantClass) {
      if (currentGroup.length > 0 && currentClass !== null) {
        flushGroup(currentGroup, currentClass, derivedNotes, minConfidence);
      }
      currentGroup = [];
      currentClass = null;
      continue;
    }

    if (currentClass === section.contentClass) {
      currentGroup.push(section);
    } else {
      if (currentGroup.length > 0 && currentClass !== null) {
        flushGroup(currentGroup, currentClass, derivedNotes, minConfidence);
      }
      currentGroup = [section];
      currentClass = section.contentClass;
    }
  }

  if (currentGroup.length > 0 && currentClass !== null) {
    flushGroup(currentGroup, currentClass, derivedNotes, minConfidence);
  }

  return { sourceNote: { frontmatter, content: body }, derivedNotes };
}

function flushGroup(
  group: ClassifiedSection[],
  contentClass: ContentClass,
  derivedNotes: SplitResult['derivedNotes'],
  minConfidence: number
): void {
  const avgConfidence = group.reduce((s, c) => s + c.confidence, 0) / group.length;
  if (avgConfidence < minConfidence) return;

  const content = group.map((c) => c.content).join('\n\n');
  const title = group[0].heading ?? `${contentClass} section`;
  const mapping = CLASS_TO_TYPE[contentClass];

  derivedNotes.push({
    content,
    contentClass,
    suggestedType: mapping.type,
    suggestedTitle: title,
    confidence: avgConfidence,
  });
}
