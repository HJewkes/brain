import type { BrainDB } from '../../../services/brain-db.js';
import type { NoteRecord } from '../../../types.js';

export interface SkillCounter {
  skillName: string;
  uses: number;
  successes: number;
  failures: number;
  gpaSum: number;
  gpaCount: number;
  utilityScore: number;
  version: number;
  lastUpdated: string;
}

export interface SkillUpdateInput {
  success: boolean;
  gpa: number | null;
}

function skillCounterSlug(skillName: string): string {
  return `skill-counter-${skillName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function metaToCounter(meta: Record<string, unknown>, skillName: string): SkillCounter {
  const uses = Number(meta.uses ?? 0);
  const successes = Number(meta.successes ?? 0);
  const gpaSum = Number(meta.gpaSum ?? 0);
  const gpaCount = Number(meta.gpaCount ?? 0);
  return {
    skillName,
    uses,
    successes,
    failures: Number(meta.failures ?? 0),
    gpaSum,
    gpaCount,
    utilityScore: Number(meta.utilityScore ?? 0),
    version: Number(meta.version ?? 0),
    lastUpdated: String(meta.lastUpdated ?? new Date().toISOString()),
  };
}

function zeroCounter(skillName: string): SkillCounter {
  return {
    skillName,
    uses: 0,
    successes: 0,
    failures: 0,
    gpaSum: 0,
    gpaCount: 0,
    utilityScore: 0,
    version: 0,
    lastUpdated: new Date().toISOString(),
  };
}

function readCounterFromDb(db: BrainDB, skillName: string): SkillCounter | null {
  const noteIds = db.getModuleNoteIds({ module: 'sessions', type: 'skill-counter' });
  if (noteIds.length === 0) return null;
  const notes = db.getNotesByIds(noteIds);
  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.skillName === skillName) {
      return metaToCounter(meta, skillName);
    }
  }
  return null;
}

function writeCounterToDb(db: BrainDB, counter: SkillCounter): void {
  const slug = skillCounterSlug(counter.skillName);
  const now = new Date().toISOString().slice(0, 10);
  const record: NoteRecord = {
    id: slug,
    filePath: `__skill-counters__/${slug}.md`,
    title: `Skill Counter: ${counter.skillName}`,
    type: 'skill-counter',
    tier: 'fast',
    category: null,
    tags: null,
    summary: null,
    confidence: null,
    status: 'current',
    sources: null,
    createdAt: now,
    modifiedAt: counter.lastUpdated,
    lastReviewed: null,
    reviewInterval: null,
    expires: null,
    metadata: JSON.stringify(counter),
    module: 'sessions',
    moduleInstance: null,
    contentDir: null,
    l0Abstract: null,
    l1Overview: null,
  };
  db.upsertNote(record);
}

export function getSkillCounter(db: BrainDB, skillName: string): SkillCounter {
  return readCounterFromDb(db, skillName) ?? zeroCounter(skillName);
}

export function updateSkillCounter(
  db: BrainDB,
  skillName: string,
  currentVersion: number,
  update: SkillUpdateInput
): void {
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = readCounterFromDb(db, skillName) ?? zeroCounter(skillName);
    if (stored.version !== currentVersion) {
      continue;
    }

    const uses = stored.uses + 1;
    const successes = update.success ? stored.successes + 1 : stored.successes;
    const failures = update.success ? stored.failures : stored.failures + 1;
    const gpaSum = update.gpa != null ? stored.gpaSum + update.gpa : stored.gpaSum;
    const gpaCount = update.gpa != null ? stored.gpaCount + 1 : stored.gpaCount;
    const utilityScore = uses > 0 && gpaCount > 0 ? (successes / uses) * (gpaSum / gpaCount) : 0;

    writeCounterToDb(db, {
      skillName,
      uses,
      successes,
      failures,
      gpaSum,
      gpaCount,
      utilityScore,
      version: currentVersion + 1,
      lastUpdated: new Date().toISOString(),
    });
    return;
  }

  console.warn(
    `[skill-counters] version conflict after 3 attempts for skill "${skillName}", skipping`
  );
}

export function listSkillCounters(db: BrainDB): SkillCounter[] {
  const noteIds = db.getModuleNoteIds({ module: 'sessions', type: 'skill-counter' });
  if (noteIds.length === 0) return [];
  const notes = db.getNotesByIds(noteIds);
  const counters: SkillCounter[] = [];
  for (const [, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (typeof meta.skillName === 'string') {
      counters.push(metaToCounter(meta, meta.skillName));
    }
  }
  return counters.sort((a, b) => b.utilityScore - a.utilityScore);
}
