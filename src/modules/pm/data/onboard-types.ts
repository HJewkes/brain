export type ComponentType = 'node' | 'go' | 'rust' | 'python' | 'java' | 'react-native' | 'unknown';

export interface DetectedComponent {
  name: string;
  path: string;
  type: ComponentType;
  entryPoints: string[];
  docPaths: string[];
  docCount: number;
}

export interface ScoredDoc {
  path: string;
  score: number;
  component?: string;
  ingested: boolean;
  noteSlug?: string;
}

export interface OnboardPhaseResult {
  completedAt: string;
  [key: string]: unknown;
}

export interface OnboardManifest {
  version: 1;
  project: string;
  createdAt: string;
  cwd: string;
  components: DetectedComponent[];
  docs: {
    discovered: number;
    ingested: number;
    items: ScoredDoc[];
  };
  phases: {
    detect?: OnboardPhaseResult & { componentCount: number };
    create?: OnboardPhaseResult & { projectCreated: boolean };
    discover?: OnboardPhaseResult & { docsFound: number };
    ingest?: OnboardPhaseResult & { docsIngested: number };
  };
}
