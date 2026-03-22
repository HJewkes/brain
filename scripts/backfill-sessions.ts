#!/usr/bin/env npx tsx
/**
 * Backfill existing sessions with V2 enrichment fields.
 *
 * For each ingested session:
 *  - If JSONL still exists: re-parse to get session_files, segments, and classification
 *  - If JSONL missing: compute classification from existing metadata only
 *
 * Usage:
 *   npx tsx scripts/backfill-sessions.ts
 *   npx tsx scripts/backfill-sessions.ts --dry-run
 *   npx tsx scripts/backfill-sessions.ts --limit 10
 */

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildStructuredEvents, writeStructuredEvents } from '../src/modules/sessions/ingestion/structured-events.js';
import { homedir } from 'node:os';

import { loadConfig } from '../src/services/config.js';
import { BrainDB } from '../src/services/brain-db.js';
import { createEmbedder } from '../src/adapters/index.js';
import { parseSessionFile } from '../src/modules/sessions/engine/parser.js';
import { classifySession } from '../src/modules/sessions/engine/classifier.js';
import { buildSegments } from '../src/modules/sessions/engine/segmenter.js';
import { createSegments } from '../src/modules/sessions/data/segment-ops.js';
import { populateSessionFiles } from '../src/modules/sessions/data/session-ops.js';
import type { SessionAnalytics } from '../src/modules/sessions/types.js';
import type { NoteRecord, BrainConfig, Embedder } from '../src/types.js';

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes('--dry-run');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg >= 0 ? parseInt(process.argv[limitArg + 1] ?? '0', 10) : 0;

// ---------------------------------------------------------------------------
// JSONL path resolution
// ---------------------------------------------------------------------------

