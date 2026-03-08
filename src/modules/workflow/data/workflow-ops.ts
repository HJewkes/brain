import { readFileSync, existsSync } from 'node:fs';
import type { BrainDB } from '../../../services/brain-db.js';
import type { BrainConfig, Embedder } from '../../../types.js';
import type { WorkflowDefinition, WorkflowNoteMetadata } from '../types.js';
import { validateDag } from '../engine/dag.js';
import { ok, fail, type Result } from '../../../errors.js';

type RegisterErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_NOTE_TYPE'
  | 'PARSE_ERROR'
  | 'INVALID_DEFINITION'
  | 'CYCLE_DETECTED';

function extractNoteBody(filePath: string): string {
  if (!existsSync(filePath)) return '';
  const content = readFileSync(filePath, 'utf-8');
  const fmEnd = content.indexOf('\n---', 4);
  if (fmEnd === -1) return '';
  let body = content.slice(fmEnd + 4).trim();
  if (body.startsWith('#')) {
    const headingEnd = body.indexOf('\n');
    if (headingEnd === -1) return '';
    body = body.slice(headingEnd + 1).trim();
  }
  return body;
}

export async function registerWorkflow(
  db: BrainDB,
  _config: BrainConfig,
  _embedder: Embedder,
  noteId: string,
): Promise<Result<WorkflowNoteMetadata, RegisterErrorCode>> {
  const note = db.getNoteById(noteId);
  if (!note) {
    return fail('NOT_FOUND', `Note "${noteId}" not found`);
  }

  if (note.type !== 'workflow') {
    return fail('INVALID_NOTE_TYPE', `Note "${noteId}" is type "${note.type}", expected "workflow"`);
  }

  const body = extractNoteBody(note.filePath);
  let definition: WorkflowDefinition;
  try {
    definition = JSON.parse(body) as WorkflowDefinition;
  } catch {
    return fail('PARSE_ERROR', `Failed to parse workflow definition as JSON`);
  }

  const dagResult = validateDag(definition);
  if (!dagResult.ok) {
    const code = dagResult.error.code as RegisterErrorCode;
    return fail(code, dagResult.error.message, dagResult.error.details);
  }

  const existingMeta = note.metadata ? (JSON.parse(note.metadata) as Record<string, unknown>) : {};
  const currentVersion =
    existingMeta.registration_status === 'registered'
      ? ((existingMeta.version as number) ?? 0)
      : 0;
  const newVersion = currentVersion + 1;

  const updatedMeta: Record<string, unknown> = {
    ...existingMeta,
    registration_status: 'registered',
    version: newVersion,
    step_count: definition.steps.length,
    edge_count: definition.edges.length,
    name: definition.name,
    display_id: existingMeta.display_id ?? noteId,
  };

  const updatedNote = { ...note, metadata: JSON.stringify(updatedMeta) };
  db.upsertNote(updatedNote);

  const workflowMeta: WorkflowNoteMetadata = {
    display_id: (updatedMeta.display_id as string) ?? noteId,
    name: definition.name,
    version: newVersion,
    registration_status: 'registered',
    step_count: definition.steps.length,
    edge_count: definition.edges.length,
  };

  return ok(workflowMeta);
}
