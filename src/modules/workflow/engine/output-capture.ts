import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STEP_OUTPUTS_DIR = 'step-outputs';

function outputDir(projectDir: string, instanceDisplayId: string): string {
  return join(projectDir, '.plans', instanceDisplayId, STEP_OUTPUTS_DIR);
}

function outputPath(projectDir: string, instanceDisplayId: string, stepId: string): string {
  return join(outputDir(projectDir, instanceDisplayId), `${stepId}.md`);
}

export function captureStepOutput(
  projectDir: string,
  instanceDisplayId: string,
  stepId: string,
  output: string
): void {
  const dir = outputDir(projectDir, instanceDisplayId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath(projectDir, instanceDisplayId, stepId), output, 'utf-8');
}

export function getStepOutput(
  projectDir: string,
  instanceDisplayId: string,
  stepId: string
): string | null {
  const path = outputPath(projectDir, instanceDisplayId, stepId);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

export function injectStepOutputVariables(
  projectDir: string,
  instanceDisplayId: string,
  stepIds: string[],
  vars: Record<string, string>
): void {
  const parts: string[] = [];

  for (const stepId of stepIds) {
    const output = getStepOutput(projectDir, instanceDisplayId, stepId);
    if (!output) continue;

    const varName = `STEP_OUTPUT_${stepId.toUpperCase().replace(/-/g, '_')}`;
    vars[varName] = output;
    parts.push(`### ${stepId}\n\n${output}`);
  }

  if (parts.length > 0) {
    vars.PREVIOUS_STEP_OUTPUTS = parts.join('\n\n---\n\n');
  }
}