function resolveJsonlPath(sessionId: string, projectDir: string): string | null {
  const claudeDir = join(homedir(), '.claude', 'projects');
  if (!existsSync(claudeDir)) return null;

  // Primary: encoded directory name pattern (/foo/bar → -foo-bar)
  const encoded = projectDir.replace(/\//g, '-');
  const direct = join(claudeDir, encoded, `${sessionId}.jsonl`);
  if (existsSync(direct)) return direct;

  // Fallback: scan all project dirs
  let dirs: string[];
  try {
    dirs = readdirSync(claudeDir);
  } catch {
    return null;
  }

  for (const dir of dirs) {
    const candidate = join(claudeDir, dir, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Classification from existing metadata (no JSONL available)
// ---------------------------------------------------------------------------

type SimpleClassification = { sessionType: string; outcome: string; costUsd: number };

const PRICING: Record<string, { input: number; output: number }> = {
  opus: { input: 15, output: 75 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 0.8, output: 4 },
};

function classifyFromMeta(meta: Record<string, unknown>): SimpleClassification {
  const toolCalls = (meta.tool_calls as number) ?? 0;
  const errorCount = (meta.error_count as number) ?? 0;
  const errorRate = toolCalls > 0 ? errorCount / toolCalls : 0;
  const tokensIn = (meta.tokens_input as number) ?? 0;
  const tokensOut = (meta.tokens_output as number) ?? 0;

  const sessionType = toolCalls > 0 ? 'mixed' : 'planning';

  let outcome: string;
  if (toolCalls === 0) outcome = 'unknown';
  else if (errorRate > 0.3 || toolCalls < 5) outcome = 'abandoned';
  else if (toolCalls > 10) outcome = 'partial';
  else outcome = 'unknown';

  const model = ((meta.agent_model as string) ?? '').toLowerCase();
  const tier = model.includes('haiku') ? 'haiku' : model.includes('sonnet') ? 'sonnet' : 'opus';
  const p = PRICING[tier];
  const costUsd = (tokensIn * p.input + tokensOut * p.output) / 1_000_000;

  return { sessionType, outcome, costUsd };
}

// ---------------------------------------------------------------------------
// Enrichment helpers
// ---------------------------------------------------------------------------

async function enrichFromJsonl(
  db: BrainDB,
  config: BrainConfig,
  embedder: Embedder,
  sessionId: string,
  noteId: string,
  note: NoteRecord,
  jsonlPath: string,
  dryRun: boolean
): Promise<{ filesCount: number; segmentsCount: number; wroteStructuredEvents: boolean }> {
  const analytics: SessionAnalytics = await parseSessionFile(jsonlPath);
  const classification = classifySession(analytics);
  const segments = buildSegments(analytics);
  const meta = JSON.parse(note.metadata ?? '{}') as Record<string, unknown>;
  const displayId = meta.display_id as string;

  // Build structured events regardless of dry-run (for reporting)
  const structuredEvents = buildStructuredEvents(analytics);

  if (dryRun) {
    return { filesCount: analytics.filesTouched.size, segmentsCount: segments.length, wroteStructuredEvents: true };
  }

  meta.session_type = meta.session_type ?? classification.sessionType;
  meta.outcome = meta.outcome ?? classification.outcome;
  meta.cost_usd = meta.cost_usd ?? classification.costUsd;
  meta.jsonl_path = jsonlPath;

  db.upsertNote({ ...note, metadata: JSON.stringify(meta) });

  try {
    populateSessionFiles(db, sessionId, analytics.filesTouched, analytics.projectDir);
  } catch {
    // session_files table may not exist — non-fatal
  }

  if (segments.length > 1) {
    await createSegments(
      db,
      embedder,
      displayId,
      noteId,
      analytics,
      segments,
      config.notesDir
    );
  }

  writeStructuredEvents(config.notesDir, displayId, structuredEvents);

  return { filesCount: analytics.filesTouched.size, segmentsCount: segments.length, wroteStructuredEvents: true };
}

function enrichFromMeta(
  db: BrainDB,
  note: NoteRecord,
  dryRun: boolean
): boolean {
  const meta = JSON.parse(note.metadata ?? '{}') as Record<string, unknown>;
  if (meta.session_type) return false; // already classified

  const classification = classifyFromMeta(meta);
  if (dryRun) return true;

  meta.session_type = classification.sessionType;
  meta.outcome = classification.outcome;
  meta.cost_usd = classification.costUsd;

  db.upsertNote({ ...note, metadata: JSON.stringify(meta) });
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = loadConfig();
  const db = new BrainDB(config.dbPath);
  const embedder = createEmbedder(config);

  let backfilled = 0;
  let skipped = 0;
  let errors = 0;
  let structuredEventsWritten = 0;

  try {
    const noteIds = db.getModuleNoteIds({ module: 'sessions', type: 'session' });
    const notes = db.getNotesByIds(noteIds);
    const entries = [...notes.entries()];
    const toProcess = LIMIT > 0 ? entries.slice(0, LIMIT) : entries;

    console.log(`Found ${noteIds.length} session notes. Processing ${toProcess.length}.`);
    if (DRY_RUN) console.log('DRY RUN — no writes will occur.');
    console.log('');

    for (let i = 0; i < toProcess.length; i++) {
      const [noteId, note] = toProcess[i];
      if (!note.metadata) { skipped++; continue; }

      const meta = JSON.parse(note.metadata) as Record<string, unknown>;
      const sessionId = meta.session_id as string | undefined;
      const projectDir = meta.project_dir as string | undefined;
      const displayId = meta.display_id as string | undefined;

      if (!sessionId || !displayId) { skipped++; continue; }

      // Check if structured-events.json already exists
      const eventsPath = join(config.notesDir, 'modules', 'sessions', displayId, 'structured-events.json');
      const hasStructuredEvents = existsSync(eventsPath);
      const alreadyEnriched = !!(meta.session_type && meta.jsonl_path);

      // Skip if already fully enriched AND has structured events
      if (alreadyEnriched && hasStructuredEvents) { skipped++; continue; }

      try {
        const jsonlPath = (meta.jsonl_path as string) ?? (projectDir ? resolveJsonlPath(sessionId, projectDir) : null);

        if (jsonlPath && existsSync(jsonlPath)) {
          if (alreadyEnriched && !hasStructuredEvents) {
            // Only need structured events — parse JSONL and write events
            const analytics = await parseSessionFile(jsonlPath);
            const events = buildStructuredEvents(analytics);
            if (!DRY_RUN) {
              writeStructuredEvents(config.notesDir, displayId, events);
            }
            structuredEventsWritten++;
            console.log(`[${displayId}] backfilled structured-events.json (${events.turns.length} turns)`);
          } else {
            const result = await enrichFromJsonl(db, config, embedder, sessionId, noteId, note, jsonlPath, DRY_RUN);
            if (result.wroteStructuredEvents) structuredEventsWritten++;
            console.log(`[${displayId}] enriched from JSONL — files: ${result.filesCount}, segments: ${result.segmentsCount}, structured-events: yes`);
            backfilled++;
          }
        } else {
          const classified = enrichFromMeta(db, note, DRY_RUN);
          if (classified) {
            console.log(`[${displayId}] classified from metadata (no JSONL)`);
            backfilled++;
          } else {
            skipped++;
          }
        }
      } catch (err) {
        errors++;
        console.error(`[${displayId ?? sessionId}] ERROR: ${err instanceof Error ? err.message : String(err)}`);
      }

      if ((i + 1) % 10 === 0) {
        console.log(`  -- progress: ${i + 1}/${toProcess.length} (${backfilled} updated, ${skipped} skipped, ${errors} errors)`);
      }
    }

    console.log('');
    console.log(`Backfill complete: ${backfilled} updated, ${skipped} skipped, ${errors} errors, ${structuredEventsWritten} structured-events.json written`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
