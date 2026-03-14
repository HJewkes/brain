/** Kinds of exported symbols the scanner can detect */
export type ExportKind = 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum';

/** A single public export extracted from a module */
export interface ExportSignature {
  name: string;
  kind: ExportKind;
  /** Full signature string (e.g., "search(db: BrainDB, query: string): Promise<SearchResult[]>") */
  signature: string;
}

/** A dependency on another module within the same project */
export interface InternalDependency {
  /** Relative path from project root */
  path: string;
  /** Imported symbol names */
  imports: string[];
}

/** A dependency on an external package */
export interface ExternalDependency {
  package: string;
  imports: string[];
}

/** Dependency graph for a module */
export interface ModuleDependencies {
  internal: InternalDependency[];
  external: ExternalDependency[];
}

/** What the scanner produces for a single module file or directory */
export interface ModuleSummary {
  /** Relative path from project root (e.g., "src/services/search.ts") */
  modulePath: string;
  /** Primary programming language */
  language: string;
  /** Public exports with their signatures */
  exports: ExportSignature[];
  /** Internal and external dependencies */
  dependencies: ModuleDependencies;
  /** SHA-256 hash of sorted export signatures for staleness detection */
  exportHash: string;
}

/** Metadata stored in the architecture note's `metadata` JSON column */
export interface ArchitectureNoteMetadata {
  project: string;
  module_path: string;
  purpose: string;
  language: string;
  export_hash: string;
  scanned_at: string;
  exports: ExportSignature[];
  dependencies: ModuleDependencies;
  invariants: string[];
}

/**
 * Architecture note frontmatter.
 *
 * Extends the base NoteFrontmatter pattern used by all brain notes.
 * The `type` field is always "architecture" and `module` is always "codebase".
 */
export interface ArchitectureNoteFrontmatter {
  id: string;
  title: string;
  type: 'architecture';
  tier: 'slow';
  module: 'codebase';
  'module-instance': string;
  status?: 'current' | 'outdated' | 'deprecated' | 'draft';
  tags?: string[];
  project: string;
  module_path: string;
  purpose: string;
  language: string;
  export_hash: string;
  scanned_at: string;
}
