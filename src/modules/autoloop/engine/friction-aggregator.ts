import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder, NoteRecord } from '../../../types.js';
import { indexSingleFile } from '../../../services/indexing.js';
import { writeFileSync } from 'node:fs';

export interface FrictionCluster {
  pattern: string;
  sessionCount: number;
  sessionIds: string[];
  noteIds: string[];
  titles: string[];
  confidence: number;
}

export interface AggregationResult {
  insightsScanned: number;
  clustersFound: number;
  promotedCount: number;
  duplicatesSkipped: number;
  observationsWritten: number;
  clusters: FrictionCluster[];
  errors: string[];
}

export interface AggregationOptions {
  minSessions?: number;
  similarityThreshold?: number;
  projectDir?: string;
}

const PROMOTION_THRESHOLD = 3;

/**
 * Aggregate friction insights across sessions to detect systemic patterns.
 * When the same friction type appears in 3+ sessions, creates a promoted
 * observation note with high impact and writes to workflow-improvement.
 */
export async function aggregateFrictionPatterns(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  opts?: AggregationOptions
): Promise<AggregationResult> {
  const minSessions = opts?.minSessions ?? PROMOTION_THRESHOLD;
  const similarityThreshold = opts?.similarityThreshold ?? 0.7;
  const projectDir = opts?.projectDir ?? process.cwd();
  const errors: string[] = [];

  const frictionNotes = loadFrictionInsights(db);
  if (frictionNotes.length === 0) {
    return emptyResult('No friction insights found');
  }

  const clusters = clusterByTitle(frictionNotes, similarityThreshold);
  const promotable = clusters.filter((c) => c.sessionCount >= minSessions);

  const existingObservations = loadExistingObservations(projectDir);
  let promotedCount = 0;
  let duplicatesSkipped = 0;
  let observationsWritten = 0;

  for (const cluster of promotable) {
    if (isDuplicate(cluster, existingObservations)) {
      duplicatesSkipped++;
      continue;
    }

    try {
      await writePromotedNote(db, config, embedder, cluster);
      promotedCount++;

      writeWorkflowObservation(projectDir, cluster);
      observationsWritten++;
    } catch (err) {
      errors.push(
        `Cluster "${cluster.pattern}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return {
    insightsScanned: frictionNotes.length,
    clustersFound: clusters.length,
    promotedCount,
    duplicatesSkipped,
    observationsWritten,
    clusters: promotable,
    errors,
  };
}

function loadFrictionInsights(db: BrainDB): NoteRecord[] {
  const moduleNoteIds = db.getModuleNoteIds({
    module: 'autoloop',
    type: 'autoloop-insight',
  });

  if (moduleNoteIds.length === 0) return [];

  const notes = db.getNotesByIds(moduleNoteIds);
  const frictionNotes: NoteRecord[] = [];

  for (const note of notes.values()) {
    if (!note.metadata) continue;
    try {
      const meta = JSON.parse(note.metadata) as Record<string, unknown>;
      if (meta.category === 'friction') {
        frictionNotes.push(note);
      }
    } catch {
      continue;
    }
  }

  return frictionNotes;
}

function clusterByTitle(notes: NoteRecord[], threshold: number): FrictionCluster[] {
  const clusters: FrictionCluster[] = [];
  const assigned = new Set<string>();

  for (let i = 0; i < notes.length; i++) {
    if (assigned.has(notes[i].id)) continue;

    const cluster: FrictionCluster = {
      pattern: notes[i].title,
      sessionCount: 1,
      sessionIds: extractSessionIds(notes[i]),
      noteIds: [notes[i].id],
      titles: [notes[i].title],
      confidence: extractConfidence(notes[i]),
    };
    assigned.add(notes[i].id);

    for (let j = i + 1; j < notes.length; j++) {
      if (assigned.has(notes[j].id)) continue;

      if (titleSimilarity(notes[i].title, notes[j].title) >= threshold) {
        assigned.add(notes[j].id);
        cluster.noteIds.push(notes[j].id);
        cluster.titles.push(notes[j].title);
        cluster.confidence = Math.max(cluster.confidence, extractConfidence(notes[j]));

        const sessions = extractSessionIds(notes[j]);
        for (const sid of sessions) {
          if (!cluster.sessionIds.includes(sid)) {
            cluster.sessionIds.push(sid);
            cluster.sessionCount++;
          }
        }
      }
    }

    clusters.push(cluster);
  }

  return clusters.sort((a, b) => b.sessionCount - a.sessionCount);
}

function titleSimilarity(a: string, b: string): number {
  const wordsA = normalizeWords(a);
  const wordsB = normalizeWords(b);

  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;

  return union === 0 ? 0 : intersection / union;
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function extractSessionIds(note: NoteRecord): string[] {
  if (!note.metadata) return [];
  try {
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    const sessions = meta.source_sessions;
    if (Array.isArray(sessions)) return sessions.map(String);
    return [];
  } catch {
    return [];
  }
}

function extractConfidence(note: NoteRecord): number {
  if (!note.metadata) return 0.5;
  try {
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    return typeof meta.confidence === 'number' ? meta.confidence : 0.5;
  } catch {
    return 0.5;
  }
}

interface ExistingObservation {
  description: string;
  category: string;
}

function loadExistingObservations(projectDir: string): ExistingObservation[] {
  const dirHash = projectDir.replace(/\//g, '-').replace(/^-/, '');
  const obsDir = join(homedir(), '.claude', 'workflow-improvement', 'observations', dirHash);
  const pendingPath = join(obsDir, 'pending.jsonl');

  if (!existsSync(pendingPath)) return [];

  const lines = readFileSync(pendingPath, 'utf-8').split('\n').filter(Boolean);
  const results: ExistingObservation[] = [];

  for (const line of lines) {
    try {
      const obs = JSON.parse(line) as ExistingObservation;
      if (obs.description) results.push(obs);
    } catch {
      continue;
    }
  }

  return results;
}

function isDuplicate(cluster: FrictionCluster, existing: ExistingObservation[]): boolean {
  const clusterWords = normalizeWords(cluster.pattern);
  if (clusterWords.length === 0) return false;

  for (const obs of existing) {
    const obsWords = normalizeWords(obs.description);
    const setA = new Set(clusterWords);
    const setB = new Set(obsWords);
    const intersection = [...setA].filter((w) => setB.has(w)).length;
    const union = new Set([...setA, ...setB]).size;
    const similarity = union === 0 ? 0 : intersection / union;

    if (similarity >= 0.6) return true;
  }

  return false;
}

async function writePromotedNote(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  cluster: FrictionCluster
): Promise<string> {
  const notesDir = join(config.notesDir, 'modules', 'autoloop');
  mkdirSync(notesDir, { recursive: true });

  const slug = cluster.pattern
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

  const fileName = `promoted-${slug}.md`;
  const filePath = join(notesDir, fileName);
  const now = new Date().toISOString().slice(0, 10);

  const markdown =
    [
      '---',
      `title: "${escapeYaml(cluster.pattern)}"`,
      'type: autoloop-insight',
      'tier: slow',
      'module: autoloop',
      'visibility: private',
      'category: friction',
      'promoted: true',
      'impact: high',
      `confidence: ${cluster.confidence}`,
      `source_sessions: [${cluster.sessionIds.join(', ')}]`,
      `source_session_count: ${cluster.sessionCount}`,
      `created: ${now}`,
      '---',
      '',
      `# ${cluster.pattern} (Systemic)`,
      '',
      `This friction pattern has been observed across **${cluster.sessionCount} sessions**, indicating a systemic issue.`,
      '',
      '## Occurrences',
      '',
      ...cluster.titles.map((t) => `- ${t}`),
      '',
      '## Sessions',
      '',
      ...cluster.sessionIds.map((s) => `- ${s}`),
      '',
      `**Impact:** high`,
      `**Confidence:** ${(cluster.confidence * 100).toFixed(0)}%`,
      `**Promoted:** ${now}`,
    ].join('\n') + '\n';

  writeFileSync(filePath, markdown, 'utf-8');

  const content = readFileSync(filePath, 'utf-8');
  const hash = createHash('sha256').update(content).digest('hex');
  return await indexSingleFile(db, embedder, filePath, content, hash, Date.now());
}

function writeWorkflowObservation(projectDir: string, cluster: FrictionCluster): void {
  const dirHash = projectDir.replace(/\//g, '-').replace(/^-/, '');
  const obsDir = join(homedir(), '.claude', 'workflow-improvement', 'observations', dirHash);
  mkdirSync(obsDir, { recursive: true });

  const pendingPath = join(obsDir, 'pending.jsonl');
  const observation = {
    date: new Date().toISOString(),
    category: 'friction-pattern',
    description: `Systemic: ${cluster.pattern} (seen in ${cluster.sessionCount} sessions)`,
    source: 'autoloop-friction-aggregation',
    project: projectDir,
    impact: 'high',
  };

  appendFileSync(pendingPath, JSON.stringify(observation) + '\n', 'utf-8');
}

function escapeYaml(text: string): string {
  return text.replace(/"/g, '\\"');
}

function emptyResult(error?: string): AggregationResult {
  return {
    insightsScanned: 0,
    clustersFound: 0,
    promotedCount: 0,
    duplicatesSkipped: 0,
    observationsWritten: 0,
    clusters: [],
    errors: error ? [error] : [],
  };
}
