import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, unlinkSync } from 'node:fs';
import type { GlobalSetupContext } from 'vitest/node';
import {
  TEMPLATE_SCHEMA_VERSION,
  TEMPLATE_EMBEDDER_DIMENSIONS,
  TEMPLATE_EMBEDDER_MODEL,
} from './template-seed.js';

const TEMPLATE_PATH = join(
  tmpdir(),
  `brain-template-v${TEMPLATE_SCHEMA_VERSION}.db`,
);

export default async function setup({ provide }: GlobalSetupContext) {
  if (existsSync(TEMPLATE_PATH)) {
    unlinkSync(TEMPLATE_PATH);
  }

  // Dynamic import to avoid loading native modules at config time
  const { BrainDB } = await import('../../src/services/brain-db.js');

  const db = new BrainDB(TEMPLATE_PATH);
  db.setEmbeddingModel(TEMPLATE_EMBEDDER_MODEL, TEMPLATE_EMBEDDER_DIMENSIONS);
  db.close();

  provide('templateDbPath', TEMPLATE_PATH);
  provide('schemaVersion', TEMPLATE_SCHEMA_VERSION);
}

export function teardown() {
  if (existsSync(TEMPLATE_PATH)) {
    try {
      unlinkSync(TEMPLATE_PATH);
    } catch {
      // Ignore cleanup failures
    }
  }
}
