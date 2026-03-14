import type { DispatchExtension, DispatchExtensionInput } from '../dispatch-extensions.js';
import type { InterfaceSnapshot } from '../interface-snapshot.js';
import { captureInterfaceSnapshot, formatInterfaceSnapshotBrief } from '../interface-snapshot.js';

export const interfaceSnapshotExtension: DispatchExtension = {
  name: 'interfaceSnapshot',

  compute(input: DispatchExtensionInput): InterfaceSnapshot | undefined {
    const patterns = input.options?.scopePatterns;
    if (!input.options?.projectDir || !patterns || patterns.length === 0) return undefined;
    try {
      const snapshot = captureInterfaceSnapshot(input.options.projectDir, patterns);
      return snapshot.length > 0 ? snapshot : undefined;
    } catch {
      return undefined;
    }
  },

  format(data: unknown): string | null {
    const snapshot = data as InterfaceSnapshot;
    if (!snapshot || snapshot.length === 0) return null;
    return formatInterfaceSnapshotBrief(snapshot);
  },
};
