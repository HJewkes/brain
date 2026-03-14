import { registerDispatchExtension, getRegisteredExtensions } from '../dispatch-extensions.js';
import { sessionBriefingExtension } from './session-briefing-ext.js';
import { breakingChangesExtension } from './breaking-changes-ext.js';
import { interfaceSnapshotExtension } from './interface-snapshot-ext.js';
import { completionCheckExtension } from './completion-check-ext.js';
import { fileOwnershipExtension } from './file-ownership-ext.js';

let initialized = false;

export function initBuiltinExtensions(): void {
  if (initialized) return;
  registerDispatchExtension(completionCheckExtension);
  registerDispatchExtension(fileOwnershipExtension);
  registerDispatchExtension(breakingChangesExtension);
  registerDispatchExtension(interfaceSnapshotExtension);
  registerDispatchExtension(sessionBriefingExtension);
  initialized = true;
}

export function resetBuiltinExtensions(): void {
  initialized = false;
}

export function ensureExtensionsInitialized(): void {
  if (getRegisteredExtensions().length === 0) {
    initBuiltinExtensions();
  }
}
