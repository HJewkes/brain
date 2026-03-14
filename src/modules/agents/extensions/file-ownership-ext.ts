import type { DispatchExtension } from '../dispatch-extensions.js';
import type { FileOwnershipManifest } from '../file-ownership.js';
import { formatOwnershipBrief } from '../file-ownership.js';

export const fileOwnershipExtension: DispatchExtension = {
  name: 'fileOwnership',

  compute(): FileOwnershipManifest | undefined {
    // File ownership is set externally on the context, not computed here.
    // This extension only handles formatting.
    return undefined;
  },

  format(data: unknown, taskId: string): string | null {
    const manifest = data as FileOwnershipManifest;
    if (!manifest) return null;
    return formatOwnershipBrief(manifest, taskId);
  },
};
