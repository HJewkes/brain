import type { BrainDB } from './brain-db.js';
import type { NoteRecord, MemoryEntry } from '../types.js';

// === Types ===

export interface BrainUri {
  scheme: 'brain';
  type: BrainUriType;
  id: string;
  fragment?: string;
  query?: Record<string, string>;
}

export type BrainUriType = 'notes' | 'memories' | 'search' | 'tasks' | 'workstreams';

const VALID_TYPES: Set<string> = new Set(['notes', 'memories', 'search', 'tasks', 'workstreams']);

export interface ResolvedNote {
  type: 'note';
  note: NoteRecord;
  section?: string;
}

export interface ResolvedMemory {
  type: 'memory';
  memory: MemoryEntry;
}

export interface ResolvedSearch {
  type: 'search';
  query: string;
  params: Record<string, string>;
}

export interface ResolvedTask {
  type: 'task';
  displayId: string;
  noteId: string;
  metadata: Record<string, unknown>;
}

export interface ResolvedWorkstream {
  type: 'workstream';
  displayId: string;
  noteId: string;
  metadata: Record<string, unknown>;
}

export type ResolvedUri =
  | ResolvedNote
  | ResolvedMemory
  | ResolvedSearch
  | ResolvedTask
  | ResolvedWorkstream;

// === Parsing ===

export function parseBrainUri(uri: string): BrainUri {
  if (!uri.startsWith('brain://')) {
    throw new Error(`Invalid brain URI: must start with "brain://": ${uri}`);
  }

  const withoutScheme = uri.slice('brain://'.length);
  const [pathAndFragment, ...rest] = withoutScheme.split('?');
  const queryString = rest.join('?');

  const [pathPart, fragment] = pathAndFragment.split('#', 2);
  const segments = pathPart.split('/').filter(Boolean);

  if (segments.length === 0) {
    throw new Error(`Invalid brain URI: missing resource type: ${uri}`);
  }

  const type = segments[0];
  if (!VALID_TYPES.has(type)) {
    throw new Error(`Invalid brain URI type "${type}": ${uri}`);
  }

  const id = segments.slice(1).join('/');
  if (!id && type !== 'search') {
    throw new Error(`Invalid brain URI: missing resource id: ${uri}`);
  }

  const query = queryString ? parseQueryString(queryString) : undefined;

  return {
    scheme: 'brain',
    type: type as BrainUriType,
    id,
    ...(fragment ? { fragment } : {}),
    ...(query ? { query } : {}),
  };
}

function parseQueryString(qs: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of qs.split('&')) {
    const [key, ...vals] = pair.split('=');
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(vals.join('='));
    }
  }
  return params;
}

// === Building ===

export interface BuildUriOptions {
  fragment?: string;
  query?: Record<string, string>;
}

export function buildBrainUri(type: BrainUriType, id: string, options?: BuildUriOptions): string {
  let uri = `brain://${type}`;
  if (id) {
    uri += `/${id}`;
  }

  if (options?.fragment) {
    uri += `#${options.fragment}`;
  }

  if (options?.query && Object.keys(options.query).length > 0) {
    const qs = Object.entries(options.query)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    uri += `?${qs}`;
  }

  return uri;
}

// === Resolution ===

export function resolveBrainUri(db: BrainDB, uri: string): ResolvedUri {
  const parsed = parseBrainUri(uri);
  switch (parsed.type) {
    case 'notes':
      return resolveNote(db, parsed);
    case 'memories':
      return resolveMemory(db, parsed);
    case 'search':
      return resolveSearch(parsed);
    case 'tasks':
      return resolveTask(db, parsed);
    case 'workstreams':
      return resolveWorkstream(db, parsed);
  }
}

function resolveNote(db: BrainDB, parsed: BrainUri): ResolvedNote {
  const note = db.getNoteById(parsed.id);
  if (!note) {
    throw new Error(`Note not found: ${parsed.id}`);
  }
  return {
    type: 'note',
    note,
    ...(parsed.fragment ? { section: parsed.fragment } : {}),
  };
}

function resolveMemory(db: BrainDB, parsed: BrainUri): ResolvedMemory {
  const memory = db.getMemory(parsed.id);
  if (!memory) {
    throw new Error(`Memory not found: ${parsed.id}`);
  }
  return { type: 'memory', memory };
}

function resolveSearch(parsed: BrainUri): ResolvedSearch {
  const q = parsed.query?.q ?? parsed.id ?? '';
  const params = { ...parsed.query };
  delete params.q;
  return { type: 'search', query: q, params };
}

function resolveTask(db: BrainDB, parsed: BrainUri): ResolvedTask {
  const result = findModuleNote(db, parsed.id, 'task');
  return { type: 'task', ...result };
}

function resolveWorkstream(db: BrainDB, parsed: BrainUri): ResolvedWorkstream {
  const result = findModuleNote(db, parsed.id, 'workstream');
  return { type: 'workstream', ...result };
}

function findModuleNote(
  db: BrainDB,
  displayId: string,
  noteType: 'task' | 'workstream'
): { displayId: string; noteId: string; metadata: Record<string, unknown> } {
  const noteIds = db.getModuleNoteIds({ module: 'pm', type: noteType });
  const notes = db.getNotesByIds(noteIds);

  for (const [noteId, note] of notes) {
    if (!note.metadata) continue;
    const meta = JSON.parse(note.metadata) as Record<string, unknown>;
    if (meta.display_id === displayId) {
      return { displayId, noteId, metadata: meta };
    }
  }

  throw new Error(`${noteType} not found: ${displayId}`);
}
