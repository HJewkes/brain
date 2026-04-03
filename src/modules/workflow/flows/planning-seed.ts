/**
 * Planning seed — deterministic pre-processing step that gathers
 * pre-existing context (brain notes, files, prior research, interview
 * answers) before the LLM-driven planning pipeline begins.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SeedResult } from '../runtime/types.js';

interface SeedParams {
  projectDir: string;
  planId: string;
  brainNotes?: string;
  files?: string;
  priorContext?: string;
  interviewAnswers?: string;
}

interface CoverageFlags {
  hasCodebaseReview: boolean;
  hasExternalResearch: boolean;
  hasRequirements: boolean;
}

/** Read a single file, returning its content or null on failure. */
function readFileSafe(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

/** Resolve a brain note reference to an absolute path. Supports:
 *  - Full relative path: `research/competitive-analysis-openspace.md`
 *  - Slug (filename without extension): `competitive-analysis-openspace`
 *  - Subdirectory/slug: `research/competitive-analysis-openspace`
 */
function resolveBrainNotePath(projectDir: string, ref: string): string | null {
  const notesDir = resolve(projectDir, '.brain', 'notes');
  const normalized = ref.endsWith('.md') ? ref : `${ref}.md`;

  // Direct path (includes subdirectory)
  const direct = resolve(notesDir, normalized);
  if (existsSync(direct)) return direct;

  // Search common subdirectories for a flat slug
  const filename = normalized.includes('/') ? null : normalized;
  if (filename) {
    for (const sub of ['research', 'imports', 'modules', 'decisions', 'notes', 'logs']) {
      const candidate = resolve(notesDir, sub, filename);
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

/** Collect brain note contents from comma-separated references. */
function gatherBrainNotes(projectDir: string, refs: string): string[] {
  const sections: string[] = [];
  for (const raw of refs.split(',')) {
    const ref = raw.trim();
    if (!ref) continue;
    const notePath = resolveBrainNotePath(projectDir, ref);
    if (notePath) {
      const content = readFileSafe(notePath);
      if (content) {
        sections.push(`### Brain Note: ${ref}\n\n${content}`);
        continue;
      }
    }
    sections.push(`### Brain Note: ${ref}\n\n*(not found at .brain/notes/)*`);
  }
  return sections;
}

/** Collect file contents from comma-separated paths. */
function gatherFiles(projectDir: string, paths: string): string[] {
  const sections: string[] = [];
  for (const raw of paths.split(',')) {
    const filePath = raw.trim();
    if (!filePath) continue;
    const absPath = resolve(projectDir, filePath);
    const content = readFileSafe(absPath);
    if (content) {
      sections.push(`### File: ${filePath}\n\n\`\`\`\n${content}\n\`\`\``);
    } else {
      sections.push(`### File: ${filePath}\n\n*(not found)*`);
    }
  }
  return sections;
}

/** Assess what the pre-existing context covers. */
function assessCoverage(sections: string[], params: SeedParams): CoverageFlags {
  const joined = sections.join('\n').toLowerCase();

  // Codebase: references to source paths, file listings, or explicit codebase analysis
  const codebaseSignals = [
    /src\/\w+/, // src/modules, src/services, etc.
    /__tests__\//, // test file references
    /existing code/,
    /codebase.*review/,
    /file.*modified|file.*created/,
  ];

  // External: URLs, paper references, competitive analysis markers
  const researchSignals = [
    /https?:\/\//,
    /arxiv\.\w+/,
    /github\.com\//,
    /competitive.analysis/,
    /external.*research|research.*finding/,
  ];

  // Requirements: explicit requirements, user needs, acceptance criteria
  const requirementSignals = [
    /\brequirement/,
    /\bpillar\b/,
    /acceptance.criteria/,
    /\bmust\b.*\bsupport\b/,
    /cross.cutting/,
  ];

  const matchAny = (signals: RegExp[]) => signals.some((r) => r.test(joined));

  return {
    hasCodebaseReview: matchAny(codebaseSignals),
    hasExternalResearch: matchAny(researchSignals),
    hasRequirements: matchAny(requirementSignals) || !!params.interviewAnswers,
  };
}

/** Determine whether gathered context is comprehensive enough to skip research. */
function shouldSkipResearch(flags: CoverageFlags): boolean {
  return flags.hasCodebaseReview && flags.hasExternalResearch && flags.hasRequirements;
}

/** Build the seed function for the planning workflow. */
export function buildPlanningSeed(params: SeedParams): () => Promise<SeedResult> {
  return async (): Promise<SeedResult> => {
    const sections: string[] = [];

    if (params.brainNotes) {
      sections.push(...gatherBrainNotes(params.projectDir, params.brainNotes));
    }

    if (params.files) {
      sections.push(...gatherFiles(params.projectDir, params.files));
    }

    if (params.priorContext) {
      sections.push(`### Prior Context\n\n${params.priorContext}`);
    }

    if (params.interviewAnswers) {
      sections.push(`### Interview Answers\n\n${params.interviewAnswers}`);
    }

    const flags = assessCoverage(sections, params);
    const skipResearch = shouldSkipResearch(flags);

    // Write the gathered context to disk
    const planDir = resolve(params.projectDir, '.plans', params.planId);
    mkdirSync(planDir, { recursive: true });
    const contextPath = resolve(planDir, 'pre-existing-context.md');

    const header = `# Pre-Existing Context\n\nPlan: ${params.planId}\n\n`;
    const coverageBlock = [
      '## Coverage Assessment\n',
      `- Codebase review: ${flags.hasCodebaseReview ? 'yes' : 'no'}`,
      `- External research: ${flags.hasExternalResearch ? 'yes' : 'no'}`,
      `- Requirements: ${flags.hasRequirements ? 'yes' : 'no'}`,
      `- Skip research: ${skipResearch ? 'yes' : 'no'}`,
    ].join('\n');

    const body =
      sections.length > 0 ? `\n\n## Gathered Context\n\n${sections.join('\n\n---\n\n')}` : '';

    writeFileSync(contextPath, header + coverageBlock + body, 'utf-8');

    const output =
      sections.length > 0
        ? `Seed gathered ${sections.length} context section(s). Skip research: ${skipResearch}`
        : 'No pre-existing context provided.';

    return {
      data: {
        skipResearch: String(skipResearch),
        hasCodebaseReview: String(flags.hasCodebaseReview),
        hasExternalResearch: String(flags.hasExternalResearch),
        hasRequirements: String(flags.hasRequirements),
        ...(params.interviewAnswers ? { interviewAnswers: params.interviewAnswers } : {}),
      },
      output,
    };
  };
}
