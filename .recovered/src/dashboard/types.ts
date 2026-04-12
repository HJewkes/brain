export interface AuditReport {
  timestamp: string;
  database: { path: string; sizeBytes: number; schemaVersion: number };
  notes: {
    total: number;
    byModule: Record<string, number>;
    byTier: Record<string, number>;
    byType: Record<string, number>;
  };
  chunks: { total: number; embedded: number; pending: number };
  memories: {
    total: number;
    active: number;
    superseded: number;
    byCategory: Record<string, number>;
  };
  sessions: { total: number; events: number; chunks: number };
  agents: { total: number; active: number; completed: number; worktrees: number };
  pm: { projects: number; tasks: number; tasksByStatus: Record<string, number> };
  search: { ftsEntries: number; trigramEntries: number; vectorRows: number };
  inbox: { total: number; pending: number; failed: number; feeds: number };
  relations: { total: number; byType: Record<string, number> };
  cache: { statusCachePath: string; statusCacheAge: number | null };
  config: { notesDir: string; embedder: string };
}

export interface StatusCache {
  agents?: Array<{
    name?: string;
    task?: string;
    branch?: string;
    status?: string;
  }>;
  sessions?: {
    eventCount?: number;
    frictionCount?: number;
    prsCreated?: number;
  };
  [key: string]: unknown;
}

declare global {
  interface Window {
    __AUDIT__: AuditReport;
    __STATUS__: StatusCache;
  }
}
