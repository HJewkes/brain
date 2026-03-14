import type { BrainDB } from '../../services/brain-db.js';
import type { BrainConfig } from '../../types.js';

export interface DispatchExtensionInput {
  db: BrainDB;
  taskDisplayId: string;
  options?: {
    config?: BrainConfig;
    projectDir?: string;
    scopePatterns?: string[];
  };
}

export interface DispatchExtension {
  name: string;
  compute(input: DispatchExtensionInput): unknown | undefined;
  format(data: unknown, taskId: string): string | null;
}

const extensions: DispatchExtension[] = [];

export function registerDispatchExtension(ext: DispatchExtension): void {
  extensions.push(ext);
}

export function getRegisteredExtensions(): readonly DispatchExtension[] {
  return extensions;
}

export function clearExtensions(): void {
  extensions.length = 0;
}
