/** Kinds of exported symbols the scanner can detect */
export type ExportKind = 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum';

/** A single public export extracted from a module */
export interface ExportSignature {
  name: string;
  kind: ExportKind;
  /** Full signature string (e.g., "export function search(db: BrainDB): Promise<Result[]>") */
  signature: string;
}

/** A dependency on another module within the same project */
export interface InternalDependency {
  /** Relative import specifier */
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

/** Frontmatter fields for architecture notes */
export interface ArchitectureNoteFrontmatter {
  'module-path': string;
  language: string;
  'exports-hash': string;
  framework?: string;
  dependencies?: string[];
  'last-analyzed'?: string;
}

/** What the scanner produces for a single module file */
export interface ModuleSummary {
  /** Relative path from project root */
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
