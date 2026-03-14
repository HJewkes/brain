import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HookHandler, HookInput, HookConfig, HookResult, DodCriterion } from '../types.js';
import { hookAllow, hookBlock } from '../types.js';

interface DodSpec {
  name: string;
  criteria: DodCriterion[];
}

interface CriterionResult {
  name: string;
  passed: boolean;
  required: boolean;
  output?: string;
}

function loadDodSpec(specPath: string): DodSpec | null {
  if (!existsSync(specPath)) return null;
  try {
    return JSON.parse(readFileSync(specPath, 'utf-8')) as DodSpec;
  } catch {
    return null;
  }
}

export function evaluateDod(spec: DodSpec | null): HookResult {
  if (!spec) return hookAllow();

  const results: CriterionResult[] = spec.criteria.map((criterion) => {
    try {
      execSync(criterion.check, { encoding: 'utf-8', timeout: 30000, stdio: 'pipe' });
      return { name: criterion.name, passed: true, required: criterion.required };
    } catch (err) {
      const output = (err as { stderr?: string }).stderr ?? '';
      return {
        name: criterion.name,
        passed: false,
        required: criterion.required,
        output: output.slice(0, 200),
      };
    }
  });

  const failures = results.filter((r) => !r.passed && r.required);
  if (failures.length === 0) return hookAllow();

  const detail = failures.map((f) => `  - ${f.name}${f.output ? `: ${f.output}` : ''}`).join('\n');
  return hookBlock(`Definition of Done not met for "${spec.name}".\nFailed criteria:\n${detail}`);
}

export const dodCheck: HookHandler = {
  name: 'dod',
  event: 'task-completed',
  priority: 10,

  enabled(config: HookConfig): boolean {
    return config.enforcement.dod;
  },

  run(input: HookInput, config: HookConfig): HookResult {
    if (config.enforcement.dodCriteria.length > 0) {
      return evaluateDod({ name: 'project', criteria: config.enforcement.dodCriteria });
    }

    const fallbackPath = join(input.cwd, 'templates', 'dod', 'code-change.json');
    return evaluateDod(loadDodSpec(fallbackPath));
  },
};
